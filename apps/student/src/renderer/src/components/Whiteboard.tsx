import { useEffect, useRef, useState, useCallback } from 'react';
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
} from '@c30/shared';
import { PEN_DEFAULT_OPACITY, sortImagesByZ } from '@c30/shared';
import { CanvasRenderer } from './Renderer';
import WhiteboardToolbar, { type ToolConfig } from './WhiteboardToolbar';
import MemberOverlay from './MemberOverlay';
import JoinToast from './JoinToast';
import DanmakuLayer from './DanmakuLayer';
import DanmakuInput from './DanmakuInput';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

const COLORS = [
  '#1f2937', '#e5484d', '#2563eb', '#16a34a',
  '#f59e0b', '#7c3aed', '#ec4899', '#ffffff',
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
      return {
        backgroundColor: '#ffffff',
        backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      };
    case 'pinyin':
      return {
        backgroundColor: '#f7f1e1',
        backgroundImage:
          'linear-gradient(to right, #4ade80 1px, transparent 1px), linear-gradient(to bottom, #4ade80 1px, transparent 1px)',
        backgroundSize: '120px 80px',
      };
    case 'grid':
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

interface Props {
  socket: Socket | null;
  roomCode: string;
  isTeacher: boolean;
}

// 一次绘制操作(用于本地 undo)
interface DrawOp {
  kind: 'append' | 'remove' | 'clear';
  strokes?: Stroke[];
  removedStrokes?: Stroke[];
  clearedStrokes?: Stroke[];
}

export default function Whiteboard({ socket, roomCode, isTeacher }: Props) {
  // 浮层缩放:成员按钮/提示条等按屏幕尺寸等比放大
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

  // 白板背景主题(跟随教师端)
  const [theme, setTheme] = useState<WhiteboardTheme>('white');

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

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isTeacher) return;
    const { x, y } = getPos(e);
    const t = tool;

    if (t.activeTool === 'eraser') {
      eraseAt(x, y);
      return;
    }
    if (t.activeTool === 'select') {
      const hit = strokesRef.current.find((s) =>
        s.points.some((p) => Math.hypot(p.x - x, p.y - y) <= Math.max(s.width, 8)),
      );
      if (hit) removeStrokes([hit.id]);
      return;
    }

    const now = Date.now();
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      tool: t.penType,
      color: t.color,
      width: t.strokeWidth,
      opacity: PEN_DEFAULT_OPACITY[t.penType],
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
        // 幂等 upsert:教师端「置顶」用 image.update 改 z,新图缺 z 时按最上层补一个
        const idx = imagesRef.current.findIndex((x) => x.id === img.id);
        const z = img.z ?? imagesRef.current.reduce((m, it) => Math.max(m, it.z ?? it.seq ?? 0), 0) + 1;
        const next = { ...img, z };
        if (idx >= 0) imagesRef.current[idx] = next;
        else imagesRef.current.push(next);
        setImages([...imagesRef.current]);
      } else if (event.type === 'image.update') {
        // 教师端拖动 / 缩放图片:按 id 覆盖,次序不变
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', ...backgroundFor(theme) }}>
        {/* 图片分两层渲染(与教师端一致):
            · 底图(未置顶)在 canvas 之前 → 笔迹压在上面;
            · 置顶图(aboveStrokes)在 canvas 之后 → 盖住笔迹。 */}
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
          style={{
            display: 'block',
            // 必须显式定位:未定位的静态 canvas 会被后面的绝对定位图片盖住
            position: 'relative',
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

        {/* 置顶图片层:在 canvas 之后 → 盖住笔迹(与教师端「置顶到笔迹之上」一致) */}
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
      </div>

      {isTeacher && (
        <WhiteboardToolbar
          tool={tool}
          onChange={setTool}
          onUndo={undo}
          onRedo={redo}
          onClear={clearAll}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      )}
    </div>
  );
}

// 供工具栏引用颜色
export { COLORS };
