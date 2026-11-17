import type { PenType } from '@c30/shared';
import { Brush, Pencil, Highlighter } from 'lucide-react';

// 画笔设置面板:对齐 C30 形态(白色圆角悬浮面板)
// 三行:笔形(毛笔/铅笔/马克笔) + 粗细(4档) + 颜色(两排色块 + 自定义调色板)

const PEN_TYPES: { key: PenType | 'highlighter'; label: string; icon: React.ReactNode }[] = [
  { key: 'brush', label: '毛笔', icon: <Brush size={20} /> },
  { key: 'pencil', label: '铅笔', icon: <Pencil size={20} /> },
  { key: 'highlighter', label: '马克笔', icon: <Highlighter size={20} /> },
];

// 颜色:两排,第一排基础色,第二排扩展色(对齐 C30 截图)
const COLORS_ROW1 = ['#ffffff', '#1f2937', '#2563eb', '#16a34a', '#f59e0b', '#e5484d'];
const COLORS_ROW2 = ['#f97316', '#ec4899', '#a855f7', '#84cc16', '#14b8a6', 'custom'];

export interface PenConfig {
  penType: PenType | 'highlighter';
  color: string;
  strokeWidth: number; // 1-4 档
}

export default function PenPanel({
  config,
  onChange,
  onClose,
}: {
  config: PenConfig;
  onChange: (c: PenConfig) => void;
  onClose: () => void;
}) {
  // 粗细档位映射到具体宽度
  const WIDTH_LEVELS = [3, 6, 10, 16];

  return (
    <div
      style={{
        width: 420,
        background: '#ffffff',
        borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
        overflow: 'hidden',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, color: '#6b7280' }}>画笔</span>
        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            width: 26,
            height: 26,
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: '#9aa1ac',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* 笔形 */}
      <Row label="笔形">
        <div style={{ display: 'flex', gap: 12 }}>
          {PEN_TYPES.map((pt) => (
            <button
              key={pt.key}
              onClick={() => onChange({ ...config, penType: pt.key })}
              style={{
                width: 52,
                height: 52,
                borderRadius: 10,
                border: config.penType === pt.key ? '2px solid #2563eb' : '1px solid #e2e5ea',
                background: config.penType === pt.key ? '#eff6ff' : '#fff',
                color: config.penType === pt.key ? '#2563eb' : '#6b7280',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                outline: 'none',
                padding: 0,
              }}
            >
              {pt.icon}
              <span style={{ fontSize: 11 }}>{pt.label}</span>
            </button>
          ))}
        </div>
      </Row>

      {/* 粗细 */}
      <Row label="粗细">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {WIDTH_LEVELS.map((w, i) => (
            <button
              key={i}
              onClick={() => onChange({ ...config, strokeWidth: i })}
              style={{
                width: 52,
                height: 40,
                borderRadius: 8,
                border: config.strokeWidth === i ? '2px solid #2563eb' : '1px solid #e2e5ea',
                background: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: 'none',
                padding: 0,
              }}
            >
              {/* 斜线粗细示意 */}
              <svg width="30" height="24" viewBox="0 0 30 24">
                <line
                  x1="6"
                  y1="20"
                  x2="24"
                  y2="4"
                  stroke={config.strokeWidth === i ? '#2563eb' : '#9aa1ac'}
                  strokeWidth={2 + i * 2}
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ))}
        </div>
      </Row>

      {/* 颜色 */}
      <Row label="颜色">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {COLORS_ROW1.map((c) => (
              <ColorDot key={c} color={c} selected={config.color === c} onClick={() => onChange({ ...config, color: c })} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {COLORS_ROW2.map((c) => (
              <ColorDot key={c} color={c} selected={config.color === c} onClick={() => onChange({ ...config, color: c })} />
            ))}
          </div>
        </div>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        padding: '14px 16px',
        borderBottom: '1px solid #f0f2f5',
      }}
    >
      <div style={{ width: 48, flexShrink: 0, fontSize: 13, color: '#6b7280', paddingTop: 12 }}>
        {label}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function ColorDot({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  // 自定义调色板色块
  const isCustom = color === 'custom';
  return (
    <button
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        border: selected ? '2px solid #2563eb' : '1px solid #e2e5ea',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        background: isCustom
          ? 'conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #3b82f6, #a855f7, #ef4444)'
          : color,
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 白色色块加边框便于在浅色面板上可见 */}
      {color === '#ffffff' && !isCustom && (
        <div style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #d5d9e0' }} />
      )}
      {/* 选中对勾 */}
      {selected && !isCustom && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={color === '#ffffff' ? '#2563eb' : '#ffffff'}
          strokeWidth="3"
          style={{ position: 'absolute' }}
        >
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {/* 自定义色块加调色盘小角标 */}
      {isCustom && (
        <div
          style={{
            position: 'absolute',
            right: -3,
            bottom: -3,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#fff',
            border: '1px solid #e2e5ea',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </button>
  );
}
