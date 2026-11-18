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

// 白板背景主题 key
export type WhiteboardTheme =
  | 'blackboard' // 黑板(深墨绿)
  | 'white'      // 白板(纯白)
  | 'green'      // 绿板(草绿)
  | 'dot'        // 点线格(白色点阵网格纸)
  | 'pinyin'     // 拼音田字格(米黄)
  | 'grid';      // 田字格(米黄 + 绿色格线)

// 图片元素(聚焦「插入白板」等场景):一张贴到白板上的图片
export interface ImageItem {
  id: string;
  // 图片内容(dataURL 或 http 地址)
  src: string;
  // 放置位置(左上角)与尺寸(逻辑像素)
  x: number;
  y: number;
  w: number;
  h: number;
  seq: number;
  /**
   * 叠放次序:数字越大越靠上层。
   * 缺省时按 seq(再缺省按数组顺序)绘制,保持旧数据兼容;
   * 「置顶 / 复制 / 撤销删除」都靠它还原层序,不依赖数组顺序,两端才一致。
   */
  z?: number;
}

/** 图片按叠放次序排列(小 → 大,末尾 = 最上层)。两端渲染与命中测试共用。 */
export function sortImagesByZ(list: ImageItem[]): ImageItem[] {
  return [...list].sort((a, b) => (a.z ?? a.seq ?? 0) - (b.z ?? b.seq ?? 0));
}

// ---- 笔锋宽度计算(速度敏感压感,两端共用) ----

/**
 * 根据笔类型计算当前段的渲染宽度(恒定宽度,不再随速度变化)。
 *
 * 说明:早期实现了「速度敏感压感」(快→细、慢→粗,模拟真实笔锋),但在教培白板场景
 * 下会产生「起笔浓粗、快速书写变细、结尾又变粗」的观感不一致,被用户视为 bug。
 * 故改为恒定线宽:speed 参数保留(接口兼容),但不再影响宽度。
 */
export function strokeWidthFor(
  penType: PenType,
  baseWidth: number,
  speed: number, // px/ms(保留入参,恒宽模式下忽略)
): number {
  void speed;
  switch (penType) {
    case 'brush': {
      // 毛笔:基础宽度最大
      return baseWidth;
    }
    case 'pen': {
      // 钢笔:中等宽度
      return Math.max(1.5, baseWidth * 0.7);
    }
    case 'pencil': {
      // 铅笔:最细
      return Math.max(1, baseWidth * 0.5);
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
  // 图片元素(聚焦「插入白板」):贴一张图片到白板
  | { type: 'image.append'; payload: ImageItem }
  // 图片改动(移动 / 缩放):按 id 覆盖,不改变叠放次序
  | { type: 'image.update'; payload: ImageItem }
  | { type: 'image.remove'; payload: { imageIds: string[] } }
  // 撤销/重做:广播具体笔画变更(学生端复用 append/remove 语义,无需本地 undo 栈)
  | { type: 'undo'; payload: { removedStrokeIds: string[]; restoredStrokes: Stroke[] } }
  | { type: 'tool.change'; payload: ToolState }
  // 背景主题切换(教师端切换,广播给全员)
  | { type: 'theme.change'; payload: { theme: WhiteboardTheme } };

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
  images: ImageItem[];
  theme: WhiteboardTheme;
  nextSeq: number;
}
