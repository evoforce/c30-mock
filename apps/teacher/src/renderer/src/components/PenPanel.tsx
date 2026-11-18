import type { PenType } from '@c30/shared';
import { Brush, Pencil, Highlighter, Check } from 'lucide-react';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

// 画笔设置面板(底部工具条「画笔」菜单):黑色浮层风格,与底部工具栏一致。
// 三行:笔形(毛笔/铅笔/马克笔) + 粗细(4档) + 颜色(两排色块 + 自定义调色板)。
// 尺寸全部按 useOverlayScale 动态缩放(大屏更大更好点),选中项用「实心蓝底 + 白字」
// 与右上角对勾双重标识,老师一眼就能看出当前用的是哪种笔/多粗/什么颜色。

const PEN_TYPES: { key: PenType | 'highlighter'; label: string; Icon: typeof Brush }[] = [
  { key: 'brush', label: '毛笔', Icon: Brush },
  { key: 'pencil', label: '铅笔', Icon: Pencil },
  { key: 'highlighter', label: '马克笔', Icon: Highlighter },
];

// 颜色:两排,第一排基础色,第二排扩展色
const COLORS_ROW1 = ['#ffffff', '#1f2937', '#2563eb', '#16a34a', '#f59e0b', '#e5484d'];
const COLORS_ROW2 = ['#f97316', '#ec4899', '#a855f7', '#84cc16', '#14b8a6', 'custom'];

export interface PenConfig {
  penType: PenType | 'highlighter';
  color: string;
  strokeWidth: number; // 0-3 档(索引),对应 3/6/10/16 px
}

export default function PenPanel({
  config,
  onChange,
}: {
  config: PenConfig;
  onChange: (c: PenConfig) => void;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);
  // 粗细档位映射到具体宽度
  const WIDTH_LEVELS = [3, 6, 10, 16];
  const width = px(400);

  return (
    <div
      style={{
        width,
        maxWidth: 'calc(100vw - 24px)',
        background: '#1b1b1f',
        borderRadius: px(16),
        boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        border: '1px solid #333339',
      }}
    >
      {/* 标题栏:说明这是「再点一次画笔」打开的调整菜单 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${px(12)}px ${px(16)}px`,
          borderBottom: '1px solid #2a2a30',
        }}
      >
        <span style={{ fontSize: px(14), fontWeight: 600, color: '#e5e7eb' }}>画笔设置</span>
        <span style={{ fontSize: px(11), color: '#6b7280' }}>再点一次「画笔」收起</span>
      </div>

      {/* 笔形 */}
      <Row label="笔形" scale={s}>
        <div style={{ display: 'flex', gap: px(12) }}>
          {PEN_TYPES.map((pt) => {
            const selected = config.penType === pt.key;
            const Icon = pt.Icon;
            return (
              <button
                key={pt.key}
                onClick={() => onChange({ ...config, penType: pt.key })}
                title={pt.label}
                style={{
                  width: px(64),
                  height: px(64),
                  borderRadius: px(12),
                  border: selected ? '2px solid #60a5fa' : '1px solid #3a3a40',
                  background: selected ? '#2563eb' : 'rgba(255,255,255,0.03)',
                  color: selected ? '#ffffff' : '#9ca3af',
                  boxShadow: selected ? '0 0 0 2px rgba(37,99,235,0.35)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(4),
                  outline: 'none',
                  padding: 0,
                  transition: 'all .15s ease',
                }}
              >
                <Icon size={px(22)} />
                <span style={{ fontSize: px(12), fontWeight: selected ? 600 : 400 }}>{pt.label}</span>
              </button>
            );
          })}
        </div>
      </Row>

      {/* 粗细 */}
      <Row label="粗细" scale={s}>
        <div style={{ display: 'flex', alignItems: 'center', gap: px(12) }}>
          {WIDTH_LEVELS.map((_, i) => {
            const selected = config.strokeWidth === i;
            return (
              <button
                key={i}
                onClick={() => onChange({ ...config, strokeWidth: i })}
                title={`粗细 ${i + 1} 档`}
                style={{
                  width: px(64),
                  height: px(48),
                  borderRadius: px(10),
                  border: selected ? '2px solid #60a5fa' : '1px solid #3a3a40',
                  background: selected ? '#2563eb' : 'rgba(255,255,255,0.03)',
                  boxShadow: selected ? '0 0 0 2px rgba(37,99,235,0.35)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  outline: 'none',
                  padding: 0,
                  transition: 'all .15s ease',
                }}
              >
                {/* 斜线粗细示意:预览粗细同步缩放 */}
                <svg width={px(34)} height={px(26)} viewBox="0 0 30 24">
                  <line
                    x1="6"
                    y1="20"
                    x2="24"
                    y2="4"
                    stroke={selected ? '#ffffff' : '#9ca3af'}
                    strokeWidth={2 + i * 2}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            );
          })}
        </div>
      </Row>

      {/* 颜色 */}
      <Row label="颜色" scale={s} last>
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(12) }}>
          <div style={{ display: 'flex', gap: px(12) }}>
            {COLORS_ROW1.map((c) => (
              <ColorDot
                key={c}
                color={c}
                selected={config.color === c}
                onClick={() => onChange({ ...config, color: c })}
                scale={s}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: px(12) }}>
            {COLORS_ROW2.map((c) => (
              <ColorDot
                key={c}
                color={c}
                selected={config.color === c}
                onClick={() => onChange({ ...config, color: c })}
                scale={s}
              />
            ))}
          </div>
        </div>
      </Row>
    </div>
  );
}

function Row({
  label,
  children,
  scale,
  last,
}: {
  label: string;
  children: React.ReactNode;
  scale: number;
  last?: boolean;
}) {
  const px = (n: number) => scaled(n, scale);
  return (
    <div
      style={{
        display: 'flex',
        padding: `${px(14)}px ${px(16)}px`,
        borderBottom: last ? 'none' : '1px solid #2a2a30',
        alignItems: 'center',
      }}
    >
      <div style={{ width: px(52), flexShrink: 0, fontSize: px(13), color: '#9ca3af' }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function ColorDot({
  color,
  selected,
  onClick,
  scale,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
  scale: number;
}) {
  const px = (n: number) => scaled(n, scale);
  const size = px(38);
  // 自定义调色板色块
  const isCustom = color === 'custom';
  return (
    <button
      onClick={onClick}
      title={isCustom ? '自定义颜色' : color}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: selected ? `${px(3)}px solid #ffffff` : '1px solid #3a3a40',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        background: isCustom
          ? 'conic-gradient(#ef4444, #f59e0b, #84cc16, #06b6d4, #3b82f6, #a855f7, #ef4444)'
          : color,
        // 选中:白色内环 + 蓝色外发光,深色/浅色面板上都醒目
        boxShadow: selected ? `0 0 0 ${px(3)}px #2563eb, 0 0 0 ${px(5)}px rgba(37,99,235,0.35)` : 'none',
        transform: selected ? 'scale(1.06)' : 'none',
        transition: 'all .14s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 白色色块加边框便于在深色面板上可见 */}
      {color === '#ffffff' && !isCustom && (
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', border: '1px solid #4b5563' }} />
      )}
      {/* 选中对勾 */}
      {selected && !isCustom && (
        <svg
          width={px(18)}
          height={px(18)}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color === '#ffffff' ? '#2563eb' : '#ffffff'}
          strokeWidth="3.2"
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
            width: px(14),
            height: px(14),
            borderRadius: '50%',
            background: '#1b1b1f',
            border: '1px solid #3a3a40',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={px(9)} height={px(9)} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <path
              d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
      {/* 选中态角标:提示这是「当前生效」的设置,防止只看到颜色分不清选中 */}
      {selected && (
        <span
          style={{
            position: 'absolute',
            right: -px(6),
            top: -px(6),
            width: px(16),
            height: px(16),
            borderRadius: '50%',
            background: '#2563eb',
            border: `1.5px solid #ffffff`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Check size={px(10)} color="#fff" strokeWidth={3.5} />
        </span>
      )}
    </button>
  );
}
