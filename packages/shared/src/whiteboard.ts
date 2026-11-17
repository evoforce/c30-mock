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

// 实时绘制增量(避免每次 move 全量重发整笔所有点,消除 O(n²) 序列化浪费)
export interface LiveStrokeDelta {
  id: string;            // 笔画 id
  tool: PenType;
  color: string;
  width: number;
  opacity: number;
  // 本次新增的采样点(仅增量,不重复已发过的点)
  delta: Point[];
  // 是否结束(松笔/取消)
  done: boolean;
}

export type WhiteboardEvent =
  | { type: 'stroke.append'; payload: Stroke }
  // 实时绘制:教师端边画边同步,只发增量点,学生端本地累积(解决"松笔才显示" + 消除 O(n²))
  | { type: 'stroke.live'; payload: LiveStrokeDelta }
  | { type: 'stroke.remove'; payload: { strokeIds: string[] } }
  | { type: 'stroke.erase'; payload: { strokeId: string; erasedSegments: unknown[] } }
  | { type: 'stroke.clear'; payload: { pageNo: number } }
  // 撤销/重做:广播具体笔画变更(学生端复用 append/remove 语义,无需本地 undo 栈)
  | { type: 'undo'; payload: { removedStrokeIds: string[]; restoredStrokes: Stroke[] } }
  | { type: 'tool.change'; payload: ToolState };

// ---- 弹幕 / 互动 ----

export interface Danmaku {
  id: string;
  userId: string;
  name: string;
  content: string;
  ts: number;
}

// 课堂互动控制(教师端可开/关)
export interface InteractionControl {
  danmakuEnabled: boolean; // 是否允许发送弹幕
  quizEnabled: boolean;    // 是否开放答题
}

export type InteractionEvent =
  // 学生发弹幕(客户端 → 服务端)
  | { type: 'danmaku.send'; payload: { content: string } }
  // 弹幕广播(服务端 → 客户端)
  | { type: 'danmaku.push'; payload: Danmaku }
  // 教师更新互动开关(客户端 → 服务端),服务端广播给全员
  | { type: 'interaction.control'; payload: InteractionControl };

// 白板全量状态快照(客户端连接/加入/切回时拉取)
export interface WhiteboardSnapshot {
  roomCode: string;
  strokes: Stroke[];
  nextSeq: number;
}
