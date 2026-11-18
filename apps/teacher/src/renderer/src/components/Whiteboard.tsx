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
} from '@c30/shared';
import { PEN_DEFAULT_OPACITY } from '@c30/shared';
import { CanvasRenderer } from './Renderer';
import type { ToolConfig } from './WhiteboardToolbar';
import type { PenConfig } from './PenPanel';
import MemberOverlay from './MemberOverlay';
import JoinToast from './JoinToast';
import DanmakuLayer from './DanmakuLayer';
import DanmakuInput from './DanmakuInput';

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

// 左下角操作栏按钮通用样式
const bottomBtnStyle: CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 12,
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  background: 'rgba(17,24,39,0.72)',
  color: '#ffffff',
  boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
  backdropFilter: 'blur(6px)',
  outline: 'none',
  padding: 0,
};

// 一次绘制操作(用于本地 undo)
interface DrawOp {
  kind: 'append' | 'remove' | 'clear';
  strokes?: Stroke[];
  removedStrokes?: Stroke[];
  clearedStrokes?: Stroke[];
}

export interface WhiteboardHandle {
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

const Whiteboard = forwardRef<WhiteboardHandle, Props>(function Whiteboard(
  { socket, roomCode, isTeacher, onExit, activeTool = 'pen', penConfig },
  ref,
) {
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
  }, [activeTool]);

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

  const removeStrokes = (ids: string[]) => {
    const removed = strokesRef.current.filter((s) => ids.includes(s.id));
    if (removed.length === 0) return;
    strokesRef.current = strokesRef.current.filter((s) => !ids.includes(s.id));
    undoStackRef.current.push({ kind: 'remove', removedStrokes: removed });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    redrawAll();
    syncStackState();
    emit({ type: 'stroke.remove', payload: { strokeIds: ids } });
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
    }

    redrawAll();
    syncStackState();
    emit({ type: 'undo', payload: { removedStrokeIds, restoredStrokes } });
  };

  // 暴露撤销/重做/清空给外部底部悬浮工具条(白板模式下与桌面批注层统一路由)
  useImperativeHandle(ref, () => ({ undo, redo, clear: clearAll }), [undo, redo, clearAll]);

  // 橡皮擦命中检测(整笔删除降级)
  const eraseAt = (x: number, y: number) => {
    const r = tool.eraserRadius;
    const hitIds: string[] = [];
    for (const s of strokesRef.current) {
      for (const p of s.points) {
        if (Math.hypot(p.x - x, p.y - y) <= r) {
          hitIds.push(s.id);
          break;
        }
      }
    }
    if (hitIds.length > 0) removeStrokes(hitIds);
  };

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
    const H = 10; // 手柄命中半径
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
      eraseAt(x, y);
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
    const width = pc ? WIDTH_LEVELS[Math.max(0, Math.min(3, pc.strokeWidth - 1))] ?? t.strokeWidth : t.strokeWidth;
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

  // 接收远端事件 + 拉取快照 + 成员/弹幕/互动
  useEffect(() => {
    if (!socket) return;

    const onWbState = (snap: { roomCode: string; strokes: Stroke[]; images?: ImageItem[]; theme?: WhiteboardTheme; nextSeq: number }) => {
      console.log('[whiteboard] 收到快照 theme =', JSON.stringify(snap.theme), 'roomCode =', snap.roomCode);
      strokesRef.current = [...snap.strokes];
      imagesRef.current = snap.images ? [...snap.images] : [];
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
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            display: 'block',
            cursor: isTeacher
              ? tool.activeTool === 'eraser'
                ? 'crosshair'
                : tool.activeTool === 'select'
                  ? 'pointer'
                  : 'crosshair'
              : 'default',
            touchAction: 'none',
          }}
        />

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
          <SelectionBox box={selection} />
        )}

        {/* 图片元素(聚焦「插入白板」):叠加在 canvas 之上 */}
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

        <DanmakuLayer danmakuList={danmakuList} />

        {!isTeacher && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(31,41,55,0.72)',
              color: '#fff',
              fontSize: 12,
              padding: '5px 12px',
              borderRadius: 14,
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
          rightOffset={100}
        />

        <JoinToast toasts={toasts} />

        {/* 左下角操作栏(教师端):关闭(退出白板) + 主题(切换背景色) */}
        {isTeacher && (
          <div
            data-interactive
            style={{
              position: 'absolute',
              left: 16,
              bottom: 16,
              display: 'flex',
              gap: 8,
            }}
          >
            <button
              data-interactive
              onClick={onExit}
              title="关闭"
              style={bottomBtnStyle}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>⏻</span>
              <span style={{ fontSize: 11, lineHeight: 1 }}>关闭</span>
            </button>
            <button
              data-interactive
              onClick={() => setShowThemePanel((v) => !v)}
              title="主题"
              style={{ ...bottomBtnStyle, background: showThemePanel ? 'rgba(59,130,246,0.9)' : 'rgba(17,24,39,0.72)' }}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>🎨</span>
              <span style={{ fontSize: 11, lineHeight: 1 }}>主题</span>
            </button>
          </div>
        )}

        {/* 主题切换面板 */}
        {isTeacher && showThemePanel && (
          <div
            data-interactive
            style={{
              position: 'absolute',
              left: 16,
              bottom: 76,
              width: 220,
              background: 'rgba(17,24,39,0.92)',
              borderRadius: 12,
              padding: 12,
              boxShadow: '0 8px 28px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
              主题 / Theme
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {THEMES.map((t) => {
                const active = theme === t.key;
                return (
                  <button
                    key={t.key}
                    data-interactive
                    onClick={() => changeTheme(t.key)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 4px',
                      borderRadius: 8,
                      border: active ? '2px solid #3b82f6' : '1px solid transparent',
                      background: active ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.06)',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    <span
                      style={{
                        width: '100%',
                        height: 30,
                        borderRadius: 5,
                        display: 'block',
                        ...backgroundFor(t.key),
                        backgroundSize: t.key === 'dot' ? '8px 8px' : t.key === 'pinyin' ? '30px 20px' : t.key === 'grid' ? '20px 20px' : undefined,
                        border: t.key === 'white' ? '1px solid #e5e7eb' : 'none',
                      }}
                    />
                    <span style={{ color: active ? '#fff' : '#9ca3af', fontSize: 10, lineHeight: 1 }}>
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
function SelectionBox({ box }: { box: { x: number; y: number; w: number; h: number } }) {
  const H = 9; // 手柄尺寸
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
