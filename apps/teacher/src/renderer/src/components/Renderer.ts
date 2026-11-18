// 渲染层抽象接口
// 目的:让 Canvas 2D 实现与未来的 C++ NativeRenderer 可无缝替换。
// 数据模型(Stroke/LiveStrokeDelta)与渲染实现完全解耦,只通过本接口交互。

import type { Stroke } from '@c30/shared';
import { strokeWidthFor } from '@c30/shared';

/**
 * 白板渲染器接口。
 * - CanvasRenderer:当前 Demo 实现(Canvas 2D)。
 * - NativeRenderer:未来 C++ 实现(离屏位图 + 位图回传),替换时只换实现类。
 */
export interface Renderer {
  /** 全量渲染:清屏后重画所有已持久化笔画 */
  render(strokes: Stroke[]): void;
  /** 增量渲染单条已持久化笔画(不重画其他) */
  renderIncremental(stroke: Stroke): void;
  /** 渲染正在实时绘制中的笔画(增量点) */
  renderLive(liveStrokes: Stroke[]): void;
  /** 移除笔画 */
  remove(strokeIds: string[]): void;
  /** 清空 */
  clear(): void;
  /** 调整画布尺寸 */
  resize(): void;
}

/**
 * Canvas 2D 实现。
 * 纯渲染职责,不持有业务状态(strokes 列表由组件管理传入)。
 */
export class CanvasRenderer implements Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  // 记录每条笔画的已渲染点数,用于真正增量绘制(避免每 move 都全量重画整条)
  private renderedPointCount = new Map<string, number>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    this.ctx = ctx;
  }

  /** 渲染单条笔画(核心绘制逻辑,唯一依赖 Canvas API 的地方) */
  private drawStroke(s: Stroke) {
    this.drawSegment(s, 0, s.points.length);
  }

  /**
   * 绘制笔画的某一段点区间 [from, to)。
   * - from=0 时画整条(含单点兜底)
   * - from>0 时只画 [from-1, to) 的线段(增量,避免 O(n²) 重绘)
   */
  private drawSegment(s: Stroke, from: number, to: number) {
    const ctx = this.ctx;
    const pts = s.points;
    if (pts.length === 0) return;

    // 单点:画圆点
    if (pts.length === 1 && from === 0) {
      const w = strokeWidthFor(s.tool, s.width, 0);
      ctx.globalAlpha = s.opacity;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    ctx.globalAlpha = s.opacity;
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 平滑绘制:用二次贝塞尔「中点法」把相邻采样点连成连续曲线,消除折线锯齿。
    // 增量段需回退一点作为曲线起点,保证与上一段平滑衔接(避免断点)。
    const start = from === 0 ? 0 : Math.max(from - 1, 0);
    if (to - start < 2) {
      ctx.globalAlpha = 1;
      return;
    }

    // 先画第一段(从 start 点到其后中点),宽度取首段的动态笔宽
    let p0 = pts[start];
    let p1 = pts[start + 1];
    let dt = Math.max(p1.t - p0.t, 1);
    let dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    let w = strokeWidthFor(s.tool, s.width, dist / dt);
    const mid0 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(mid0.x, mid0.y);
    ctx.stroke();

    // 后续每段:以「上一中点」为控制点、曲线过「当前中点」,整体平滑
    let prevMid = mid0;
    for (let i = start + 1; i < to - 1; i++) {
      p0 = pts[i];
      p1 = pts[i + 1];
      dt = Math.max(p1.t - p0.t, 1);
      dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      w = strokeWidthFor(s.tool, s.width, dist / dt);
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(prevMid.x, prevMid.y);
      ctx.quadraticCurveTo(p0.x, p0.y, mid.x, mid.y);
      ctx.stroke();
      prevMid = mid;
    }

    // 收尾:最后一点用直线段
    const lastPt = pts[to - 1];
    ctx.lineWidth = strokeWidthFor(
      s.tool,
      s.width,
      Math.hypot(lastPt.x - pts[to - 2].x, lastPt.y - pts[to - 2].y) /
        Math.max(lastPt.t - pts[to - 2].t, 1),
    );
    ctx.beginPath();
    ctx.moveTo(prevMid.x, prevMid.y);
    ctx.lineTo(lastPt.x, lastPt.y);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  /** 设置 DPR 变换,保证高分屏清晰 */
  private setupTransform() {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private clearCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
  }

  render(strokes: Stroke[]) {
    this.setupTransform();
    this.clearCanvas();
    this.renderedPointCount.clear();
    for (const s of strokes) {
      this.drawStroke(s);
      this.renderedPointCount.set(s.id, s.points.length);
    }
  }

  renderIncremental(stroke: Stroke) {
    this.setupTransform();
    // 真正增量:只画上次之后新增的点,消除每 move 重画整条的 O(n²) 开销
    const last = this.renderedPointCount.get(stroke.id) ?? 0;
    const total = stroke.points.length;
    if (total <= last) return; // 无新增点
    if (last === 0) {
      this.drawStroke(stroke);
    } else {
      this.drawSegment(stroke, last, total);
    }
    this.renderedPointCount.set(stroke.id, total);
  }

  renderLive(liveStrokes: Stroke[]) {
    this.setupTransform();
    // 注意:live 笔画绘制前,已持久化笔画已由调用方先 render 过。
    // 这里只叠加 live 层。为避免脏区复杂度,调用方负责先 render(全量)+ 再 renderLive。
    for (const s of liveStrokes) {
      this.drawStroke(s);
    }
  }

  remove(strokeIds: string[]) {
    // 全量重绘由组件层触发(组件持有 strokes 列表,remove 后调 render)
    void strokeIds;
  }

  clear() {
    this.clearCanvas();
    this.renderedPointCount.clear();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.setupTransform();
  }
}
