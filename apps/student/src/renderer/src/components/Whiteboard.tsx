import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { Stroke, Point, PenType, WhiteboardEvent } from '@c30/shared';
import { strokeWidthFor, PEN_DEFAULT_WIDTH, PEN_DEFAULT_OPACITY } from '@c30/shared';
import WhiteboardToolbar, { type ToolConfig } from './WhiteboardToolbar';

const COLORS = [
  '#1f2937', '#e5484d', '#2563eb', '#16a34a',
  '#f59e0b', '#7c3aed', '#ec4899', '#ffffff',
];

interface Props {
  socket: Socket | null;
  roomCode: string;
  isTeacher: boolean;
}

// 一次绘制操作(用于 undo)
interface DrawOp {
  kind: 'append' | 'remove' | 'clear';
  strokes?: Stroke[];      // append 时新增的笔画
  removedStrokes?: Stroke[]; // remove 时被删的笔画
  clearedStrokes?: Stroke[]; // clear 时被清空的笔画
}

export default function Whiteboard({ socket, roomCode, isTeacher }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const seqRef = useRef(0);

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
  const [memberCount, setMemberCount] = useState(1);

  // 画布尺寸自适应
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawAll();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // 全量重绘
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const s of strokesRef.current) {
      renderStroke(ctx, s);
    }
  }, []);

  // 渲染单条笔画(速度敏感压感)
  const renderStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    const pts = s.points;
    if (pts.length === 0) return;
    if (pts.length === 1) {
      // 单点画圆点
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

    // 逐段绘制,按速度计算宽度
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
  };

  // 发送事件到房间
  const emit = (event: WhiteboardEvent) => {
    if (socket && roomCode) {
      socket.emit('whiteboard.event', { roomCode, event });
    }
  };

  // 更新 undo/redo 状态
  const syncStackState = () => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  };

  // 本地新增一笔(教师画完)
  const commitStroke = (s: Stroke) => {
    strokesRef.current.push(s);
    undoStackRef.current.push({ kind: 'append', strokes: [s] });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    redrawAll();
    syncStackState();
    emit({ type: 'stroke.append', payload: s });
  };

  // 移除笔迹
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

  // 清空
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

  // undo
  const undo = () => {
    const op = undoStackRef.current.pop();
    if (!op) return;
    redoStackRef.current.push(op);
    if (op.kind === 'append' && op.strokes) {
      const ids = op.strokes.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !ids.includes(s.id));
    } else if (op.kind === 'remove' && op.removedStrokes) {
      strokesRef.current.push(...op.removedStrokes);
    } else if (op.kind === 'clear' && op.clearedStrokes) {
      strokesRef.current = [...op.clearedStrokes];
    }
    redrawAll();
    syncStackState();
    // 广播撤销:简化起见广播全量清空+重发?不,广播 undo 语义给学生端做同构撤销
    emit({ type: 'undo.pop', payload: { opId: String(Date.now()) } });
  };

  // redo
  const redo = () => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    undoStackRef.current.push(op);
    if (op.kind === 'append' && op.strokes) {
      strokesRef.current.push(...op.strokes);
    } else if (op.kind === 'remove' && op.removedStrokes) {
      const ids = op.removedStrokes.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !ids.includes(s.id));
    } else if (op.kind === 'clear' && op.clearedStrokes) {
      strokesRef.current = [];
    }
    redrawAll();
    syncStackState();
    emit({ type: 'undo.pop', payload: { opId: String(Date.now()) } });
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

  // 指针事件
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
      // 点击整笔移除
      const hit = strokesRef.current.find((s) =>
        s.points.some((p) => Math.hypot(p.x - x, p.y - y) <= Math.max(s.width, 8)),
      );
      if (hit) removeStrokes([hit.id]);
      return;
    }

    // 笔:开始绘制
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
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    const { x, y } = getPos(e);
    const now = Date.now();
    drawing.points.push({ x, y, t: now });
    lastPointRef.current = { x, y, t: now };
    // 增量重绘当前正在画的笔画
    redrawAll();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawingRef.current = null;
    lastPointRef.current = null;
    if (drawing.points.length > 0) {
      commitStroke(drawing);
    }
  };

  // 接收远端事件(学生端)
  useEffect(() => {
    if (!socket) return;
    const onWbEvent = (event: WhiteboardEvent) => {
      if (event.type === 'stroke.append') {
        strokesRef.current.push(event.payload);
        redrawAll();
      } else if (event.type === 'stroke.remove') {
        const ids = event.payload.strokeIds;
        strokesRef.current = strokesRef.current.filter((s) => !ids.includes(s.id));
        redrawAll();
      } else if (event.type === 'stroke.clear') {
        strokesRef.current = [];
        redrawAll();
      }
      // undo.pop 简化:学生端本地做一次 undo(同步体验)
    };
    socket.on('whiteboard.event', onWbEvent);
    return () => {
      socket.off('whiteboard.event', onWbEvent);
    };
  }, [socket, redrawAll]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#ffffff' }}>
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
            正在跟随教师白板 · {memberCount} 人在线
          </div>
        )}
      </div>
    </div>
  );
}

// 供工具栏引用颜色
export { COLORS };
