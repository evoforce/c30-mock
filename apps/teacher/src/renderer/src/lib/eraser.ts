// 矩形板擦几何:尺寸换算、拖动轨迹细分、笔画与板擦的交集裁剪(局部擦除)。
//
// 设计要点(对应 docs/whiteboard-design.md 的「擦除语义」):
//   · 板擦是一块「矩形」而不是圆点:宽 = 2 × radius,高 = 宽 × ERASER_ASPECT,
//     视觉上像一块真正的黑板擦;擦除判定用的也是这块矩形,所见即所擦。
//   · 拖动时把「上一位置 → 当前位置」细分成一串互相重叠的矩形(步长 ≤ 短边 / 6,且 ≥ 1.5px),
//     所以即使鼠标事件稀疏、划得很快,也不会出现「跳着擦、漏掉一段」的分段感,
//     手感是连续的自由擦除。
//   · 区域擦除 = 笔画与矩形求交,把相交部分裁掉,剩下的连续部分切成若干普通 Stroke:
//     渲染层、WebSocket 协议、学生端渲染都不用改(remove 旧笔 + append 新片段)。

import type { Point, Stroke } from '@c30/shared';

/** 板擦矩形(逻辑像素:左上角 + 宽高) */
export interface EraserRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 板擦高宽比(高 / 宽):比正方形矮一点,像一块手拿的黑板擦 */
export const ERASER_ASPECT = 0.72;

/** 单次拖动最多细分多少个矩形(超快甩动时兜底,避免一次 move 处理上千个矩形) */
const MAX_SWEEP_SAMPLES = 128;

/** 坐标比较精度(px) */
const EPS = 1e-3;

/** 由板擦半径换算板擦宽高(radius 沿用「板擦」菜单的档位值) */
export function eraserSize(radius: number): { w: number; h: number } {
  const w = Math.max(10, radius * 2);
  return { w, h: Math.max(8, w * ERASER_ASPECT) };
}

/** 以 (cx, cy) 为中心构造板擦矩形(与预览样式完全一致,保证「看到的就是擦到的」) */
export function eraserRectAt(cx: number, cy: number, radius: number): EraserRect {
  const { w, h } = eraserSize(radius);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** 外扩矩形:擦除判定要把笔宽算进去,否则会在擦过的地方留下半条墨边 */
export function inflateRect(rect: EraserRect, pad: number): EraserRect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
}

export function pointInRect(x: number, y: number, rect: EraserRect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * 线段 AB 落在矩形内的参数区间 [t0, t1](Liang–Barsky 裁剪)。
 * 完全在矩形外返回 null;t0 === t1 表示只擦到一个角。
 */
export function segmentRectRange(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: EraserRect,
): [number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;

  // p * t <= q 形式的半边裁剪
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // 平行于该边界:只在完全在外时剔除
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (!clip(-dx, ax - rect.x)) return null; // x >= 左边界
  if (!clip(dx, rect.x + rect.w - ax)) return null; // x <= 右边界
  if (!clip(-dy, ay - rect.y)) return null; // y >= 上边界
  if (!clip(dy, rect.y + rect.h - ay)) return null; // y <= 下边界
  return t0 <= t1 ? [t0, t1] : null;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    t: a.t + (b.t - a.t) * t,
  };
}

/** 笔画是否与板擦矩形相交(把笔宽算进矩形,避免细线「擦不掉」) */
export function strokeIntersectsRect(stroke: Stroke, rect: EraserRect): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;
  const r = inflateRect(rect, stroke.width / 2 + 0.5);
  if (pts.length === 1) return pointInRect(pts[0].x, pts[0].y, r);
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentRectRange(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r)) return true;
  }
  return false;
}

/**
 * 区域擦除:把一条笔画与板擦矩形相交的部分裁掉,返回剩余的连续片段(0 ~ N 条)。
 * 片段沿用原笔画的笔形/颜色/线宽/透明度,只换新 id(视作「新笔」同步给学生端)。
 */
export function clipStrokeByRect(stroke: Stroke, rect: EraserRect): Stroke[] {
  const pts = stroke.points;
  if (pts.length === 0) return [];
  const r = inflateRect(rect, stroke.width / 2 + 0.5);

  if (pts.length === 1) {
    return pointInRect(pts[0].x, pts[0].y, r) ? [] : [{ ...stroke, id: newStrokeId() }];
  }

  const pieces: Point[][] = [];
  let current: Point[] = [];

  const flush = () => {
    // 单点片段不构成笔迹(点状笔迹被擦掉一半时直接丢弃)
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  const push = (p: Point) => {
    const last = current[current.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) return;
    current.push(p);
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const inside = segmentRectRange(a.x, a.y, b.x, b.y, r);

    if (!inside) {
      // 整段都在板擦外:续接上一片段(重复点会被 push 去重)
      if (current.length === 0) current.push(a);
      push(b);
      continue;
    }

    const [tin, tout] = inside;

    // 段首在板擦外 → 保留 [0, tin](裁到板擦边界,不整段丢弃)
    if (tin > EPS) {
      if (current.length === 0) current.push(a);
      push(lerpPoint(a, b, tin));
    } else if (current.length > 0) {
      // 段首已被擦掉:上一片段停在 a(板擦内),必须断开
      flush();
    }

    // 段尾在板擦外 → 保留 [tout, 1],作为新片段的起点
    if (1 - tout > EPS) {
      current.push(lerpPoint(a, b, tout));
      push(b);
    } else {
      flush();
    }
  }
  flush();

  return pieces.map((points) => ({ ...stroke, id: newStrokeId(), points }));
}

/**
 * 区域擦除(多矩形):对一条笔画依次套用一串板擦矩形,返回剩余片段。
 * 未与之相交的矩形会被跳过(不重复裁剪、不白换 id)。
 */
export function clipStrokeByRects(stroke: Stroke, rects: EraserRect[]): Stroke[] {
  let pieces: Stroke[] = [stroke];
  for (const r of rects) {
    const next: Stroke[] = [];
    for (const p of pieces) {
      if (strokeIntersectsRect(p, r)) next.push(...clipStrokeByRect(p, r));
      else next.push(p);
    }
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}

/**
 * 把「上一位置 → 当前位置」细分成一串矩形(含终点,不含起点 —— 起点已在上一帧擦过)。
 * 步长取板擦短边的 1/6 且不小于 1.5px,保证擦除带连续无缝。
 */
export function eraserSweepRects(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
): EraserRect[] {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  if (dist < 0.5) return []; // 原地按下(没移动):起点那一下已经擦过,不必重复处理
  const { w, h } = eraserSize(radius);
  const step = Math.max(1.5, Math.min(w, h) / 6);
  const n = Math.min(MAX_SWEEP_SAMPLES, Math.max(1, Math.ceil(dist / step)));
  const rects: EraserRect[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    rects.push(eraserRectAt(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, radius));
  }
  return rects;
}

function newStrokeId(): string {
  return crypto.randomUUID();
}
