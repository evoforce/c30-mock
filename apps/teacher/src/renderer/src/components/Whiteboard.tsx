import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { CSSProperties } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  Stroke,
  Point,
  WhiteboardEvent,
  LiveStrokeDelta,
  SessionMember,
  Danmaku,
  InteractionControl,
  ImageItem,
  WhiteboardTheme,
  PenType,
  EraserMode,
} from '@c30/shared';
import { PEN_DEFAULT_OPACITY } from '@c30/shared';
import { CanvasRenderer } from './Renderer';
import {
  eraserRectAt,
  eraserSweepRects,
  strokeIntersectsRect,
  clipStrokeByRects,
  type EraserRect,
} from '../lib/eraser';
import type { ToolConfig } from './WhiteboardToolbar';
import type { PenConfig } from './PenPanel';
import MemberOverlay from './MemberOverlay';
import JoinToast from './JoinToast';
import DanmakuLayer from './DanmakuLayer';
import DanmakuInput from './DanmakuInput';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

const COLORS = [
  '#1f2937', '#e5484d', '#2563eb', '#16a34a',
  '#f59e0b', '#7c3aed', '#ec4899', '#ffffff',
];

interface Props {
  socket: Socket | null;
  roomCode: string;
  isTeacher: boolean;
  onExit?: () => void;
  // 外部工具(来自黑色悬浮栏 BottomToolbar):'pen' | 'eraser' | 'select'
  activeTool?: string;
  // 画笔设置(来自 PenPanel,白板内画笔复用,与桌面批注一致)
  penConfig?: PenConfig;
  // 板擦半径(来自底部工具条「板擦」菜单,与桌面批注一致)
  eraserRadius?: number;
  // 板擦擦除方式:清笔迹(整条清除)/ 区域擦除(只擦相交部分)
  eraserMode?: EraserMode;
}

// 白板背景主题定义:背景色 + 可选网格/格线纹理
interface ThemeDef {
  label: string;
  background: string;
  // 网格线颜色(用于点线格/田字格),为空表示纯色
  gridColor?: string;
  gridSize?: number;
  // 田字格样式(拼音/汉字)
  tianzige?: boolean;
  pinyin?: boolean;
}

const THEMES: { key: WhiteboardTheme; label: string; background: string }[] = [
  { key: 'blackboard', label: '黑板', background: '#1e3a2f' },
  { key: 'white', label: '白板', background: '#ffffff' },
  { key: 'green', label: '绿板', background: '#2e7d32' },
  { key: 'dot', label: '点线格', background: '#ffffff' },
  { key: 'pinyin', label: '拼音田字格', background: '#f7f1e1' },
  { key: 'grid', label: '田字格', background: '#f7f1e1' },
];

// 根据主题计算画布背景样式(纯色或带网格/点阵/田字格纹理)
function backgroundFor(theme: WhiteboardTheme): CSSProperties {
  switch (theme) {
    case 'blackboard':
      return { backgroundColor: '#1e3a2f' };
    case 'white':
      return { backgroundColor: '#ffffff' };
    case 'green':
      return { backgroundColor: '#2e7d32' };
    case 'dot':
      // 点阵网格纸:灰色点阵
      return {
        backgroundColor: '#ffffff',
        backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      };
    case 'pinyin':
      // 拼音田字格:米黄底 + 田字格(上半虚线拼音格)
      return {
        backgroundColor: '#f7f1e1',
        backgroundImage:
          'linear-gradient(to right, #4ade80 1px, transparent 1px), linear-gradient(to bottom, #4ade80 1px, transparent 1px)',
        backgroundSize: '120px 80px',
      };
    case 'grid':
      // 田字格:米黄底 + 田字格(实线 + 虚线十字)
      return {
        backgroundColor: '#f7f1e1',
        backgroundImage:
          'linear-gradient(to right, #16a34a 1px, transparent 1px), linear-gradient(to bottom, #16a34a 1px, transparent 1px)',
        backgroundSize: '80px 80px',
      };
    default:
      return { backgroundColor: '#ffffff' };
  }
}

// 左下角操作栏按钮通用样式(尺寸随浮层缩放)
const bottomBtnStyle = (scale: number): CSSProperties => ({
  width: scaled(54, scale),
  height: scaled(54, scale),
  borderRadius: scaled(12, scale),
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: scaled(4, scale),
  background: 'rgba(17,24,39,0.72)',
  color: '#ffffff',
  boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
  backdropFilter: 'blur(6px)',
  outline: 'none',
  padding: 0,
});

// 一次绘制操作(用于本地 undo)
interface DrawOp {
  kind: 'append' | 'remove' | 'clear' | 'erase';
  strokes?: Stroke[];
  removedStrokes?: Stroke[];
  clearedStrokes?: Stroke[];
  // 「erase」:一次擦除手势前后,被替换掉的原始笔画 / 擦除后剩下的片段。
  // 区域擦除会把一条笔画切成多段,必须成对记录才能正确撤销/重做。
  eraseBefore?: Stroke[];
  eraseAfter?: Stroke[];
}

export interface WhiteboardHandle {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  // 本地插入一张图片(底图)。教师端是插入动作的发起方,不能依赖自己的 socket 广播
  // (服务端只把 whiteboard.event 转发给其他客户端),所以由调用方本地追加后再广播。
  appendImage: (img: ImageItem) => void;
}

const Whiteboard = forwardRef<WhiteboardHandle, Props>(function Whiteboard(
  {
    socket,
    roomCode,
    isTeacher,
    onExit,
    activeTool = 'pen',
    penConfig,
    eraserRadius = 24,
    eraserMode = 'stroke',
  },
  ref,
) {
  const uiScale = useOverlayScale();
  const spx = (n: number) => scaled(n, uiScale);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 渲染器:CanvasRenderer 实现,未来可换 NativeRenderer(C++)
  const rendererRef = useRef<CanvasRenderer | null>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const seqRef = useRef(0);
  // 记录当前实时绘制中已发送的点数(用于只发增量)
  const sentCountRef = useRef(0);
  // 图片元素(聚焦「插入白板」等场景)
  const imagesRef = useRef<ImageItem[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);

  const undoStackRef = useRef<DrawOp[]>([]);
  const redoStackRef = useRef<DrawOp[]>([]);

  const [tool, setTool] = useState<ToolConfig>({
    activeTool: 'pen',
    penType: 'pen',
    color: '#1f2937',
    strokeWidth: 4,
    eraserRadius: 24,
  });
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // 画笔设置(来自 PenPanel),用于白板内画笔绘制
  const penConfigRef = useRef<PenConfig | undefined>(penConfig);
  penConfigRef.current = penConfig;

  // 外部工具(黑色悬浮栏)驱动白板内工具:pen/eraser/select 直接映射
  useEffect(() => {
    const mapped = activeTool === 'pen' ? 'pen' : activeTool === 'eraser' ? 'eraser' : activeTool === 'select' ? 'select' : 'pen';
    setTool((prev) => (prev.activeTool === mapped ? prev : { ...prev, activeTool: mapped }));
    // 切离选择工具时清除选中框
    if (mapped !== 'select') {
      setSelection(null);
      setRubberBand(null);
      transformRef.current = null;
    }
    // 切离板擦时收起矩形板擦(避免换了工具还残留一块白块)
    if (mapped !== 'eraser') {
      erasingRef.current = false;
      lastErasePointRef.current = null;
      setEraserRect(null);
    }
  }, [activeTool]);

  // 板擦粗细由底部「板擦」菜单控制,同步进白板内部工具配置
  useEffect(() => {
    setTool((prev) => (prev.eraserRadius === eraserRadius ? prev : { ...prev, eraserRadius }));
  }, [eraserRadius]);

  // 板擦擦除方式(清笔迹 / 区域擦除)由「板擦」高级菜单控制
  const eraserModeRef = useRef<EraserMode>(eraserMode);
  eraserModeRef.current = eraserMode;

  // ---- 板擦:按住才出现的矩形板擦 + 拖动自由擦除 ----
  // eraserRect 只在「鼠标按下 → 抬起」期间有值,所以板擦样式不会跟着鼠标乱飘
  const [eraserRect, setEraserRect] = useState<EraserRect | null>(null);
  const erasingRef = useRef(false);
  const lastErasePointRef = useRef<{ x: number; y: number } | null>(null);
  // 一次擦除手势(按下 → 抬起)累积成一步 undo:
  //   before = 手势中被替换/删除的「原有」笔画;createdIds = 手势期间本地产出的片段 id
  const eraseGestureRef = useRef<{ before: Stroke[]; createdIds: Set<string> } | null>(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // 成员与互动状态
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [showMemberPanel, setShowMemberPanel] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; name: string }[]>([]);
  const [danmakuList, setDanmakuList] = useState<Danmaku[]>([]);
  const [interaction, setInteraction] = useState<InteractionControl>({
    danmakuEnabled: true,
    quizEnabled: true,
  });

  // 白板背景主题 + 主题面板开关
  const [theme, setTheme] = useState<WhiteboardTheme>('white');
  const [showThemePanel, setShowThemePanel] = useState(false);

  // ---- 选择工具:框选 + 移动 + 缩放(PS 式变换框) ----
  // 选中结果:包围盒(逻辑坐标)+ 被选中的笔画
  const [selection, setSelection] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    strokeIds: string[];
  } | null>(null);
  // 拖拽框选中的临时选框
  const [rubberBand, setRubberBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // 变换拖拽状态:move(平移) | 8 个手柄(nw/n/ne/e/se/s/sw/w) | 框选
  const transformRef = useRef<{
    mode: 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'marquee';
    startX: number;
    startY: number;
    // 变换开始时,每个选中笔画的原始点(用于实时重算)
    origStrokes: Stroke[];
    // 变换开始时包围盒
    origBox: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // 学生端:实时绘制中的笔画(按 id 累积增量点)
  const liveStrokesRef = useRef<Map<string, Stroke>>(new Map());

  // 初始化渲染器 + 画布尺寸自适应
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;

    const resize = () => {
      renderer.resize();
      renderer.render(strokesRef.current);
      if (drawingRef.current) {
        renderer.renderLive([drawingRef.current]);
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // 全量重绘(持久化笔画 + 本地实时笔画)
  const redrawAll = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.render(strokesRef.current);
    if (drawingRef.current) {
      renderer.renderLive([drawingRef.current]);
    }
  }, []);

  // 发送白板事件到房间
  const emit = (event: WhiteboardEvent) => {
    if (socket && roomCode) {
      socket.emit('whiteboard.event', { roomCode, event });
    }
  };

  const syncStackState = () => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  };

  // 本地新增一笔(教师画完 → 持久化 + 广播)
  const commitStroke = (s: Stroke) => {
    strokesRef.current.push(s);
    undoStackRef.current.push({ kind: 'append', strokes: [s] });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    redrawAll();
    syncStackState();
    emit({ type: 'stroke.append', payload: s });
  };

  // ---- 板擦:矩形板擦 + 拖动自由擦除 ----
  //
  // 擦除语义(对应 docs/whiteboard-design.md「擦除语义」):
  //   · 清笔迹(stroke):板擦矩形碰到哪条笔迹,那条笔迹整条删除;
  //   · 区域擦除(area):板擦像画笔一样涂抹,只把与板擦相交的部分裁掉,
  //     剩下的部分切成若干普通笔迹片段(remove 旧的 + append 新的同步给学生端)。
  // 两种模式都是「按下 → 拖动」连续生效;轨迹按细步长细分(见 lib/eraser.ts),
  // 所以手感是连续自由擦除,不会一节一节跳。一次手势(按下→抬起)合成一步 undo。
  const applyEraseRects = (rects: EraserRect[]) => {
    if (rects.length === 0) return;
    const areaMode = eraserModeRef.current === 'area';
    const gesture = eraseGestureRef.current;

    const kept: Stroke[] = [];
    const removedIds: string[] = [];
    const added: Stroke[] = [];
    let changed = false;

    for (const s of strokesRef.current) {
      if (!rects.some((r) => strokeIntersectsRect(s, r))) {
        kept.push(s);
        continue;
      }
      changed = true;
      removedIds.push(s.id);
      // 手势期间自己切出来的片段不算「擦前笔迹」,否则 undo 会把片段当成原件还原
      if (gesture && !gesture.createdIds.has(s.id)) gesture.before.push(s);
      if (!areaMode) continue; // 清笔迹:整条删除,不留片段

      const pieces = clipStrokeByRects(s, rects);
      added.push(...pieces);
      if (gesture) {
        for (const p of pieces) gesture.createdIds.add(p.id);
      }
    }

    if (!changed) return;
    strokesRef.current = [...kept, ...added];
    redrawAll();
    emit({ type: 'stroke.remove', payload: { strokeIds: removedIds } });
    for (const a of added) emit({ type: 'stroke.append', payload: a });
  };

  // 手势结束:把整次擦除合成一步 undo(而不是鼠标每移动一次一步)
  const endEraseGesture = () => {
    const g = eraseGestureRef.current;
    eraseGestureRef.current = null;
    if (!g || g.before.length === 0) return;
    const after = strokesRef.current.filter((s) => g.createdIds.has(s.id));
    undoStackRef.current.push({ kind: 'erase', eraseBefore: g.before, eraseAfter: after });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    syncStackState();
  };

  const clearAll = () => {
    const cleared = [...strokesRef.current];
    if (cleared.length === 0) return;
    strokesRef.current = [];
    undoStackRef.current.push({ kind: 'clear', clearedStrokes: cleared });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    redrawAll();
    syncStackState();
    emit({ type: 'stroke.clear', payload: { pageNo: 0 } });
  };

  // 撤销:本地撤销 + 广播具体笔画变更给学生端
  const undo = () => {
    const op = undoStackRef.current.pop();
    if (!op) return;
    redoStackRef.current.push(op);

    let removedStrokeIds: string[] = [];
    let restoredStrokes: Stroke[] = [];

    if (op.kind === 'append' && op.strokes) {
      removedStrokeIds = op.strokes.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !removedStrokeIds.includes(s.id));
    } else if (op.kind === 'remove' && op.removedStrokes) {
      restoredStrokes = op.removedStrokes;
      strokesRef.current.push(...op.removedStrokes);
    } else if (op.kind === 'clear' && op.clearedStrokes) {
      restoredStrokes = op.clearedStrokes;
      strokesRef.current = [...op.clearedStrokes];
    } else if (op.kind === 'erase' && op.eraseBefore && op.eraseAfter) {
      // 擦除:撤掉擦出来的片段,还原被擦前的原始笔迹
      removedStrokeIds = op.eraseAfter.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !removedStrokeIds.includes(s.id));
      restoredStrokes = op.eraseBefore;
      strokesRef.current.push(...op.eraseBefore);
    }

    redrawAll();
    syncStackState();
    emit({ type: 'undo', payload: { removedStrokeIds, restoredStrokes } });
  };

  // 重做:本地重做 + 广播(undo 的逆操作)
  const redo = () => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    undoStackRef.current.push(op);

    let removedStrokeIds: string[] = [];
    let restoredStrokes: Stroke[] = [];

    if (op.kind === 'append' && op.strokes) {
      restoredStrokes = op.strokes;
      strokesRef.current.push(...op.strokes);
    } else if (op.kind === 'remove' && op.removedStrokes) {
      removedStrokeIds = op.removedStrokes.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !removedStrokeIds.includes(s.id));
    } else if (op.kind === 'clear' && op.clearedStrokes) {
      strokesRef.current = [];
    } else if (op.kind === 'erase' && op.eraseBefore && op.eraseAfter) {
      // 重做擦除:撤掉原始笔迹,重新放回擦出来的片段
      removedStrokeIds = op.eraseBefore.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !removedStrokeIds.includes(s.id));
      restoredStrokes = op.eraseAfter;
      strokesRef.current.push(...op.eraseAfter);
    }

    redrawAll();
    syncStackState();
    emit({ type: 'undo', payload: { removedStrokeIds, restoredStrokes } });
  };

  // 本地插入图片(底图):教师端作为插入发起方自己先应用一份,不依赖 socket 回环
  const appendImage = useCallback((img: ImageItem) => {
    if (imagesRef.current.some((x) => x.id === img.id)) return;
    imagesRef.current = [...imagesRef.current, img];
    setImages(imagesRef.current);
  }, []);

  // 暴露撤销/重做/清空/插图给外部底部悬浮工具条与聚焦「插入白板」
  useImperativeHandle(ref, () => ({ undo, redo, clear: clearAll, appendImage }), [
    undo,
    redo,
    clearAll,
    appendImage,
  ]);

  const getPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // 计算一组笔画的包围盒
  const computeBounds = (strokes: Stroke[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of strokes) {
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  // 判断手柄命中(8 方向 + 内部移动)
  const hitHandle = (box: { x: number; y: number; w: number; h: number }, px: number, py: number): 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | null => {
    // 命中半径随浮层缩放一起放大,大屏上抓取手柄更轻松
    const H = Math.max(10, Math.round(10 * uiScale));
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const corners = [
      ['nw', box.x, box.y],
      ['n', cx, box.y],
      ['ne', box.x + box.w, box.y],
      ['e', box.x + box.w, cy],
      ['se', box.x + box.w, box.y + box.h],
      ['s', cx, box.y + box.h],
      ['sw', box.x, box.y + box.h],
      ['w', box.x, cy],
    ] as const;
    for (const [h, hx, hy] of corners) {
      if (Math.hypot(px - hx, py - hy) <= H) return h;
    }
    if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) return 'move';
    return null;
  };

  // 根据手柄和拖拽位移,重算一个点(相对原包围盒锚点做缩放)
  // 返回变换后的点;scaleX/scaleY 由调用方根据手柄计算
  const applyTransformToStroke = (
    s: Stroke,
    origBox: { x: number; y: number; w: number; h: number },
    nextBox: { x: number; y: number; w: number; h: number },
  ): Stroke => {
    const sx = origBox.w > 0 ? nextBox.w / origBox.w : 1;
    const sy = origBox.h > 0 ? nextBox.h / origBox.h : 1;
    const points = s.points.map((p) => ({
      x: nextBox.x + (p.x - origBox.x) * sx,
      y: nextBox.y + (p.y - origBox.y) * sy,
      t: p.t,
    }));
    // 宽度随缩放缩放(取几何平均,近似)
    const scaleAvg = Math.sqrt(Math.abs(sx * sy));
    return { ...s, points, width: Math.max(1, s.width * scaleAvg) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isTeacher) return;
    const { x, y } = getPos(e);
    const t = tool;

    if (t.activeTool === 'eraser') {
      // 板擦:按下才出现矩形板擦,并立刻擦掉当前位置(单击也能擦)
      const radius = t.eraserRadius;
      erasingRef.current = true;
      eraseGestureRef.current = { before: [], createdIds: new Set<string>() };
      lastErasePointRef.current = { x, y };
      setEraserRect(eraserRectAt(x, y, radius));
      canvasRef.current?.setPointerCapture(e.pointerId);
      applyEraseRects([eraserRectAt(x, y, radius)]);
      return;
    }
    if (t.activeTool === 'select') {
      // 有选中框时:判断是否命中手柄/内部
      if (selection) {
        const handle = hitHandle(selection, x, y);
        if (handle) {
          const origStrokes = strokesRef.current.filter((s) => selection.strokeIds.includes(s.id));
          transformRef.current = {
            mode: handle,
            startX: x,
            startY: y,
            origStrokes,
            origBox: { x: selection.x, y: selection.y, w: selection.w, h: selection.h },
          };
          canvasRef.current?.setPointerCapture(e.pointerId);
          return;
        }
        // 点到空白:取消选中,开始新框选
        setSelection(null);
      }
      // 开始框选
      transformRef.current = { mode: 'marquee', startX: x, startY: y, origStrokes: [], origBox: { x, y, w: 0, h: 0 } };
      setRubberBand({ x, y, w: 0, h: 0 });
      canvasRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    const now = Date.now();
    // 画笔设置:优先用 PenPanel 的配置(与桌面批注一致),否则退回白板默认
    const pc = penConfigRef.current;
    const penType: PenType = pc && pc.penType !== 'highlighter' ? pc.penType : pc?.penType === 'highlighter' ? 'brush' : t.penType;
    const WIDTH_LEVELS = [3, 6, 10, 16];
    const color = pc ? pc.color : t.color;
    // strokeWidth 是 0-3 的档位索引(与 PenPanel / 桌面批注层一致),不能减 1
    const width = pc ? WIDTH_LEVELS[Math.max(0, Math.min(3, pc.strokeWidth))] ?? t.strokeWidth : t.strokeWidth;
    const opacity = pc && pc.penType === 'highlighter' ? 0.35 : PEN_DEFAULT_OPACITY[penType];
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      tool: penType,
      color,
      width,
      opacity,
      points: [{ x, y, t: now }],
      seq: ++seqRef.current,
    };
    drawingRef.current = stroke;
    lastPointRef.current = { x, y, t: now };
    sentCountRef.current = 0; // 重置已发送点数
    canvasRef.current?.setPointerCapture(e.pointerId);
    redrawAll();
    // 首点:发送增量(只发这 1 个点)
    sentCountRef.current = 1;
    emit({
      type: 'stroke.live',
      payload: {
        id: stroke.id,
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        opacity: stroke.opacity,
        delta: [{ x, y, t: now }],
        done: false,
      },
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const tr = transformRef.current;
    // 选择工具:框选/移动/缩放
    if (tr) {
      const { x, y } = getPos(e);
      if (tr.mode === 'marquee') {
        const w = x - tr.startX;
        const h = y - tr.startY;
        setRubberBand({ x: Math.min(tr.startX, x), y: Math.min(tr.startY, y), w: Math.abs(w), h: Math.abs(h) });
        return;
      }
      // move / 手柄缩放:计算新包围盒
      const dx = x - tr.startX;
      const dy = y - tr.startY;
      let nextBox = { ...tr.origBox };
      if (tr.mode === 'move') {
        nextBox = { x: tr.origBox.x + dx, y: tr.origBox.y + dy, w: tr.origBox.w, h: tr.origBox.h };
      } else {
        // 按手柄方向调整边
        let { x: bx, y: by, w: bw, h: bh } = tr.origBox;
        const minSize = 4;
        if (tr.mode.includes('e')) bw = Math.max(minSize, tr.origBox.w + dx);
        if (tr.mode.includes('w')) { const nw = Math.max(minSize, tr.origBox.w - dx); bx = tr.origBox.x + (tr.origBox.w - nw); bw = nw; }
        if (tr.mode.includes('s')) bh = Math.max(minSize, tr.origBox.h + dy);
        if (tr.mode.includes('n')) { const nh = Math.max(minSize, tr.origBox.h - dy); by = tr.origBox.y + (tr.origBox.h - nh); bh = nh; }
        nextBox = { x: bx, y: by, w: bw, h: bh };
      }
      // 实时变换选中笔画
      const transformed = tr.origStrokes.map((s) => applyTransformToStroke(s, tr.origBox, nextBox));
      const ids = new Set(tr.origStrokes.map((s) => s.id));
      strokesRef.current = strokesRef.current.map((s) => {
        const t = transformed.find((x) => x.id === s.id);
        return t ?? s;
      });
      // 更新包围盒显示
      setSelection({ x: nextBox.x, y: nextBox.y, w: nextBox.w, h: nextBox.h, strokeIds: [...ids] });
      redrawAll();
      return;
    }

    // 板擦:按住拖动 → 以「上一位置 → 当前位置」的细分轨迹连续擦除(自由擦除的手感)
    if (erasingRef.current) {
      const { x, y } = getPos(e);
      const radius = tool.eraserRadius;
      const last = lastErasePointRef.current;
      lastErasePointRef.current = { x, y };
      setEraserRect(eraserRectAt(x, y, radius));
      if (last) {
        const rects = eraserSweepRects(last.x, last.y, x, y, radius);
        if (rects.length > 0) applyEraseRects(rects);
      }
      return;
    }

    const drawing = drawingRef.current;
    if (!drawing) return;
    const { x, y } = getPos(e);
    const now = Date.now();
    drawing.points.push({ x, y, t: now });
    lastPointRef.current = { x, y, t: now };
    redrawAll();
    // 只发送新增的点(增量),消除 O(n²) 全量重发
    const delta = drawing.points.slice(sentCountRef.current);
    if (delta.length === 0) return;
    sentCountRef.current = drawing.points.length;
    emit({
      type: 'stroke.live',
      payload: {
        id: drawing.id,
        tool: drawing.tool,
        color: drawing.color,
        width: drawing.width,
        opacity: drawing.opacity,
        delta,
        done: false,
      },
    });
  };

  const onPointerUp = () => {
    // 板擦:松开即收起矩形板擦,并把整次擦除合成一步 undo
    if (erasingRef.current) {
      erasingRef.current = false;
      lastErasePointRef.current = null;
      setEraserRect(null);
      endEraseGesture();
      return;
    }

    const tr = transformRef.current;
    // 选择工具结束
    if (tr) {
      transformRef.current = null;
      if (tr.mode === 'marquee') {
        // 框选结束:命中选框内的笔画
        const rb = rubberBand;
        if (rb && rb.w > 2 && rb.h > 2) {
          const hitIds = strokesRef.current
            .filter((s) => s.points.some((p) => p.x >= rb.x && p.x <= rb.x + rb.w && p.y >= rb.y && p.y <= rb.y + rb.h))
            .map((s) => s.id);
          if (hitIds.length > 0) {
            const box = computeBounds(strokesRef.current.filter((s) => hitIds.includes(s.id)));
            setSelection({ ...box, strokeIds: hitIds });
          } else {
            setSelection(null);
          }
        } else {
          setSelection(null);
        }
        setRubberBand(null);
      } else {
        // 移动/缩放结束:广播 remove(旧) + append(新) 同步到学生端
        if (tr.origStrokes.length > 0) {
          const changed = strokesRef.current.filter((s) => tr.origStrokes.some((o) => o.id === s.id));
          // 判断是否有实际变化(粗判:直接广播)
          const oldIds = tr.origStrokes.map((s) => s.id);
          emit({ type: 'stroke.remove', payload: { strokeIds: oldIds } });
          for (const s of changed) {
            emit({ type: 'stroke.append', payload: s });
          }
        }
      }
      return;
    }

    const drawing = drawingRef.current;
    if (!drawing) return;
    drawingRef.current = null;
    lastPointRef.current = null;
    // 发送结束标记
    emit({
      type: 'stroke.live',
      payload: {
        id: drawing.id,
        tool: drawing.tool,
        color: drawing.color,
        width: drawing.width,
        opacity: drawing.opacity,
        delta: [],
        done: true,
      },
    });
    if (drawing.points.length > 0) {
      commitStroke(drawing);
    }
  };

  // 指针被系统取消(触控板手势 / 窗口失焦等):按「抬起」收尾,避免矩形板擦卡在屏幕上
  const onPointerCancel = () => {
    if (erasingRef.current) {
      erasingRef.current = false;
      lastErasePointRef.current = null;
      setEraserRect(null);
      endEraseGesture();
      return;
    }
    onPointerUp();
  };

  // 接收远端事件 + 拉取快照 + 成员/弹幕/互动
  useEffect(() => {
    if (!socket) return;

    const onWbState = (snap: { roomCode: string; strokes: Stroke[]; images?: ImageItem[]; theme?: WhiteboardTheme; nextSeq: number }) => {
      console.log('[whiteboard] 收到快照 theme =', JSON.stringify(snap.theme), 'roomCode =', snap.roomCode);
      strokesRef.current = [...snap.strokes];
      // 按 id 合并:教师端「插入白板」的底图是先本地追加、再广播的,
      // 若快照先一步返回(此时服务端还没收到 image.append),直接覆盖会把本地底图冲掉。
      const snapImages = snap.images ? [...snap.images] : [];
      const localOnly = imagesRef.current.filter((im) => !snapImages.some((x) => x.id === im.id));
      imagesRef.current = [...snapImages, ...localOnly];
      setImages(imagesRef.current);
      if (snap.theme) setTheme(snap.theme);
      seqRef.current = snap.nextSeq;
      liveStrokesRef.current.clear();
      redrawAll();
    };

    const onWbEvent = (event: WhiteboardEvent) => {
      if (event.type === 'stroke.append') {
        const s = event.payload;
        liveStrokesRef.current.delete(s.id);
        if (!strokesRef.current.some((x) => x.id === s.id)) {
          strokesRef.current.push(s);
        }
        redrawAll();
      } else if (event.type === 'stroke.live') {
        // 实时绘制流:本地累积增量点
        const d: LiveStrokeDelta = event.payload;
        const liveMap = liveStrokesRef.current;
        let live = liveMap.get(d.id);
        if (!live) {
          live = {
            id: d.id,
            tool: d.tool,
            color: d.color,
            width: d.width,
            opacity: d.opacity,
            points: [],
            seq: 0,
          };
          liveMap.set(d.id, live);
        }
        live.points.push(...d.delta);
        if (d.done) {
          // 结束:交由 append 持久化(通常 append 会紧接着到达)
          // 这里不立即删除,等 append 到达时清理
        }
        // 重绘:持久化 + live 层
        const renderer = rendererRef.current;
        if (renderer) {
          renderer.render(strokesRef.current);
          renderer.renderLive(Array.from(liveMap.values()));
        }
      } else if (event.type === 'stroke.remove') {
        const ids = event.payload.strokeIds;
        strokesRef.current = strokesRef.current.filter((s) => !ids.includes(s.id));
        redrawAll();
      } else if (event.type === 'stroke.clear') {
        strokesRef.current = [];
        liveStrokesRef.current.clear();
        redrawAll();
      } else if (event.type === 'image.append') {
        const img = event.payload;
        if (!imagesRef.current.some((x) => x.id === img.id)) {
          imagesRef.current.push(img);
        }
        setImages([...imagesRef.current]);
      } else if (event.type === 'image.remove') {
        const ids = event.payload.imageIds;
        imagesRef.current = imagesRef.current.filter((im) => !ids.includes(im.id));
        setImages([...imagesRef.current]);
      } else if (event.type === 'undo') {
        const { removedStrokeIds, restoredStrokes } = event.payload;
        if (removedStrokeIds.length > 0) {
          strokesRef.current = strokesRef.current.filter((s) => !removedStrokeIds.includes(s.id));
        }
        if (restoredStrokes.length > 0) {
          for (const s of restoredStrokes) {
            if (!strokesRef.current.some((x) => x.id === s.id)) strokesRef.current.push(s);
          }
        }
        redrawAll();
      } else if (event.type === 'theme.change') {
        setTheme(event.payload.theme);
      }
    };

    const onMemberJoin = (d: { member: SessionMember }) => {
      setMembers((prev) => (prev.some((m) => m.userId === d.member.userId) ? prev : [...prev, d.member]));
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, name: d.member.name }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    };
    const onMemberLeave = (d: { userId: string }) => {
      setMembers((prev) => prev.filter((m) => m.userId !== d.userId));
    };
    const onMembers = (d: { members: SessionMember[] }) => {
      setMembers(d.members);
    };
    const onDanmaku = (d: Danmaku) => {
      setDanmakuList((prev) => [...prev.slice(-49), d]);
    };
    const onInteraction = (d: { control: InteractionControl }) => {
      setInteraction(d.control);
    };

    socket.on('whiteboard.state', onWbState);
    socket.on('whiteboard.event', onWbEvent);
    socket.on('session.memberJoin', onMemberJoin);
    socket.on('session.memberLeave', onMemberLeave);
    socket.on('session.members', onMembers);
    socket.on('danmaku.push', onDanmaku);
    socket.on('interaction.control', onInteraction);

    if (roomCode) {
      socket.emit('whiteboard.state', { roomCode });
      socket.emit('session.members', { roomCode });
    }

    return () => {
      socket.off('whiteboard.state', onWbState);
      socket.off('whiteboard.event', onWbEvent);
      socket.off('session.memberJoin', onMemberJoin);
      socket.off('session.memberLeave', onMemberLeave);
      socket.off('session.members', onMembers);
      socket.off('danmaku.push', onDanmaku);
      socket.off('interaction.control', onInteraction);
    };
  }, [socket, roomCode, redrawAll]);

  // 发送弹幕
  const sendDanmaku = (content: string) => {
    if (socket && roomCode && content.trim()) {
      socket.emit('danmaku.send', { roomCode, content: content.trim() });
    }
  };

  // 更新互动开关(教师端)
  const updateInteraction = (patch: Partial<InteractionControl>) => {
    const next = { ...interaction, ...patch };
    setInteraction(next);
    if (socket && roomCode) {
      socket.emit('interaction.control', { roomCode, control: next });
    }
  };

  // 切换白板背景主题(教师端),广播给全员
  const changeTheme = (t: WhiteboardTheme) => {
    console.log('[whiteboard] changeTheme ->', t, 'socket =', !!socket, 'roomCode =', JSON.stringify(roomCode));
    setTheme(t);
    setShowThemePanel(false);
    if (socket && roomCode) {
      socket.emit('whiteboard.event', { roomCode, event: { type: 'theme.change', payload: { theme: t } } });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', ...backgroundFor(theme) }}>
        {/* 图片底图(聚焦「插入白板」):放在 canvas 之前,
            与 canvas 同为「定位元素」时按 DOM 顺序绘制 → 图片在下、笔迹在上,
            画笔/板擦可以正常覆盖到图片上方。 */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {images.map((img) => (
            <img
              key={img.id}
              src={img.src}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: img.x,
                top: img.y,
                width: img.w,
                height: img.h,
                objectFit: 'contain',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            />
          ))}
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={{
            display: 'block',
            // 必须显式定位:未定位的静态 canvas 会被后面的绝对定位图片盖住
            position: 'relative',
            cursor: isTeacher
              ? tool.activeTool === 'eraser'
                ? // 擦除中:隐藏系统光标,让「矩形板擦」本身当光标(松开即恢复十字)
                  eraserRect
                  ? 'none'
                  : 'crosshair'
                : tool.activeTool === 'select'
                  ? 'pointer'
                  : 'crosshair'
              : 'default',
            touchAction: 'none',
          }}
        />

        {/* 矩形白板擦:只有「按下鼠标」擦除时才生成,松开立即消失;
            位置与尺寸直接由擦除判定用的矩形算出,保证「看到的就是擦到的」。 */}
        {eraserRect && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: eraserRect.x,
              top: eraserRect.y,
              width: eraserRect.w,
              height: eraserRect.h,
              borderRadius: Math.max(3, Math.round(eraserRect.w * 0.1)),
              background: 'linear-gradient(180deg, #ffffff 0%, #eef1f5 100%)',
              border: '2px solid #2563eb',
              // 底部一道深色内阴影,让白块看起来像一块有厚度的板擦
              boxShadow: '0 4px 14px rgba(0,0,0,0.3), inset 0 -4px 0 rgba(15,23,42,0.08)',
              opacity: 0.92,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* 框选矩形(选择工具拖拽中) */}
        {rubberBand && (
          <div
            style={{
              position: 'absolute',
              left: rubberBand.x,
              top: rubberBand.y,
              width: rubberBand.w,
              height: rubberBand.h,
              border: '1px dashed #3b82f6',
              background: 'rgba(59,130,246,0.08)',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* 选择变换框(选中后,带 8 手柄) */}
        {selection && (
          <SelectionBox box={selection} scale={uiScale} />
        )}

        <DanmakuLayer danmakuList={danmakuList} />

        {!isTeacher && (
          <div
            style={{
              position: 'absolute',
              top: spx(12),
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(31,41,55,0.72)',
              color: '#fff',
              fontSize: spx(13),
              padding: `${spx(6)}px ${spx(14)}px`,
              borderRadius: spx(14),
              pointerEvents: 'none',
            }}
          >
            正在跟随教师白板 · {members.length} 人在线
          </div>
        )}

        {!isTeacher && interaction.danmakuEnabled && <DanmakuInput onSubmit={sendDanmaku} />}

        <MemberOverlay
          members={members}
          open={showMemberPanel}
          onToggle={() => setShowMemberPanel((v) => !v)}
          isTeacher={isTeacher}
          interaction={interaction}
          onInteractionChange={isTeacher ? updateInteraction : undefined}
          rightOffset={spx(104)}
        />

        <JoinToast toasts={toasts} />

        {/* 左下角操作栏(教师端):关闭(退出白板) + 主题(切换背景色) */}
        {isTeacher && (
          <div
            data-interactive
            style={{
              position: 'absolute',
              left: spx(16),
              bottom: spx(16),
              display: 'flex',
              gap: spx(8),
            }}
          >
            <button
              data-interactive
              onClick={onExit}
              title="关闭"
              style={bottomBtnStyle(uiScale)}
            >
              <span style={{ fontSize: spx(21), lineHeight: 1 }}>⏻</span>
              <span style={{ fontSize: spx(12), lineHeight: 1 }}>关闭</span>
            </button>
            <button
              data-interactive
              onClick={() => setShowThemePanel((v) => !v)}
              title="主题"
              style={{ ...bottomBtnStyle(uiScale), background: showThemePanel ? 'rgba(59,130,246,0.9)' : 'rgba(17,24,39,0.72)' }}
            >
              <span style={{ fontSize: spx(21), lineHeight: 1 }}>🎨</span>
              <span style={{ fontSize: spx(12), lineHeight: 1 }}>主题</span>
            </button>
          </div>
        )}

        {/* 主题切换面板 */}
        {isTeacher && showThemePanel && (
          <div
            data-interactive
            style={{
              position: 'absolute',
              left: spx(16),
              bottom: spx(80),
              width: spx(260),
              maxWidth: 'calc(100vw - 32px)',
              background: 'rgba(17,24,39,0.92)',
              borderRadius: spx(12),
              padding: spx(12),
              boxShadow: '0 8px 28px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div style={{ color: '#93c5fd', fontSize: spx(13), fontWeight: 600, marginBottom: spx(10) }}>
              主题 / Theme
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: spx(8) }}>
              {THEMES.map((t) => {
                const active = theme === t.key;
                return (
                  <button
                    key={t.key}
                    data-interactive
                    onClick={() => changeTheme(t.key)}
                    title={t.label}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: spx(4),
                      padding: `${spx(7)}px ${spx(4)}px`,
                      borderRadius: spx(8),
                      // 选中态:蓝底 + 蓝色描边,和底部工具条保持同一套选中视觉
                      border: active ? `${spx(2)}px solid #60a5fa` : '1px solid transparent',
                      background: active ? 'rgba(37,99,235,0.9)' : 'rgba(255,255,255,0.06)',
                      boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.35)' : 'none',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '100%',
                        height: spx(34),
                        borderRadius: spx(5),
                        display: 'block',
                        ...backgroundFor(t.key),
                        backgroundSize: t.key === 'dot' ? '8px 8px' : t.key === 'pinyin' ? '30px 20px' : t.key === 'grid' ? '20px 20px' : undefined,
                        border: t.key === 'white' ? '1px solid #e5e7eb' : 'none',
                      }}
                    />
                    <span style={{ color: active ? '#ffffff' : '#9ca3af', fontSize: spx(11), lineHeight: 1, fontWeight: active ? 600 : 400 }}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 底部白色绘画工具栏已移除:桌面黑色悬浮工具条(BottomToolbar)已承担画笔/板擦等职责,
          白板模式下不再显示重复的白色菜单栏。 */}
    </div>
  );
});

export default Whiteboard;

// 供工具栏引用颜色
export { COLORS };

// 选择变换框:蓝色边框 + 8 个手柄(四角 + 四边中点)
function SelectionBox({ box, scale }: { box: { x: number; y: number; w: number; h: number }; scale: number }) {
  const H = Math.max(9, Math.round(9 * scale)); // 手柄尺寸(随浮层缩放)
  const handles: { key: string; left: number; top: number; cursor: string }[] = [
    { key: 'nw', left: box.x - H / 2, top: box.y - H / 2, cursor: 'nwse-resize' },
    { key: 'n', left: box.x + box.w / 2 - H / 2, top: box.y - H / 2, cursor: 'ns-resize' },
    { key: 'ne', left: box.x + box.w - H / 2, top: box.y - H / 2, cursor: 'nesw-resize' },
    { key: 'e', left: box.x + box.w - H / 2, top: box.y + box.h / 2 - H / 2, cursor: 'ew-resize' },
    { key: 'se', left: box.x + box.w - H / 2, top: box.y + box.h - H / 2, cursor: 'nwse-resize' },
    { key: 's', left: box.x + box.w / 2 - H / 2, top: box.y + box.h - H / 2, cursor: 'ns-resize' },
    { key: 'sw', left: box.x - H / 2, top: box.y + box.h - H / 2, cursor: 'nesw-resize' },
    { key: 'w', left: box.x - H / 2, top: box.y + box.h / 2 - H / 2, cursor: 'ew-resize' },
  ];
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          border: '1px solid #3b82f6',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      />
      {handles.map((h) => (
        <div
          key={h.key}
          style={{
            position: 'absolute',
            left: h.left,
            top: h.top,
            width: H,
            height: H,
            background: '#fff',
            border: '1.5px solid #3b82f6',
            borderRadius: 2,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            cursor: h.cursor,
          }}
        />
      ))}
    </>
  );
}
