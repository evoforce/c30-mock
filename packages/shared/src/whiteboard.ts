// 白板共享类型与协议(与 docs/whiteboard-design.md 对应)

// 笔类型
export type PenType = 'brush' | 'pen' | 'pencil';

// 激活工具
export type ActiveTool = 'pen' | 'eraser' | 'select';

// 工具状态
export interface ToolState {
  activeTool: ActiveTool;
  penType: PenType;
  color: string;
  strokeWidth: number;
  eraserRadius: number;
}

// 采样点
export interface Point {
  x: number;
  y: number;
  t: number;
}

// 笔迹
export interface Stroke {
  id: string;
  tool: PenType;
  color: string;
  width: number;
  opacity: number;
  points: Point[];
  seq: number;
}

// ---- 笔锋宽度计算(速度敏感压感,两端共用) ----

/**
 * 根据笔类型 + 采样点间速度,计算当前段的渲染宽度。
 * 速度越快 → 越细(模拟真实笔锋);越慢 → 越接近基础宽度上限。
 */
export function strokeWidthFor(
  penType: PenType,
  baseWidth: number,
  speed: number, // px/ms
): number {
  // 速度影响因子:慢速(0~0.3)保持最大,高速(>2)压到最小
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const factor = clamp(1 - (speed - 0.05) * 0.55, 0.35, 1);

  switch (penType) {
    case 'brush': {
      // 毛笔:基础宽度最大,速度压感明显
      return baseWidth * factor;
    }
    case 'pen': {
      // 钢笔:中等宽度,压感中等
      return Math.max(1.5, baseWidth * 0.7 * (0.5 + factor * 0.5));
    }
    case 'pencil': {
      // 铅笔:最细,压感弱
      return Math.max(1, baseWidth * 0.5 * (0.6 + factor * 0.4));
    }
    default:
      return baseWidth;
  }
}

/** 各笔类型的默认基础宽度 */
export const PEN_DEFAULT_WIDTH: Record<PenType, number> = {
  brush: 14,
  pen: 4,
  pencil: 2.5,
};

/** 各笔类型的默认透明度(铅笔带颗粒感用低透明度叠加) */
export const PEN_DEFAULT_OPACITY: Record<PenType, number> = {
  brush: 0.9,
  pen: 1,
  pencil: 0.75,
};

// ---- WebSocket 协议 ----

export type WhiteboardEvent =
  | { type: 'stroke.append'; payload: Stroke }
  | { type: 'stroke.remove'; payload: { strokeIds: string[] } }
  | { type: 'stroke.erase'; payload: { strokeId: string; erasedSegments: unknown[] } }
  | { type: 'stroke.clear'; payload: { pageNo: number } }
  | { type: 'undo.push'; payload: { opId: string; payload: unknown } }
  | { type: 'undo.pop'; payload: { opId: string } }
  | { type: 'tool.change'; payload: ToolState };

// 白板全量状态快照(客户端连接/加入/切回时拉取)
export interface WhiteboardSnapshot {
  roomCode: string;
  strokes: Stroke[];
  nextSeq: number;
}
