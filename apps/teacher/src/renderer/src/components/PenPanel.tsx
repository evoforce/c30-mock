import type { PenType } from '@c30/shared';
import { Brush, Pencil, Highlighter } from 'lucide-react';

// 画笔设置面板:黑色浮层风格(与底部工具栏一致),替代白色控件。
// 三行:笔形(毛笔/铅笔/马克笔) + 粗细(4档) + 颜色(两排色块 + 自定义调色板)

const PEN_TYPES: { key: PenType | 'highlighter'; label: string; icon: React.ReactNode }[] = [
  { key: 'brush', label: '毛笔', icon: <Brush size={20} /> },
  { key: 'pencil', label: '铅笔', icon: <Pencil size={20} /> },
  { key: 'highlighter', label: '马克笔', icon: <Highlighter size={20} /> },
];

// 颜色:两排,第一排基础色,第二排扩展色
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
}: {
  config: PenConfig;
  onChange: (c: PenConfig) => void;
}) {
  // 粗细档位映射到具体宽度
  const WIDTH_LEVELS = [3, 6, 10, 16];

  return (
    <div
      style={{
        width: 440,
        background: '#1b1b1f',
        borderRadius: 16,
        boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        border: '1px solid #333339',
      }}
    >
      {/* 笔形 */}
      <Row label="笔形">
        <div style={{ display: 'flex', gap: 12 }}>
          {PEN_TYPES.map((pt) => (
            <button
              key={pt.key}
              onClick={() => onChange({ ...config, penType: pt.key })}
              style={{
                width: 60,
                height: 60,
                borderRadius: 12,
                border: config.penType === pt.key ? '2px solid #3b82f6' : '1px solid #3a3a40',
                background: config.penType === pt.key ? 'rgba(59,130,246,0.18)' : 'transparent',
                color: config.penType === pt.key ? '#60a5fa' : '#9ca3af',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                outline: 'none',
                padding: 0,
              }}
            >
              {pt.icon}
              <span style={{ fontSize: 12 }}>{pt.label}</span>
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
                width: 60,
                height: 44,
                borderRadius: 10,
                border: config.strokeWidth === i ? '2px solid #3b82f6' : '1px solid #3a3a40',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: 'none',
                padding: 0,
              }}
            >
              {/* 斜线粗细示意 */}
              <svg width="34" height="26" viewBox="0 0 30 24">
                <line
                  x1="6"
                  y1="20"
                  x2="24"
                  y2="4"
                  stroke={config.strokeWidth === i ? '#60a5fa' : '#9ca3af'}
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
        borderBottom: '1px solid #2a2a30',
      }}
    >
      <div style={{ width: 48, flexShrink: 0, fontSize: 13, color: '#9ca3af', paddingTop: 14 }}>
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
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: selected ? '2px solid #3b82f6' : '1px solid #3a3a40',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        background: isCustom
          ? 'conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #3b82f6, #a855f7, #ef4444)'
          : color,
        outline: selected ? '2px solid #3b82f6' : 'none',
        outlineOffset: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 白色色块加边框便于在深色面板上可见 */}
      {color === '#ffffff' && !isCustom && (
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #4b5563' }} />
      )}
      {/* 选中对勾 */}
      {selected && !isCustom && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={color === '#ffffff' ? '#3b82f6' : '#ffffff'}
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
            background: '#1b1b1f',
            border: '1px solid #3a3a40',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </button>
  );
}
