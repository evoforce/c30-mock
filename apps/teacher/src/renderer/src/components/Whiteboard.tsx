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
import { PEN_DEFAULT_OPACITY, sortImagesByZ, countStudents } from '@c30/shared';
import { ArrowUpToLine, ArrowDownToLine, Copy, Trash2, Lock, Unlock, RotateCw, Crop } from 'lucide-react';
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
  // 课堂互动控制(弹幕开关 / 允许互动):由外层 Workspace 统一持有,
  // 避免白板与互动面板各存一份、互相覆盖服务端状态。
  interaction: InteractionControl;
  onInteractionChange?: (patch: Partial<InteractionControl>) => void;
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
  kind: 'append' | 'remove' | 'clear' | 'erase' | 'image.add' | 'image.del' | 'image.update';
  strokes?: Stroke[];
  removedStrokes?: Stroke[];
  clearedStrokes?: Stroke[];
  // 「erase」:一次擦除手势前后,被替换掉的原始笔画 / 擦除后剩下的片段。
  // 区域擦除会把一条笔画切成多段,必须成对记录才能正确撤销/重做。
  eraseBefore?: Stroke[];
  eraseAfter?: Stroke[];
  // 图片操作:add = 新增(复制/插入),del = 删除,update = 移动/缩放/置顶
  image?: ImageItem;
  imageBefore?: ImageItem;
  imageAfter?: ImageItem;
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
    eraserRadius = 40,
    interaction,
    onInteractionChange,
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
    eraserRadius: 40,
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
      // 图片选中态也一并清掉(含操作按钮)
      setImageSel(null);
      imageDragRef.current = null;
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

  // 板擦:固定「自由擦除」语义(只擦掉与板擦矩形相交的部分),不再有模式开关

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

  // ---- 图片(聚焦「插入白板」的底图):选择 / 拖动 / 缩放 / 置顶 / 复制 / 删除 ----
  // 图片本身 `pointerEvents:none`(不挡画笔),命中由画布上的 pointer 事件 + 几何判断完成。
  const [imageSel, setImageSel] = useState<string | null>(null);
  // 拖动 / 缩放中的临时状态(pointerdown → pointerup 一次手势)
  const imageDragRef = useRef<{
    mode: 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
    id: string;
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    // 图片原始宽高比,四角缩放时按住比例,避免把截图拉变形
    ratio: number;
  } | null>(null);
  // 拖动中向学生端广播的最小间隔(ms):既实时又不刷爆 socket
  const lastImageEmitRef = useRef(0);

  // 成员与互动状态
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [showMemberPanel, setShowMemberPanel] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; name: string }[]>([]);
  const [danmakuList, setDanmakuList] = useState<Danmaku[]>([]);

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

  // 发送白板事件到房间。
  // 用 useCallback 固定身份(随 socket/roomCode 变化),图片操作的 useCallback 依赖它,
  // 否则会闭包到挂载时的空 socket,导致拖动/置顶/复制/删除都发不出去。
  const emit = useCallback(
    (event: WhiteboardEvent) => {
      if (socket && roomCode) {
        socket.emit('whiteboard.event', { roomCode, event });
      }
    },
    [socket, roomCode],
  );

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
  //   · 自由擦除:板擦像画笔一样涂抹,只把与板擦矩形相交的部分裁掉,
  //     剩下的部分切成若干普通笔迹片段(remove 旧的 + append 新的同步给学生端)。
  //   · 轨迹按细步长细分(见 lib/eraser.ts),手感是连续自由擦除,不会一节一节跳。
  //   · 一次手势(按下→抬起)合成一步 undo。
  const applyEraseRects = (rects: EraserRect[]) => {
    if (rects.length === 0) return;
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
    // 图片操作单独处理(不走 stroke 的 undo 广播)
    let imageEvent: WhiteboardEvent | null = null;

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
    } else if (op.kind === 'image.add' && op.image) {
      // 撤销「新增/复制」:把这张图拿掉
      imagesRef.current = imagesRef.current.filter((im) => im.id !== op.image!.id);
      setImages([...imagesRef.current]);
      setImageSel((cur) => (cur === op.image!.id ? null : cur));
      imageEvent = { type: 'image.remove', payload: { imageIds: [op.image.id] } };
    } else if (op.kind === 'image.del' && op.image) {
      // 撤销「删除」:把原图(含原层序 z)放回来
      imagesRef.current = [...imagesRef.current.filter((im) => im.id !== op.image!.id), op.image];
      setImages([...imagesRef.current]);
      setImageSel(op.image.id);
      imageEvent = { type: 'image.append', payload: op.image };
    } else if (op.kind === 'image.update' && op.imageBefore && op.imageAfter) {
      // 撤销「移动/缩放/置顶」:恢复操作前的样子
      imagesRef.current = imagesRef.current.map((im) => (im.id === op.imageBefore!.id ? op.imageBefore! : im));
      setImages([...imagesRef.current]);
      imageEvent = { type: 'image.update', payload: op.imageBefore };
    }

    redrawAll();
    syncStackState();
    if (imageEvent) {
      emit(imageEvent);
    } else {
      emit({ type: 'undo', payload: { removedStrokeIds, restoredStrokes } });
    }
  };

  // 重做:本地重做 + 广播(undo 的逆操作)
  const redo = () => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    undoStackRef.current.push(op);

    let removedStrokeIds: string[] = [];
    let restoredStrokes: Stroke[] = [];
    let imageEvent: WhiteboardEvent | null = null;

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
    } else if (op.kind === 'image.add' && op.image) {
      imagesRef.current = [...imagesRef.current.filter((im) => im.id !== op.image!.id), op.image];
      setImages([...imagesRef.current]);
      imageEvent = { type: 'image.append', payload: op.image };
    } else if (op.kind === 'image.del' && op.image) {
      imagesRef.current = imagesRef.current.filter((im) => im.id !== op.image!.id);
      setImages([...imagesRef.current]);
      imageEvent = { type: 'image.remove', payload: { imageIds: [op.image.id] } };
    } else if (op.kind === 'image.update' && op.imageBefore && op.imageAfter) {
      imagesRef.current = imagesRef.current.map((im) => (im.id === op.imageAfter!.id ? op.imageAfter! : im));
      setImages([...imagesRef.current]);
      imageEvent = { type: 'image.update', payload: op.imageAfter };
    }

    redrawAll();
    syncStackState();
    if (imageEvent) {
      emit(imageEvent);
    } else {
      emit({ type: 'undo', payload: { removedStrokeIds, restoredStrokes } });
    }
  };

  // 本地插入图片(底图):教师端作为插入发起方自己先应用一份,不依赖 socket 回环。
  // 新图统一取最大 z(压在最上层),否则新插入的图会因为 seq=0 被排到旧图下面。
  const appendImage = useCallback((img: ImageItem) => {
    if (imagesRef.current.some((x) => x.id === img.id)) return;
    const z = img.z ?? imagesRef.current.reduce((m, it) => Math.max(m, it.z ?? it.seq ?? 0), 0) + 1;
    imagesRef.current = [...imagesRef.current, { ...img, z }];
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

  // ---- 图片编辑:命中 / 更新 / 置顶 / 锁定 / 旋转 / 裁剪 / 复制 / 删除 ----
  /** 当前选中的图片(选中态只存 id,尺寸/位置从最新数组里取,拖动时始终是活的) */
  const selectedImage = imageSel ? imagesRef.current.find((im) => im.id === imageSel) ?? null : null;
  const imageBox = selectedImage
    ? { x: selectedImage.x, y: selectedImage.y, w: selectedImage.w, h: selectedImage.h }
    : null;
  /** 该图片是否已置顶到笔迹之上(操作条据此在「置顶 / 取消置顶」之间切换) */
  const isPinned = selectedImage?.aboveStrokes === true;
  /** 裁剪中:矩形用画布坐标;id 记录正在裁剪的图片 */
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cropDragRef = useRef<{
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);

  /** 命中测试:置顶的图(在笔迹之上)永远比底图优先,同类里 z 大的优先 */
  const orderedImages = () =>
    sortImagesByZ(imagesRef.current).sort(
      (a, b) => Number(!!a.aboveStrokes) - Number(!!b.aboveStrokes),
    );
  const hitImageAt = (x: number, y: number): ImageItem | null => {
    const list = orderedImages();
    for (let i = list.length - 1; i >= 0; i--) {
      const im = list[i];
      if (x >= im.x && x <= im.x + im.w && y >= im.y && y <= im.y + im.h) return im;
    }
    return null;
  };

  /** 下一层的 z 值(比所有图片都大 = 最上层) */
  const nextImageZ = () =>
    imagesRef.current.reduce((max, im) => Math.max(max, im.z ?? im.seq ?? 0), 0) + 1;

  /** 记一步图片操作(与笔画共用一个撤销栈) */
  const pushImageOp = (op: DrawOp) => {
    undoStackRef.current.push(op);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    syncStackState();
  };

  /** 本地更新一张图片(位置/尺寸),并同步到界面 */
  const applyImageLocal = (next: ImageItem) => {
    imagesRef.current = imagesRef.current.map((im) => (im.id === next.id ? next : im));
    setImages([...imagesRef.current]);
  };

  /** 把手势中的位置/尺寸同步给学生端(节流,拖动时约 20fps) */
  const emitImageUpdate = (next: ImageItem, force = false) => {
    const now = Date.now();
    if (!force && now - lastImageEmitRef.current < 50) return;
    lastImageEmitRef.current = now;
    emit({ type: 'image.update', payload: next });
  };

  /**
   * 置顶 / 取消置顶:
   *   置顶 = 这张图渲染到**笔迹之上**(会盖住已有笔迹),同时 z 提到同层最大;
   *   取消置顶 = 回到笔迹之下(底图),层序回到置顶前(记不到就放最下层)。
   * 两种操作都可撤销。
   */
  const pinnedPrevZRef = useRef<Map<string, number>>(new Map());
  const toggleImageFront = useCallback(
    (id: string) => {
      const im = imagesRef.current.find((x) => x.id === id);
      if (!im) return;
      const before: ImageItem = { ...im };
      const list = sortImagesByZ(imagesRef.current);
      let after: ImageItem;
      if (im.aboveStrokes) {
        const prev = pinnedPrevZRef.current.get(id);
        const minZ = list.reduce((m, it) => Math.min(m, it.z ?? it.seq ?? 0), Number.POSITIVE_INFINITY);
        pinnedPrevZRef.current.delete(id);
        after = {
          ...im,
          aboveStrokes: false,
          z: prev ?? (Number.isFinite(minZ) ? minZ - 1 : 0),
        };
      } else {
        pinnedPrevZRef.current.set(id, im.z ?? im.seq ?? 0);
        after = {
          ...im,
          aboveStrokes: true,
          z: list.reduce((m, it) => Math.max(m, it.z ?? it.seq ?? 0), 0) + 1,
        };
      }
      applyImageLocal(after);
      emit({ type: 'image.update', payload: after });
      pushImageOp({ kind: 'image.update', imageBefore: before, imageAfter: after });
    },
    [emit],
  );

  /** 锁定 / 解锁:锁定后不能拖动/缩放,边框显示红色 */
  const toggleImageLock = useCallback(
    (id: string) => {
      const im = imagesRef.current.find((x) => x.id === id);
      if (!im) return;
      const before: ImageItem = { ...im };
      const after: ImageItem = { ...im, locked: !im.locked };
      applyImageLocal(after);
      emit({ type: 'image.update', payload: after });
      pushImageOp({ kind: 'image.update', imageBefore: before, imageAfter: after });
    },
    [emit],
  );

  /** 图片加工的统一落地:替换 src / 位置 / 尺寸,并广播 + 记撤销 */
  const applyImageEdit = useCallback(
    (before: ImageItem, patch: Partial<ImageItem>) => {
      const after: ImageItem = { ...before, ...patch };
      applyImageLocal(after);
      emit({ type: 'image.update', payload: after });
      pushImageOp({ kind: 'image.update', imageBefore: before, imageAfter: after });
      return after;
    },
    [emit],
  );

  /** 把图片按 canvas 加工:传入绘制函数,返回新的 dataURL(用于旋转 / 裁剪) */
  const bakeImage = useCallback(async (src: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, img: HTMLImageElement) => void) => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片加载失败'));
      el.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return src;
    draw(ctx, img);
    return canvas.toDataURL('image/png');
  }, []);

  /** 旋转 90°(顺时针,直接烘焙进图片,避免再引入一套旋转矩阵) */
  const rotateImage = useCallback(
    async (id: string) => {
      const im = imagesRef.current.find((x) => x.id === id);
      if (!im) return;
      try {
        const src = await bakeImage(im.src, im.h, im.w, (ctx, img) => {
          ctx.translate(im.h / 2, im.w / 2);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(img, -im.w / 2, -im.h / 2, im.w, im.h);
        });
        // 绕中心旋转:宽高互换,中心点不动
        const cx = im.x + im.w / 2;
        const cy = im.y + im.h / 2;
        applyImageEdit(im, {
          src,
          w: im.h,
          h: im.w,
          x: Math.round(cx - im.h / 2),
          y: Math.round(cy - im.w / 2),
        });
      } catch {
        /* 加载失败就放弃这次旋转 */
      }
    },
    [applyImageEdit, bakeImage],
  );

  /** 进入裁剪:裁剪框初始 = 整张图(画布坐标) */
  const startCrop = useCallback((id: string) => {
    const im = imagesRef.current.find((x) => x.id === id);
    if (!im) return;
    setCropRect({ x: im.x, y: im.y, w: im.w, h: im.h });
  }, []);

  const cancelCrop = useCallback(() => {
    cropDragRef.current = null;
    setCropRect(null);
  }, []);

  /** 确认裁剪:按裁剪框从当前图里取出那一块,烘焙成新图(位置/尺寸同步收窄) */
  const confirmCrop = useCallback(async () => {
    const rect = cropRect;
    const im = imageSel ? imagesRef.current.find((x) => x.id === imageSel) : null;
    if (!rect || !im) {
      setCropRect(null);
      return;
    }
    const relX = Math.max(0, (rect.x - im.x) / im.w);
    const relY = Math.max(0, (rect.y - im.y) / im.h);
    const relW = Math.min(1 - relX, Math.max(0.02, rect.w / im.w));
    const relH = Math.min(1 - relY, Math.max(0.02, rect.h / im.h));
    try {
      const outW = Math.max(1, Math.round(im.w * relW));
      const outH = Math.max(1, Math.round(im.h * relH));
      const src = await bakeImage(im.src, outW, outH, (ctx, img) => {
        ctx.drawImage(
          img,
          relX * img.naturalWidth,
          relY * img.naturalHeight,
          relW * img.naturalWidth,
          relH * img.naturalHeight,
          0,
          0,
          outW,
          outH,
        );
      });
      applyImageEdit(
        imagesRef.current.find((x) => x.id === im.id) ?? im,
        {
          src,
          x: Math.round(im.x + im.w * relX),
          y: Math.round(im.y + im.h * relY),
          w: outW,
          h: outH,
        },
      );
    } catch {
      /* 加载失败:保持原图 */
    }
    cropDragRef.current = null;
    setCropRect(null);
  }, [applyImageEdit, bakeImage, cropRect, imageSel]);

  /** 裁剪框的手势:四角等比?这里自由裁(四角只动一角),框内拖动整体平移 */
  const startCropDrag = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = cropRect;
    const im = imageSel ? imagesRef.current.find((x) => x.id === imageSel) : null;
    if (!rect || !im) return;
    const toLocal = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current!;
      const cr = canvas.getBoundingClientRect();
      return { x: clientX - cr.left, y: clientY - cr.top };
    };
    const start = toLocal(e.clientX, e.clientY);
    cropDragRef.current = { mode, startX: start.x, startY: start.y, orig: rect };
    const MIN = 32;
    const onMove = (ev: PointerEvent) => {
      const cur = toLocal(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      const o = cropDragRef.current?.orig;
      if (!o) return;
      let next = { ...o };
      if (mode === 'move') {
        next.x = Math.min(Math.max(im.x, o.x + dx), im.x + im.w - o.w);
        next.y = Math.min(Math.max(im.y, o.y + dy), im.y + im.h - o.h);
      } else {
        let x1 = o.x;
        let y1 = o.y;
        let x2 = o.x + o.w;
        let y2 = o.y + o.h;
        if (mode.includes('w')) x1 = Math.min(Math.max(im.x, o.x + dx), x2 - MIN);
        if (mode.includes('e')) x2 = Math.max(Math.min(im.x + im.w, o.x + o.w + dx), x1 + MIN);
        if (mode.includes('n')) y1 = Math.min(Math.max(im.y, o.y + dy), y2 - MIN);
        if (mode.includes('s')) y2 = Math.max(Math.min(im.y + im.h, o.y + o.h + dy), y1 + MIN);
        next = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      setCropRect(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** 复制:错开 24px 贴一张新图(z 取最大),并直接选中新图 */
  const duplicateImage = useCallback(
    (id: string) => {
      const im = imagesRef.current.find((x) => x.id === id);
      if (!im) return;
      const copy: ImageItem = {
        ...im,
        id: crypto.randomUUID(),
        x: im.x + 24,
        y: im.y + 24,
        z: nextImageZ(),
        seq: 0,
      };
      imagesRef.current = [...imagesRef.current, copy];
      setImages([...imagesRef.current]);
      setImageSel(copy.id);
      emit({ type: 'image.append', payload: copy });
      pushImageOp({ kind: 'image.add', image: copy });
    },
    [emit],
  );

  /** 删除:本地移除并广播(记入撤销栈,可以撤销) */
  const removeImage = useCallback(
    (id: string) => {
      const im = imagesRef.current.find((x) => x.id === id);
      if (!im) return;
      imagesRef.current = imagesRef.current.filter((x) => x.id !== id);
      setImages([...imagesRef.current]);
      setImageSel((cur) => (cur === id ? null : cur));
      emit({ type: 'image.remove', payload: { imageIds: [id] } });
      pushImageOp({ kind: 'image.del', image: { ...im } });
    },
    [emit],
  );

  // 键盘:Delete / Backspace 删除选中图片,Esc 取消选中(裁剪中 Esc 取消裁剪)
  useEffect(() => {
    if (!imageSel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // 正在输入框里打字时不抢键
      if (t && t.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        if (cropRect) cancelCrop();
        else setImageSel(null);
        return;
      }
      if (cropRect) return; // 裁剪中不响应删除,避免误删正在裁的图
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeImage(imageSel);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageSel, removeImage, cropRect, cancelCrop]);

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
      // 裁剪中:画布上的按下不参与选择(裁剪框自己处理手势)
      if (cropRect) return;
      // ① 已选中图片:点手柄 = 缩放,点框内 = 移动(锁定的图只能改选中,不能拖)
      if (selectedImage) {
        const box = { x: selectedImage.x, y: selectedImage.y, w: selectedImage.w, h: selectedImage.h };
        const handle = hitHandle(box, x, y);
        if (handle) {
          if (selectedImage.locked) {
            // 锁定:按在图上只保持选中,不进入拖动
            return;
          }
          imageDragRef.current = {
            mode: handle,
            id: selectedImage.id,
            startX: x,
            startY: y,
            orig: box,
            ratio: selectedImage.h > 0 ? selectedImage.w / selectedImage.h : 1,
          };
          setSelection(null);
          setRubberBand(null);
          canvasRef.current?.setPointerCapture(e.pointerId);
          return;
        }
      }
      // ② 点到图片(含未选中):直接选中,并在未锁定时立刻进入拖动
      const hit = hitImageAt(x, y);
      if (hit) {
        setImageSel(hit.id);
        setSelection(null);
        setRubberBand(null);
        transformRef.current = null;
        if (!hit.locked) {
          imageDragRef.current = {
            mode: 'move',
            id: hit.id,
            startX: x,
            startY: y,
            orig: { x: hit.x, y: hit.y, w: hit.w, h: hit.h },
            ratio: hit.h > 0 ? hit.w / hit.h : 1,
          };
          canvasRef.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      // ③ 点到空白:取消图片选中
      setImageSel(null);

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
    // 图片:拖动移动 / 八向缩放(四角保持原比例,避免截图被拉变形)
    const imgDrag = imageDragRef.current;
    if (imgDrag) {
      const { x, y } = getPos(e);
      const im = imagesRef.current.find((it) => it.id === imgDrag.id);
      if (!im) return;
      const dx = x - imgDrag.startX;
      const dy = y - imgDrag.startY;
      const MIN = 24;
      let next = { ...imgDrag.orig };

      if (imgDrag.mode === 'move') {
        next.x = imgDrag.orig.x + dx;
        next.y = imgDrag.orig.y + dy;
      } else {
        const o = imgDrag.orig;
        let { x: bx, y: by, w: bw, h: bh } = o;
        const isCorner = imgDrag.mode.length === 2;
        if (imgDrag.mode.includes('e')) bw = Math.max(MIN, o.w + dx);
        if (imgDrag.mode.includes('w')) {
          bw = Math.max(MIN, o.w - dx);
          bx = o.x + (o.w - bw);
        }
        if (imgDrag.mode.includes('s')) bh = Math.max(MIN, o.h + dy);
        if (imgDrag.mode.includes('n')) {
          bh = Math.max(MIN, o.h - dy);
          by = o.y + (o.h - bh);
        }
        // 四角:按原始宽高比联动另一个方向(以刚变化的那一边为准)
        if (isCorner && imgDrag.ratio > 0) {
          if (imgDrag.mode.includes('e') || imgDrag.mode.includes('w')) {
            const newH = Math.max(MIN, bw / imgDrag.ratio);
            if (imgDrag.mode.includes('n')) by = o.y + (o.h - newH);
            bh = newH;
          } else {
            const newW = Math.max(MIN, bh * imgDrag.ratio);
            if (imgDrag.mode.includes('w')) bx = o.x + (o.w - newW);
            bw = newW;
          }
        }
        next = { x: bx, y: by, w: bw, h: bh };
      }

      const updated: ImageItem = { ...im, x: Math.round(next.x), y: Math.round(next.y), w: Math.round(next.w), h: Math.round(next.h) };
      applyImageLocal(updated);
      emitImageUpdate(updated);
      return;
    }

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
    // 图片拖动 / 缩放结束:补发最终位置,并把整次手势记成一步可撤销的操作
    const imgDrag = imageDragRef.current;
    if (imgDrag) {
      imageDragRef.current = null;
      const im = imagesRef.current.find((it) => it.id === imgDrag.id);
      if (im) {
        emitImageUpdate(im, true);
        const before: ImageItem = {
          ...im,
          x: imgDrag.orig.x,
          y: imgDrag.orig.y,
          w: imgDrag.orig.w,
          h: imgDrag.orig.h,
        };
        const changed =
          before.x !== im.x || before.y !== im.y || before.w !== im.w || before.h !== im.h;
        if (changed) pushImageOp({ kind: 'image.update', imageBefore: before, imageAfter: { ...im } });
      }
      return;
    }

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
          const z = img.z ?? imagesRef.current.reduce((m, it) => Math.max(m, it.z ?? it.seq ?? 0), 0) + 1;
          imagesRef.current.push({ ...img, z });
        }
        setImages([...imagesRef.current]);
      } else if (event.type === 'image.update') {
        const img = event.payload;
        imagesRef.current = imagesRef.current.map((im) => (im.id === img.id ? img : im));
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

    socket.on('whiteboard.state', onWbState);
    socket.on('whiteboard.event', onWbEvent);
    socket.on('session.memberJoin', onMemberJoin);
    socket.on('session.memberLeave', onMemberLeave);
    socket.on('session.members', onMembers);
    socket.on('danmaku.push', onDanmaku);

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
    };
  }, [socket, roomCode, redrawAll]);

  // 发送弹幕
  const sendDanmaku = (content: string) => {
    if (socket && roomCode && content.trim()) {
      socket.emit('danmaku.send', { roomCode, content: content.trim() });
    }
  };

  // 更新互动开关(教师端):真正的写入由外层 Workspace 完成(单一真源)
  const updateInteraction = (patch: Partial<InteractionControl>) => {
    onInteractionChange?.(patch);
  };

  // 切换白板背景主题(教师端),广播给全员
  const changeTheme = (t: WhiteboardTheme) => {
    setTheme(t);
    setShowThemePanel(false);
    if (socket && roomCode) {
      socket.emit('whiteboard.event', { roomCode, event: { type: 'theme.change', payload: { theme: t } } });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', ...backgroundFor(theme) }}>
        {/* 图片分两层渲染:
            · 底图(未置顶)在 canvas 之前 → 笔迹压在上面,可以正常批注;
            · 置顶图(aboveStrokes)在 canvas 之后 → 盖住已有笔迹,满足「置顶到笔迹之上」。
            两层都用 SortImagesByZ 排序,同类之间按 z 叠放。 */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {sortImagesByZ(images)
            .filter((img) => !img.aboveStrokes)
            .map((img) => (
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

        {/* 置顶图片层:在 canvas 之后 → 盖住已有笔迹(「置顶到笔迹之上」) */}
        {images.some((img) => img.aboveStrokes) && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {sortImagesByZ(images)
              .filter((img) => img.aboveStrokes)
              .map((img) => (
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
        )}

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

        {/* 图片选中:定位框 + 操作条(置顶 / 锁定 / 旋转 / 裁剪 / 复制 / 删除)。
            锁定时定位框与手柄变红,且不能拖动。裁剪中则显示裁剪框与「确定/取消」。 */}
        {isTeacher && imageBox && selectedImage && !cropRect && (
          <>
            <SelectionBox box={imageBox} scale={uiScale} locked={selectedImage.locked} />
            <ImageActionBar
              box={imageBox}
              scale={uiScale}
              pinned={isPinned}
              locked={selectedImage.locked === true}
              onToggleFront={() => toggleImageFront(selectedImage.id)}
              onToggleLock={() => toggleImageLock(selectedImage.id)}
              onRotate={() => void rotateImage(selectedImage.id)}
              onCrop={() => startCrop(selectedImage.id)}
              onDuplicate={() => duplicateImage(selectedImage.id)}
              onDelete={() => removeImage(selectedImage.id)}
            />
          </>
        )}

        {/* 裁剪模式 */}
        {isTeacher && selectedImage && cropRect && (
          <CropOverlay
            imageBox={{ x: selectedImage.x, y: selectedImage.y, w: selectedImage.w, h: selectedImage.h }}
            rect={cropRect}
            scale={uiScale}
            onStartDrag={startCropDrag}
            onConfirm={() => void confirmCrop()}
            onCancel={cancelCrop}
          />
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
            正在跟随教师白板 · {countStudents(members)} 名同学在线
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

// 图片操作条:选中图片后浮在框上方(上方放不下就挪到下方)。
// 置顶 = 放到笔迹与其他图片之上;锁定 = 禁止拖动(框变红);旋转/裁剪 = 就地加工图片。
function ImageActionBar({
  box,
  scale,
  pinned,
  locked,
  onToggleFront,
  onToggleLock,
  onRotate,
  onCrop,
  onDuplicate,
  onDelete,
}: {
  box: { x: number; y: number; w: number; h: number };
  scale: number;
  /** 是否已置顶到笔迹之上 → 按钮显示「取消置顶」 */
  pinned: boolean;
  /** 是否已锁定 → 按钮显示「解锁」,边框变红 */
  locked: boolean;
  onToggleFront: () => void;
  onToggleLock: () => void;
  onRotate: () => void;
  onCrop: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const px = (n: number) => scaled(n, scale);
  const barW = px(520);
  const barH = px(40);
  const gap = px(10);
  const above = box.y - barH - gap >= 8;
  const top = above ? box.y - barH - gap : box.y + box.h + gap;
  const left = Math.max(8, Math.min(box.x, window.innerWidth - barW - 8));

  const Btn = ({
    label,
    title,
    Icon,
    onClick,
    danger,
    active,
  }: {
    label: string;
    title?: string;
    Icon: typeof ArrowUpToLine;
    onClick: () => void;
    danger?: boolean;
    active?: boolean;
  }) => (
    <button
      onClick={onClick}
      title={title ?? label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(5),
        padding: `${px(7)}px ${px(10)}px`,
        borderRadius: px(9),
        border: 'none',
        cursor: 'pointer',
        background: active ? 'rgba(37,99,235,0.9)' : 'transparent',
        color: danger ? '#f87171' : active ? '#ffffff' : '#e5e7eb',
        fontSize: px(12),
        outline: 'none',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <Icon size={px(15)} />
      {label}
    </button>
  );

  return (
    <div
      data-interactive
      style={{
        position: 'absolute',
        left,
        top,
        display: 'flex',
        alignItems: 'center',
        gap: px(2),
        padding: px(4),
        background: 'rgba(27,27,31,0.95)',
        borderRadius: px(12),
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.08)',
        zIndex: 20,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      <Btn
        label={pinned ? '取消置顶' : '置顶'}
        title={pinned ? '取消置顶：回到笔迹之下' : '置顶：放到笔迹之上'}
        Icon={pinned ? ArrowDownToLine : ArrowUpToLine}
        active={pinned}
        onClick={onToggleFront}
      />
      <Btn
        label={locked ? '解锁' : '锁定'}
        title={locked ? '解锁：允许拖动这张图' : '锁定：不能再拖动这张图'}
        Icon={locked ? Unlock : Lock}
        active={locked}
        onClick={onToggleLock}
      />
      <Btn label="旋转" title="顺时针旋转 90°" Icon={RotateCw} onClick={onRotate} />
      <Btn label="裁剪" title="裁剪图片" Icon={Crop} onClick={onCrop} />
      <Btn label="复制" Icon={Copy} onClick={onDuplicate} />
      <Btn label="删除" Icon={Trash2} onClick={onDelete} danger />
    </div>
  );
}

// 裁剪模式:图片范围内压暗 + 虚线裁剪框 + 四角手柄 + 「取消 / 确定」。
function CropOverlay({
  imageBox,
  rect,
  scale,
  onStartDrag,
  onConfirm,
  onCancel,
}: {
  imageBox: { x: number; y: number; w: number; h: number };
  rect: { x: number; y: number; w: number; h: number };
  scale: number;
  onStartDrag: (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const px = (n: number) => scaled(n, scale);
  const H = Math.max(12, Math.round(12 * scale));
  const corners: { key: 'nw' | 'ne' | 'sw' | 'se'; left: number; top: number; cursor: string }[] = [
    { key: 'nw', left: rect.x - H / 2, top: rect.y - H / 2, cursor: 'nwse-resize' },
    { key: 'ne', left: rect.x + rect.w - H / 2, top: rect.y - H / 2, cursor: 'nesw-resize' },
    { key: 'sw', left: rect.x - H / 2, top: rect.y + rect.h - H / 2, cursor: 'nesw-resize' },
    { key: 'se', left: rect.x + rect.w - H / 2, top: rect.y + rect.h - H / 2, cursor: 'nwse-resize' },
  ];
  const barW = px(190);
  const barTop = rect.y + rect.h + px(10);
  const barLeft = Math.max(8, Math.min(rect.x + rect.w - barW, window.innerWidth - barW - 8));

  return (
    <>
      {/* 图片范围内压暗,裁剪框内保持原亮度 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: imageBox.x,
          top: imageBox.y,
          width: imageBox.w,
          height: imageBox.h,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 18,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: rect.x - imageBox.x,
            top: rect.y - imageBox.y,
            width: rect.w,
            height: rect.h,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          }}
        />
      </div>

      {/* 裁剪框本体:虚线边 + 框内拖动整体平移 */}
      <div
        data-interactive
        onPointerDown={onStartDrag('move')}
        style={{
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          border: `${px(1.5)}px dashed #ffffff`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
          cursor: 'move',
          pointerEvents: 'auto',
          zIndex: 19,
        }}
      >
        {/* 三分线(构图辅助) */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {[1, 2].map((i) => (
            <div key={`v${i}`} style={{ position: 'absolute', left: `${(i * 100) / 3}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)' }} />
          ))}
          {[1, 2].map((i) => (
            <div key={`h${i}`} style={{ position: 'absolute', top: `${(i * 100) / 3}%`, left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)' }} />
          ))}
        </div>
      </div>

      {/* 四角手柄 */}
      {corners.map((c) => (
        <div
          key={c.key}
          data-interactive
          onPointerDown={onStartDrag(c.key)}
          style={{
            position: 'absolute',
            left: c.left,
            top: c.top,
            width: H,
            height: H,
            background: '#ffffff',
            border: `1.5px solid #2563eb`,
            borderRadius: 2,
            boxSizing: 'border-box',
            cursor: c.cursor,
            pointerEvents: 'auto',
            zIndex: 20,
          }}
        />
      ))}

      {/* 取消 / 确定 */}
      <div
        data-interactive
        style={{
          position: 'absolute',
          left: barLeft,
          top: barTop,
          width: barW,
          display: 'flex',
          gap: px(8),
          padding: px(4),
          background: 'rgba(27,27,31,0.95)',
          borderRadius: px(12),
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          border: '1px solid rgba(255,255,255,0.08)',
          zIndex: 21,
          pointerEvents: 'auto',
        }}
      >
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: `${px(7)}px 0`,
            borderRadius: px(9),
            border: 'none',
            background: 'transparent',
            color: '#e5e7eb',
            fontSize: px(12),
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          style={{
            flex: 1,
            padding: `${px(7)}px 0`,
            borderRadius: px(9),
            border: 'none',
            background: '#2563eb',
            color: '#ffffff',
            fontSize: px(12),
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          确定
        </button>
      </div>
    </>
  );
}

// 选择变换框:蓝色边框 + 8 个手柄(四角 + 四边中点);锁定时整框变红且手柄变暗
function SelectionBox({
  box,
  scale,
  locked,
}: {
  box: { x: number; y: number; w: number; h: number };
  scale: number;
  locked?: boolean;
}) {
  const H = Math.max(9, Math.round(9 * scale)); // 手柄尺寸(随浮层缩放)
  // 锁定:边框与手柄变红,提示「这张图现在拖不动」
  const stroke = locked ? '#ef4444' : '#3b82f6';
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
          border: `1px solid ${stroke}`,
          // 锁定态用红色描边强调,并稍微加粗
          boxShadow: locked ? `0 0 0 2px rgba(239,68,68,0.35)` : 'none',
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
            background: locked ? '#fee2e2' : '#fff',
            border: `1.5px solid ${stroke}`,
            borderRadius: 2,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            cursor: h.cursor,
            opacity: locked ? 0.85 : 1,
          }}
        />
      ))}
    </>
  );
}
