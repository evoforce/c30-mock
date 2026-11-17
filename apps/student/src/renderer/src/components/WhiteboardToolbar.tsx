import { useState, useRef, useEffect } from 'react';
import type { PenType, ActiveTool } from '@c30/shared';
import {
  Pen,
  Eraser,
  MousePointer2,
  Undo2,
  Redo2,
  Trash2,
  Brush,
  Pencil,
  Check,
} from 'lucide-react';

export interface ToolConfig {
  activeTool: ActiveTool;
  penType: PenType;
  color: string;
  strokeWidth: number;
  eraserRadius: number;
}

interface Props {
  tool: ToolConfig;
  onChange: (t: ToolConfig) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// 常用色(轮盘外快捷选择)
const COMMON_COLORS = [
  '#1f2937', '#e5484d', '#f59e0b', '#16a34a',
  '#2563eb', '#7c3aed', '#ec4899', '#ffffff',
];

// 圆形轮盘色(HSL 色环采样的主色)
const WHEEL_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e',
];

const PEN_TYPES: { key: PenType; label: string; icon: React.ReactNode }[] = [
  { key: 'brush', label: '毛笔', icon: <Brush size={16} /> },
  { key: 'pen', label: '钢笔', icon: <Pen size={16} /> },
  { key: 'pencil', label: '铅笔', icon: <Pencil size={16} /> },
];

export default function WhiteboardToolbar({
  tool,
  onChange,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}: Props) {
  const [showWheel, setShowWheel] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);

  const set = (patch: Partial<ToolConfig>) => onChange({ ...tool, ...patch });

  // 点击外部关闭轮盘
  useEffect(() => {
    if (!showWheel) return;
    const onDocClick = (e: MouseEvent) => {
      if (wheelRef.current && !wheelRef.current.contains(e.target as Node)) {
        setShowWheel(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showWheel]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.96)',
          borderRadius: 14,
          boxShadow: '0 6px 24px rgba(0,0,0,0.14)',
          border: '1px solid rgba(0,0,0,0.05)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* 工具切换 */}
        <ToolBtn active={tool.activeTool === 'pen'} onClick={() => set({ activeTool: 'pen' })} title="画笔">
          <Pen size={18} />
        </ToolBtn>
        <ToolBtn active={tool.activeTool === 'eraser'} onClick={() => set({ activeTool: 'eraser' })} title="白板擦">
          <Eraser size={18} />
        </ToolBtn>
        <ToolBtn active={tool.activeTool === 'select'} onClick={() => set({ activeTool: 'select' })} title="移除笔迹">
          <MousePointer2 size={18} />
        </ToolBtn>

        <Divider />

        {/* 笔类型(画笔时显示) */}
        {tool.activeTool === 'pen' && (
          <div style={{ display: 'flex', gap: 2 }}>
            {PEN_TYPES.map((p) => (
              <button
                key={p.key}
                onClick={() => set({ penType: p.key })}
                title={p.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  border: 'none',
                  borderRadius: 7,
                  background: tool.penType === p.key ? '#eaf1ff' : 'transparent',
                  color: tool.penType === p.key ? '#2563eb' : '#4b5563',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: tool.penType === p.key ? 600 : 400,
                }}
              >
                {p.icon}
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* 颜色:当前色 + 常用色 + 轮盘按钮 */}
        {tool.activeTool === 'pen' && (
          <>
            <Divider />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, position: 'relative' }} ref={wheelRef}>
              {/* 常用色 */}
              {COMMON_COLORS.map((c) => (
                <ColorDot key={c} color={c} active={tool.color === c} onClick={() => set({ color: c })} />
              ))}
              {/* 轮盘展开按钮 */}
              <button
                onClick={() => setShowWheel((v) => !v)}
                title="更多颜色"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: tool.color !== '' ? '2px solid #cbd5e1' : '2px solid #2563eb',
                  cursor: 'pointer',
                  background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                  padding: 0,
                }}
              />
              {/* 圆形轮盘 */}
              {showWheel && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 34,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 176,
                    height: 176,
                    borderRadius: '50%',
                    background: 'conic-gradient(#ef4444,#f97316,#f59e0b,#84cc16,#22c55e,#10b981,#06b6d4,#0ea5e9,#3b82f6,#6366f1,#8b5cf6,#d946ef,#ec4899,#f43f5e,#ef4444)',
                    boxShadow: '0 8px 28px rgba(0,0,0,0.2)',
                    padding: 16,
                    boxSizing: 'border-box',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      background: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: tool.color,
                        border: '2px solid #e2e8f0',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <Divider />

            {/* 粗细 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="range"
                min={1}
                max={30}
                value={tool.strokeWidth}
                onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
                style={{ width: 70, accentColor: '#2563eb' }}
              />
              <span style={{ fontSize: 11, color: '#7c8494', minWidth: 18 }}>{tool.strokeWidth}</span>
            </div>
          </>
        )}

        {/* 橡皮擦大小 */}
        {tool.activeTool === 'eraser' && (
          <>
            <Divider />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#7c8494' }}>黑板擦</span>
              <input
                type="range"
                min={8}
                max={80}
                value={tool.eraserRadius}
                onChange={(e) => set({ eraserRadius: Number(e.target.value) })}
                style={{ width: 80, accentColor: '#2563eb' }}
              />
              <span style={{ fontSize: 11, color: '#7c8494', minWidth: 18 }}>{tool.eraserRadius}</span>
            </div>
          </>
        )}

        <Divider />

        {/* 撤回 / 重做 / 清空 */}
        <ToolBtn onClick={onUndo} disabled={!canUndo} title="撤回">
          <Undo2 size={18} />
        </ToolBtn>
        <ToolBtn onClick={onRedo} disabled={!canRedo} title="重做">
          <Redo2 size={18} />
        </ToolBtn>
        <button
          onClick={onClear}
          title="清空"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 10px',
            border: 'none',
            borderRadius: 7,
            background: 'transparent',
            color: '#e5484d',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={17} />
          清空
        </button>
      </div>
    </div>
  );
}

function ColorDot({
  color,
  active,
  onClick,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: color,
        border: active ? '2px solid #2563eb' : '1px solid #d5d9e0',
        cursor: 'pointer',
        outline: active ? '2px solid #c7dbff' : 'none',
        outlineOffset: 2,
        padding: 0,
        position: 'relative',
      }}
    >
      {active && color === '#ffffff' && (
        <Check size={12} color="#2563eb" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      )}
      {active && color !== '#ffffff' && (
        <Check size={12} color="#fff" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
      )}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 22, background: '#eef0f3' }} />;
}

function ToolBtn({
  active,
  onClick,
  title,
  disabled,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? '#eaf1ff' : 'transparent',
        color: active ? '#2563eb' : disabled ? '#c3c9d2' : '#4b5563',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}
