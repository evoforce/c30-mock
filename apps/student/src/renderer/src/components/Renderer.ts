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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    this.ctx = ctx;
  }

  /** 渲染单条笔画(核心绘制逻辑,唯一依赖 Canvas API 的地方) */
  private drawStroke(s: Stroke) {
    const ctx = this.ctx;
    const pts = s.points;
    if (pts.length === 0) return;

    if (pts.length === 1) {
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

    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const dt = Math.max(p1.t - p0.t, 1);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const speed = dist / dt;
      const w = strokeWidthFor(s.tool, s.width, speed);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
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
    for (const s of strokes) {
      this.drawStroke(s);
    }
  }

  renderIncremental(stroke: Stroke) {
    this.setupTransform();
    this.drawStroke(stroke);
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
