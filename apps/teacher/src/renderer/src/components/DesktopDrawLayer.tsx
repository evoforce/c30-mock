import { useEffect, useRef, useState, useCallback } from 'react';
import type { Stroke, Point, PenType } from '@c30/shared';
import { PEN_DEFAULT_OPACITY } from '@c30/shared';
import { CanvasRenderer } from './Renderer';
import PenPanel, { type PenConfig } from './PenPanel';

// 桌面绘制层:全屏透明画布,画笔直接在桌面上书写(C30 灵魂功能)。
// 由底部工具栏「画笔」触发,选完画笔设置后在桌面任意位置绘制。

export default function DesktopDrawLayer({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);

  const [config, setConfig] = useState<PenConfig>({
    penType: 'brush',
    color: '#e5484d',
    strokeWidth: 1,
  });

  // 初始化渲染器 + 全屏画布
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
    return () => window.removeEventListener('resize', resize);
  }, []);

  const getPos = (e: React.PointerEvent): Point => ({
    x: e.clientX,
    y: e.clientY,
    t: performance.now(),
  });

  // 马克笔映射为 brush 类型(高亮半透明)
  const toPenType = (pt: PenType | 'highlighter'): PenType =>
    pt === 'highlighter' ? 'brush' : pt;

  const WIDTH_MAP = [3, 6, 10, 16];

  const onPointerDown = (e: React.PointerEvent) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const p = getPos(e);
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      tool: toPenType(config.penType),
      color: config.color,
      width: config.penType === 'highlighter' ? 20 : WIDTH_MAP[config.strokeWidth],
      opacity: config.penType === 'highlighter' ? 0.35 : PEN_DEFAULT_OPACITY[toPenType(config.penType)],
      points: [p],
      seq: 0,
    };
    drawingRef.current = stroke;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drawing = drawingRef.current;
    const renderer = rendererRef.current;
    if (!drawing || !renderer) return;
    drawing.points.push(getPos(e));
    renderer.renderIncremental(drawing);
  };

  const onPointerUp = () => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawingRef.current = null;
    if (drawing.points.length > 0) {
      strokesRef.current.push(drawing);
    }
  };

  const undo = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    renderer.render(strokesRef.current);
  }, []);

  const clearAll = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    strokesRef.current = [];
    renderer.clear();
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'auto' }}>
      {/* 全屏透明画布 */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: 'crosshair',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      {/* 画笔设置面板(悬浮居中上方) */}
      <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 60 }}>
        <PenPanel config={config} onChange={setConfig} onClose={onClose} />
      </div>

      {/* 撤销/清空/关闭(面板下方工具) */}
      <div
        style={{
          position: 'absolute',
          top: 380,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          zIndex: 60,
        }}
      >
        <MiniBtn onClick={undo} label="撤销">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 7v6h6M3 13a9 9 0 109-9 9.7 9.7 0 00-7 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </MiniBtn>
        <MiniBtn onClick={clearAll} label="清空">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </MiniBtn>
        <MiniBtn onClick={onClose} label="完成">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </MiniBtn>
      </div>
    </div>
  );
}

function MiniBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        border: 'none',
        cursor: 'pointer',
        background: '#ffffff',
        color: '#4b5563',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}
