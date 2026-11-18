import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useState } from 'react';
import type { Stroke, Point, PenType } from '@c30/shared';
import { PEN_DEFAULT_OPACITY } from '@c30/shared';
import type { Socket } from 'socket.io-client';
import { CanvasRenderer } from './Renderer';
import type { PenConfig } from './PenPanel';

// 桌面批注层:全屏透明画布,画笔直接在桌面上书写(C30 灵魂功能)。
// 关键设计:批注层「持久常驻」,切换工具(选择/画笔/板擦/互动)不清空笔迹;
// 绘制轨迹来自主进程的「全局鼠标钩子」(系统级监听),而非窗口 pointer 事件,
// 因此窗口可始终保持穿透——画批注时仍能操作桌面/浏览器/PPT,画面不冻结。
// 通过 ref 暴露 undo/clear 供外部工具栏按钮调用。

export interface DesktopDrawHandle {
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

interface Props {
  config: PenConfig;
  socket: Socket | null;
  roomCode: string;
  /** 当前工具:画笔(绘制)/板擦(擦除)。select 等其余工具时 null */
  tool: 'pen' | 'eraser' | null;
}

const DesktopDrawLayer = forwardRef<DesktopDrawHandle, Props>(function DesktopDrawLayer(
  { config, socket, roomCode, tool },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  // 被撤销的笔画栈,用于「重做」(redo)。画新一笔或清空时清空此栈。
  const redoStackRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const erasingRef = useRef(false); // 板擦是否按住拖动中
  const lastErasePosRef = useRef<{ x: number; y: number } | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // 板擦半径(逻辑像素)
  const ERASER_RADIUS = 24;
  // 板擦光标跟随位置(板擦模式下显示指示环)
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null);

  // 广播白板事件到课堂
  const emit = useCallback((event: any) => {
    const s = socketRef.current;
    const code = roomCodeRef.current;
    if (s && code) {
      s.emit('whiteboard.event', { roomCode: code, event });
    }
  }, []);

  const renderAll = useCallback(() => {
    rendererRef.current?.render(strokesRef.current);
  }, []);

  const clearAll = useCallback(() => {
    strokesRef.current = [];
    redoStackRef.current = [];
    rendererRef.current?.clear();
    emit({ type: 'stroke.clear', payload: { pageNo: 0 } });
  }, [emit]);

  const undo = useCallback(() => {
    const removed = strokesRef.current.pop();
    if (removed) {
      redoStackRef.current.push(removed);
    }
    renderAll();
    if (removed) {
      emit({ type: 'stroke.remove', payload: { strokeIds: [removed.id] } });
    }
  }, [renderAll, emit]);

  const redo = useCallback(() => {
    const restored = redoStackRef.current.pop();
    if (restored) {
      strokesRef.current.push(restored);
    }
    renderAll();
    if (restored) {
      emit({ type: 'stroke.append', payload: restored });
    }
  }, [renderAll, emit]);

  useImperativeHandle(ref, () => ({ undo, redo, clear: clearAll }), [undo, redo, clearAll]);

  // 初始化渲染器 + 全屏画布(组件常驻,不因工具切换卸载)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.render(strokesRef.current);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      rendererRef.current = null;
    };
  }, []);

  const WIDTH_MAP = [3, 6, 10, 16];
  const toPenType = (pt: PenType | 'highlighter'): PenType =>
    pt === 'highlighter' ? 'brush' : pt;

  const makePoint = (x: number, y: number): Point => ({ x, y, t: performance.now() });

  // 订阅主进程转发的全局鼠标钩子事件(窗口穿透时仍能拿到系统级鼠标轨迹)
  useEffect(() => {
    const batch = (window as any).api?.batch;
    if (!batch) return;

    // 点到线段(ax,ay)-(bx,by)的最短距离
    const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };

    // 涂抹型自由擦除:以「上一位置→当前位置」的擦除条带(半径 R)抹除笔画点。
    // 命中点被移除,笔画切分为剩余连续段(每段≥2点保留);同步到接收端为 remove + append。
    const eraseAt = (x: number, y: number) => {
      const last = lastErasePosRef.current;
      const removedIds: string[] = [];
      const appended: Stroke[] = [];
      const next: Stroke[] = [];

      for (const s of strokesRef.current) {
        // 命中判定:点到擦除条带(线段)距离 ≤ 板擦半径 + 笔宽
        const hit = (pt: Point) => {
          if (last) {
            return distToSegment(pt.x, pt.y, last.x, last.y, x, y) <= ERASER_RADIUS + s.width / 2;
          }
          return Math.hypot(pt.x - x, pt.y - y) <= ERASER_RADIUS + s.width / 2;
        };
        // 无命中 → 整条保留
        if (!s.points.some(hit)) {
          next.push(s);
          continue;
        }
        // 有命中 → 切分为剩余连续段
        removedIds.push(s.id);
        let seg: Point[] = [];
        const flush = () => {
          if (seg.length >= 2) {
            appended.push({ ...s, id: crypto.randomUUID(), points: seg });
          }
          seg = [];
        };
        for (const pt of s.points) {
          if (hit(pt)) {
            flush();
          } else {
            seg.push(pt);
          }
        }
        flush();
      }

      if (removedIds.length > 0) {
        strokesRef.current = [...next, ...appended];
        renderAll();
        emit({ type: 'stroke.remove', payload: { strokeIds: removedIds } });
        for (const a of appended) {
          emit({ type: 'stroke.append', payload: a });
        }
      }
    };

    const onDown = (p: { x: number; y: number; button: unknown }) => {
      const t = toolRef.current;
      if (!t) return;
      // 仅左键(button 0 或 1,不同平台可能不同)
      if (p.button !== undefined && p.button !== 0 && p.button !== 1) return;

      if (t === 'eraser') {
        // 板擦:按下即擦除当前位置,并进入拖动擦除状态
        erasingRef.current = true;
        lastErasePosRef.current = { x: p.x, y: p.y };
        eraseAt(p.x, p.y);
        return;
      }

      // 画笔:开始绘制
      const cfg = configRef.current;
      const stroke: Stroke = {
        id: crypto.randomUUID(),
        tool: toPenType(cfg.penType),
        color: cfg.color,
        width: cfg.penType === 'highlighter' ? 20 : WIDTH_MAP[cfg.strokeWidth],
        opacity: cfg.penType === 'highlighter' ? 0.35 : PEN_DEFAULT_OPACITY[toPenType(cfg.penType)],
        points: [makePoint(p.x, p.y)],
        seq: 0,
      };
      drawingRef.current = stroke;
      emit({
        type: 'stroke.live',
        payload: {
          id: stroke.id,
          tool: stroke.tool,
          color: stroke.color,
          width: stroke.width,
          opacity: stroke.opacity,
          delta: [stroke.points[0]],
          done: false,
        },
      });
    };

    const onMove = (p: { x: number; y: number }) => {
      const t = toolRef.current;
      if (!t) return;

      if (t === 'eraser') {
        // 更新板擦光标位置
        setEraserPos({ x: p.x, y: p.y });
        if (erasingRef.current) {
          // 涂抹擦除:以「上一位置→当前位置」条带抹除,eraseAt 内部做线段距离判定
          eraseAt(p.x, p.y);
          lastErasePosRef.current = { x: p.x, y: p.y };
        }
        return;
      }

      // 画笔:追加点增量绘制
      const drawing = drawingRef.current;
      const renderer = rendererRef.current;
      if (!drawing || !renderer) return;
      const pt = makePoint(p.x, p.y);
      drawing.points.push(pt);
      renderer.renderIncremental(drawing);
      emit({
        type: 'stroke.live',
        payload: {
          id: drawing.id,
          tool: drawing.tool,
          color: drawing.color,
          width: drawing.width,
          opacity: drawing.opacity,
          delta: [pt],
          done: false,
        },
      });
    };

    const onUp = () => {
      const t = toolRef.current;
      if (!t) {
        return;
      }

      if (t === 'eraser') {
        erasingRef.current = false;
        lastErasePosRef.current = null;
        return;
      }

      const drawing = drawingRef.current;
      if (!drawing) return;
      drawingRef.current = null;
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
        // 新落一笔后,重做历史失效(否则 redo 会与后续笔画错乱)
        redoStackRef.current = [];
        strokesRef.current.push(drawing);
        emit({ type: 'stroke.append', payload: drawing });
      }
    };

    const offDown = batch.onMouseDown(onDown);
    const offMove = batch.onMouseMove(onMove);
    const offUp = batch.onMouseUp(onUp);
    return () => {
      offDown?.();
      offMove?.();
      offUp?.();
    };
  }, [emit, renderAll]);

  // 工具切换时同步钩子转发状态到主进程
  useEffect(() => {
    // 切工具时清理绘制状态,防止「选择→画笔」来回切换时残留未完成的笔画,
    // 导致鼠标未按下就顺着上一笔继续画(幽灵笔画)。
    if (tool === null) {
      drawingRef.current = null;
      erasingRef.current = false;
      lastErasePosRef.current = null;
    }
    (window as any).api?.batch?.setActive(tool === 'pen' || tool === 'eraser');
  }, [tool]);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      />
      {/* 板擦光标指示环(半透明圆环,跟随鼠标) */}
      {tool === 'eraser' && eraserPos && (
        <div
          style={{
            position: 'absolute',
            left: eraserPos.x - ERASER_RADIUS,
            top: eraserPos.y - ERASER_RADIUS,
            width: ERASER_RADIUS * 2,
            height: ERASER_RADIUS * 2,
            borderRadius: '50%',
            border: '2px dashed rgba(255,255,255,0.9)',
            background: 'rgba(255,255,255,0.15)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
});

export default DesktopDrawLayer;
