import type { PenType, ActiveTool } from '@c30/shared';

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

const COLORS = [
  '#1f2937', '#e5484d', '#2563eb', '#16a34a',
  '#f59e0b', '#7c3aed', '#ec4899', '#ffffff',
];

const PEN_TYPES: { key: PenType; label: string }[] = [
  { key: 'brush', label: '毛笔' },
  { key: 'pen', label: '钢笔' },
  { key: 'pencil', label: '铅笔' },
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
  const set = (patch: Partial<ToolConfig>) => onChange({ ...tool, ...patch });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 16px',
        borderBottom: '1px solid #eef0f3',
        background: '#ffffff',
        flexWrap: 'wrap',
      }}
    >
      {/* 工具切换 */}
      <div style={{ display: 'flex', gap: 4, background: '#f4f6fa', padding: 3, borderRadius: 8 }}>
        <ToolBtn
          active={tool.activeTool === 'pen'}
          onClick={() => set({ activeTool: 'pen' })}
          title="画笔"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" strokeLinejoin="round" />
            </svg>
          }
        />
        <ToolBtn
          active={tool.activeTool === 'eraser'}
          onClick={() => set({ activeTool: 'eraser' })}
          title="白板擦"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M20 20H8l-6-6 9-9 9 9-6 6z" strokeLinejoin="round" />
            </svg>
          }
        />
        <ToolBtn
          active={tool.activeTool === 'select'}
          onClick={() => set({ activeTool: 'select' })}
          title="移除笔迹"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" strokeLinejoin="round" />
            </svg>
          }
        />
      </div>

      <Divider />

      {/* 笔类型(仅画笔工具时显示) */}
      {tool.activeTool === 'pen' && (
        <>
          <div style={{ display: 'flex', gap: 4 }}>
            {PEN_TYPES.map((p) => (
              <button
                key={p.key}
                onClick={() => set({ penType: p.key })}
                style={{
                  padding: '5px 12px',
                  border: tool.penType === p.key ? '1.5px solid #2563eb' : '1px solid #e2e5ea',
                  borderRadius: 6,
                  background: tool.penType === p.key ? '#eaf1ff' : '#fff',
                  color: tool.penType === p.key ? '#2563eb' : '#4b5563',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Divider />

          {/* 颜色 */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => set({ color: c })}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: c,
                  border: tool.color === c ? '2px solid #2563eb' : '1px solid #d5d9e0',
                  cursor: 'pointer',
                  outline: tool.color === c ? '2px solid #c7dbff' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>

          <Divider />

          {/* 粗细 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#7c8494' }}>粗细</span>
            <input
              type="range"
              min={1}
              max={30}
              value={tool.strokeWidth}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
              style={{ width: 90, accentColor: '#2563eb' }}
            />
            <span style={{ fontSize: 12, color: '#4b5563', minWidth: 20 }}>
              {tool.strokeWidth}
            </span>
          </div>
        </>
      )}

      {/* 橡皮擦大小 */}
      {tool.activeTool === 'eraser' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#7c8494' }}>黑板擦大小</span>
          <input
            type="range"
            min={8}
            max={80}
            value={tool.eraserRadius}
            onChange={(e) => set({ eraserRadius: Number(e.target.value) })}
            style={{ width: 90, accentColor: '#2563eb' }}
          />
          <span style={{ fontSize: 12, color: '#4b5563', minWidth: 20 }}>
            {tool.eraserRadius}
          </span>
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <ToolBtn active={false} onClick={onUndo} disabled={!canUndo} title="撤回" icon={<IconUndo />} />
        <ToolBtn active={false} onClick={onRedo} disabled={!canRedo} title="重做" icon={<IconRedo />} />
        <button
          onClick={onClear}
          style={{
            padding: '6px 12px',
            border: '1px solid #e2e5ea',
            borderRadius: 6,
            background: '#fff',
            color: '#e5484d',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          清空
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 24, background: '#eef0f3' }} />;
}

function ToolBtn({
  active,
  onClick,
  title,
  icon,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        borderRadius: 7,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? '#eaf1ff' : 'transparent',
        color: active ? '#2563eb' : disabled ? '#c3c9d2' : '#4b5563',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
    </button>
  );
}

function IconUndo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7v6h6M3 13a9 9 0 109-9 9 9 0 00-8.5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 7v6h-6M21 13a9 9 0 11-9-9 9 9 0 018.5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
