import { useEffect, useRef, useState, useCallback } from 'react';
import type { Stroke, Point, PenType } from '@c30/shared';
import { PEN_DEFAULT_WIDTH, PEN_DEFAULT_OPACITY } from '@c30/shared';
import { CanvasRenderer } from './Renderer';

// 桌面批注:全屏透明置顶窗口,画笔悬浮在桌面任意界面之上直接书写。
// 复用白板的 CanvasRenderer 与压感算法,工具条悬浮于底部。

const COLORS = ['#e5484d', '#f59e0b', '#16a34a', '#2563eb', '#1f2937', '#ffffff'];

const TOOLS: { key: 'pen' | 'eraser'; label: string }[] = [
  { key: 'pen', label: '画笔' },
  { key: 'eraser', label: '板擦' },
];

export default function DesktopAnnotate() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);
  const lastPointRef = useRef<Point | null>(null);

  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [penType, setPenType] = useState<PenType>('brush');
  const [color, setColor] = useState(COLORS[0]);
  const [annotating, setAnnotating] = useState(false);
  const [undoStack, setUndoStack] = useState<Stroke[]>([]);

  // 初始化渲染器 + 画布全屏尺寸
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
      // 重绘已有笔画
      renderer.render(strokesRef.current);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // 进入/退出批注模式(切换鼠标穿透)
  const enterAnnotate = useCallback(() => {
    const next = !annotating;
    setAnnotating(next);
    (window as any).api?.annotate?.setMode?.(next);
  }, [annotating]);

  // 关闭批注窗口
  const close = useCallback(() => {
    (window as any).api?.annotate?.close?.();
  }, []);

  const getPos = (e: React.PointerEvent): Point => ({
    x: e.clientX,
    y: e.clientY,
    t: performance.now(),
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (!annotating) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    const p = getPos(e);
    const id = crypto.randomUUID();
    const stroke: Stroke = {
      id,
      tool: tool === 'eraser' ? 'brush' : penType,
      color: tool === 'eraser' ? 'rgba(0,0,0,0)' : color,
      width: tool === 'eraser' ? 40 : PEN_DEFAULT_WIDTH[penType],
      opacity: tool === 'eraser' ? 1 : PEN_DEFAULT_OPACITY[penType],
      points: [p],
      seq: 0,
    };
    drawingRef.current = stroke;
    lastPointRef.current = p;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!annotating) return;
    const drawing = drawingRef.current;
    if (!drawing) return;
    const p = getPos(e);
    // 实时追加点并绘制(仅画新增段)
    const renderer = rendererRef.current;
    if (renderer) {
      drawing.points.push(p);
      renderer.renderIncremental(drawing);
    }
    lastPointRef.current = p;
  };

  const onPointerUp = () => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawingRef.current = null;
    lastPointRef.current = null;
    if (drawing.points.length > 0) {
      strokesRef.current.push(drawing);
      setUndoStack((prev) => [...prev, drawing]);
    }
  };

  // 撤销
  const undo = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setUndoStack((prev) => prev.slice(0, -1));
    renderer.render(strokesRef.current);
  }, []);

  // 清空
  const clearAll = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    strokesRef.current = [];
    setUndoStack([]);
    renderer.clear();
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      {/* 全屏透明画布 */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: annotating ? 'crosshair' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      {/* 底部悬浮工具条 */}
      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 16,
          background: 'rgba(31, 41, 55, 0.92)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          zIndex: 10,
        }}
      >
        {/* 批注开关 */}
        <ToolButton
          active={annotating}
          onClick={enterAnnotate}
          title={annotating ? '批注中(点击退出穿透)' : '开始批注'}
        >
          <PenIcon />
        </ToolButton>

        {annotating && (
          <>
            <Divider />

            {/* 工具切换 */}
            {TOOLS.map((t) => (
              <ToolButton
                key={t.key}
                active={tool === t.key}
                onClick={() => setTool(t.key)}
                title={t.label}
              >
                {t.key === 'pen' ? <BrushIcon /> : <EraserIcon />}
              </ToolButton>
            ))}

            <Divider />

            {/* 笔类型 */}
            {tool === 'pen' && (
              <>
                {(['brush', 'pen', 'pencil'] as PenType[]).map((pt) => (
                  <ToolButton
                    key={pt}
                    active={penType === pt}
                    onClick={() => setPenType(pt)}
                    title={{ brush: '毛笔', pen: '钢笔', pencil: '铅笔' }[pt]}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500 }}>
                      {{ brush: '毛', pen: '钢', pencil: '铅' }[pt]}
                    </span>
                  </ToolButton>
                ))}
                <Divider />
              </>
            )}

            {/* 颜色选择 */}
            {tool === 'pen' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    title={c}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: c,
                      border: color === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.25)',
                      cursor: 'pointer',
                      padding: 0,
                      outline: 'none',
                    }}
                  />
                ))}
              </div>
            )}

            <Divider />

            {/* 撤销 / 清空 */}
            <ToolButton active={false} onClick={undo} title="撤销">
              <UndoIcon />
            </ToolButton>
            <ToolButton active={false} onClick={clearAll} title="清空">
              <TrashIcon />
            </ToolButton>
          </>
        )}

        <Divider />

        {/* 关闭 */}
        <ToolButton active={false} onClick={close} title="关闭批注">
          <CloseIcon />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? 'rgba(255,255,255,0.22)' : 'transparent',
        color: '#fff',
        transition: 'background .15s ease',
        outline: 'none',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.18)' }} />;
}

// 图标(lucide 风格简笔)
function PenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BrushIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9.06 11.9l3 3M14.1 6.9a3 3 0 014.2 4.2l-8.4 8.4a2 2 0 01-2.8 0l-.6-.6a2 2 0 010-2.8L14.1 6.9z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EraserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 21h13M5 11l6-6 8 8-5 5H8l-3-3a2 2 0 010-2.8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7v6h6M3 13a9 9 0 109-9 9.7 9.7 0 00-7 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
