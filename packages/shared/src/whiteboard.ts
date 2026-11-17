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

// ---- WebSocket 协议 ----

export type WhiteboardEvent =
  | { type: 'stroke.append'; payload: Stroke }
  | { type: 'stroke.remove'; payload: { strokeIds: string[] } }
  | { type: 'stroke.erase'; payload: { strokeId: string; erasedSegments: unknown[] } }
  | { type: 'stroke.clear'; payload: { pageNo: number } }
  | { type: 'undo.push'; payload: { opId: string; payload: unknown } }
  | { type: 'undo.pop'; payload: { opId: string } }
  | { type: 'tool.change'; payload: ToolState };
