import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useState } from 'react';
import type { Stroke, Point, PenType } from '@c30/shared';
import { PEN_DEFAULT_OPACITY } from '@c30/shared';
import type { Socket } from 'socket.io-client';
import { CanvasRenderer } from './Renderer';
import type { PenConfig } from './PenPanel';
import {
  eraserRectAt,
  eraserSweepRects,
  strokeIntersectsRect,
  clipStrokeByRects,
  type EraserRect,
} from '../lib/eraser';

// 桌面批注层:全屏透明画布,画笔直接在桌面上书写(C30 灵魂功能)。
// 关键设计:批注层「持久常驻」,切换工具(选择/画笔/板擦/互动)不清空笔迹;
// 绘制轨迹来自主进程的「全局鼠标钩子」(系统级监听),而非窗口 pointer 事件,
// 因此窗口可始终保持穿透——画批注时仍能操作桌面/浏览器/PPT,画面不冻结。
// 通过 ref 暴露 undo/redo/clear 供外部工具栏按钮调用。
//
// 板擦(与白板内板擦同一套几何,见 lib/eraser.ts):
//   · 矩形板擦,只在「按下」时显示,松开即消失(不再有跟随鼠标的圆环);
//   · 按住拖动 = 细分轨迹连续擦除,手感是自由擦除;
//   · 擦除语义固定为「自由擦除」:只擦掉与板擦矩形相交的部分,其余笔迹保留。

type DesktopOp =
  | { kind: 'append'; strokes: Stroke[] }
  | { kind: 'erase'; before: Stroke[]; after: Stroke[] }
  | { kind: 'clear'; cleared: Stroke[] };

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
  /** 板擦半径(逻辑像素),由底部工具条「板擦」菜单调整 */
  eraserRadius?: number;
}

const DesktopDrawLayer = forwardRef<DesktopDrawHandle, Props>(function DesktopDrawLayer(
  { config, socket, roomCode, tool, eraserRadius = 40 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  // 撤销/重做栈:画一笔 / 擦一次(可能切出多个片段)/ 清空 各记一步
  const undoStackRef = useRef<DesktopOp[]>([]);
  const redoStackRef = useRef<DesktopOp[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const erasingRef = useRef(false); // 板擦是否按住拖动中
  const lastErasePosRef = useRef<{ x: number; y: number } | null>(null);
  // 一次擦除手势(按下 → 抬起)累积成一步 undo
  const eraseGestureRef = useRef<{ before: Stroke[]; createdIds: Set<string> } | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // 板擦半径(逻辑像素):随「板擦」菜单调整,用 ref 让全局鼠标钩子回调读到最新值
  const eraserRadiusRef = useRef(eraserRadius);
  eraserRadiusRef.current = eraserRadius;
  // 矩形板擦位置:只在按住鼠标时非空(按下才生成,松开即消失)
  const [eraserRect, setEraserRect] = useState<EraserRect | null>(null);

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
    const cleared = strokesRef.current;
    if (cleared.length === 0) return;
    strokesRef.current = [];
    undoStackRef.current.push({ kind: 'clear', cleared });
    redoStackRef.current = [];
    rendererRef.current?.clear();
    emit({ type: 'stroke.clear', payload: { pageNo: 0 } });
  }, [emit]);

  // 撤销:按「操作」回滚(局部擦除也能整段还原,而不是只弹最后一笔)
  const undo = useCallback(() => {
    const op = undoStackRef.current.pop();
    if (!op) return;
    redoStackRef.current.push(op);

    let removedIds: string[] = [];
    let restored: Stroke[] = [];

    if (op.kind === 'append') {
      removedIds = op.strokes.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !removedIds.includes(s.id));
    } else if (op.kind === 'clear') {
      restored = op.cleared;
      strokesRef.current = [...op.cleared];
    } else {
      removedIds = op.after.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !removedIds.includes(s.id));
      restored = op.before;
      strokesRef.current.push(...op.before);
    }

    renderAll();
    if (removedIds.length > 0) emit({ type: 'stroke.remove', payload: { strokeIds: removedIds } });
    for (const s of restored) emit({ type: 'stroke.append', payload: s });
  }, [renderAll, emit]);

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    undoStackRef.current.push(op);

    let removedIds: string[] = [];
    let restored: Stroke[] = [];

    if (op.kind === 'append') {
      restored = op.strokes;
      strokesRef.current.push(...op.strokes);
    } else if (op.kind === 'clear') {
      removedIds = strokesRef.current.map((s) => s.id);
      strokesRef.current = [];
    } else {
      removedIds = op.before.map((s) => s.id);
      strokesRef.current = strokesRef.current.filter((s) => !removedIds.includes(s.id));
      restored = op.after;
      strokesRef.current.push(...op.after);
    }

    renderAll();
    if (removedIds.length > 0) emit({ type: 'stroke.remove', payload: { strokeIds: removedIds } });
    for (const s of restored) emit({ type: 'stroke.append', payload: s });
  }, [renderAll, emit]);

  /**
   * 用一串矩形擦除笔迹(自由擦除):
   * 只裁掉与矩形相交的部分,剩余部分切成片段(remove 旧笔 + append 新片段)。
   */
  const applyEraseRects = useCallback(
    (rects: EraserRect[]) => {
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
        if (gesture && !gesture.createdIds.has(s.id)) gesture.before.push(s);

        const pieces = clipStrokeByRects(s, rects);
        added.push(...pieces);
        if (gesture) {
          for (const p of pieces) gesture.createdIds.add(p.id);
        }
      }

      if (!changed) return;
      strokesRef.current = [...kept, ...added];
      renderAll();
      emit({ type: 'stroke.remove', payload: { strokeIds: removedIds } });
      for (const a of added) emit({ type: 'stroke.append', payload: a });
    },
    [emit, renderAll],
  );

  // 手势结束:整次擦除合成一步 undo
  const endEraseGesture = useCallback(() => {
    const g = eraseGestureRef.current;
    eraseGestureRef.current = null;
    if (!g || g.before.length === 0) return;
    const after = strokesRef.current.filter((s) => g.createdIds.has(s.id));
    undoStackRef.current.push({ kind: 'erase', before: g.before, after });
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

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

    const onDown = (p: { x: number; y: number; button: unknown }) => {
      const t = toolRef.current;
      if (!t) return;
      // 仅左键(button 0 或 1,不同平台可能不同)
      if (p.button !== undefined && p.button !== 0 && p.button !== 1) return;

      if (t === 'eraser') {
        // 板擦:按下 → 生成矩形板擦并擦除当前位置,进入拖动擦除状态
        const radius = eraserRadiusRef.current;
        erasingRef.current = true;
        eraseGestureRef.current = { before: [], createdIds: new Set<string>() };
        lastErasePosRef.current = { x: p.x, y: p.y };
        setEraserRect(eraserRectAt(p.x, p.y, radius));
        applyEraseRects([eraserRectAt(p.x, p.y, radius)]);
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
        if (erasingRef.current) {
          // 拖动擦除:把「上一位置 → 当前位置」细分成一串矩形,连续擦除
          const radius = eraserRadiusRef.current;
          const last = lastErasePosRef.current;
          lastErasePosRef.current = { x: p.x, y: p.y };
          setEraserRect(eraserRectAt(p.x, p.y, radius));
          if (last) {
            const rects = eraserSweepRects(last.x, last.y, p.x, p.y, radius);
            if (rects.length > 0) applyEraseRects(rects);
          }
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
        // 松开:收起矩形板擦,整次擦除合成一步 undo
        erasingRef.current = false;
        lastErasePosRef.current = null;
        setEraserRect(null);
        endEraseGesture();
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
        undoStackRef.current.push({ kind: 'append', strokes: [drawing] });
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
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
  }, [emit, renderAll, applyEraseRects, endEraseGesture]);

  // 工具切换时同步钩子转发状态到主进程
  useEffect(() => {
    // 切工具时清理绘制状态,防止「选择→画笔」来回切换时残留未完成的笔画,
    // 导致鼠标未按下就顺着上一笔继续画(幽灵笔画)。
    if (tool === null) {
      drawingRef.current = null;
      erasingRef.current = false;
      lastErasePosRef.current = null;
      eraseGestureRef.current = null;
      setEraserRect(null);
    } else if (tool !== 'eraser') {
      // 从板擦切走:收起矩形板擦
      if (erasingRef.current) {
        erasingRef.current = false;
        lastErasePosRef.current = null;
        endEraseGesture();
      }
      setEraserRect(null);
    }
    (window as any).api?.batch?.setActive(tool === 'pen' || tool === 'eraser');
  }, [tool, endEraseGesture]);

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
      {/* 矩形白板擦:只在按住鼠标擦除时出现,松开即消失(位置尺寸 = 实际擦除区域) */}
      {tool === 'eraser' && eraserRect && (
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
            boxShadow: '0 4px 14px rgba(0,0,0,0.3), inset 0 -4px 0 rgba(15,23,42,0.08)',
            opacity: 0.92,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
});

export default DesktopDrawLayer;
