import { Brush, Eraser } from 'lucide-react';
import type { EraserMode } from '@c30/shared';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import { ERASER_ASPECT } from '../lib/eraser';

// 板擦设置(底部工具条「板擦」再点一次打开的高级菜单)
// -----------------------------------------------------------------------------
// 与画笔面板同款黑色浮层。三块内容:
//   ① 板擦大小:4 档,预览从圆形改成「矩形板擦」,和真实擦除区域一致(所见即所擦);
//   ② 擦除方式:清笔迹(碰到整条清除)/ 区域擦除(像画笔一样涂抹,只擦相交部分);
//   ③ 操作提示:按住左键拖动即可连续擦除(不用一下一下点)。
// 尺寸全部按 useOverlayScale 缩放,大屏上更好点。

/** 板擦半径档位(逻辑像素;实际擦除区域按此换算,见 lib/eraser.ts) */
export const ERASER_RADIUS_LEVELS = [16, 24, 36, 52] as const;
export const DEFAULT_ERASER_RADIUS = 24;
/** 默认擦除方式:清笔迹(与历史行为一致,最直观) */
export const DEFAULT_ERASER_MODE: EraserMode = 'stroke';

const ERASER_MODES: { key: EraserMode; label: string; desc: string; Icon: typeof Eraser }[] = [
  {
    key: 'stroke',
    label: '清笔迹',
    desc: '碰到笔迹整条清除',
    Icon: Eraser,
  },
  {
    key: 'area',
    label: '区域擦除',
    desc: '像画笔一样涂抹，只擦掉相交部分',
    Icon: Brush,
  },
];

export default function EraserPanel({
  radius,
  onChange,
  mode,
  onModeChange,
}: {
  radius: number;
  onChange: (radius: number) => void;
  mode: EraserMode;
  onModeChange: (mode: EraserMode) => void;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  return (
    <div
      style={{
        width: px(360),
        maxWidth: 'calc(100vw - 24px)',
        background: '#1b1b1f',
        borderRadius: px(16),
        boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        border: '1px solid #333339',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${px(12)}px ${px(16)}px`,
          borderBottom: '1px solid #2a2a30',
        }}
      >
        <span style={{ fontSize: px(14), fontWeight: 600, color: '#e5e7eb' }}>板擦设置</span>
        <span style={{ fontSize: px(11), color: '#6b7280' }}>再点一次「板擦」收起</span>
      </div>

      {/* 板擦大小 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(10),
          padding: `${px(14)}px ${px(16)}px`,
          borderBottom: '1px solid #2a2a30',
        }}
      >
        <span style={{ fontSize: px(13), color: '#9ca3af' }}>板擦大小</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: px(12) }}>
          {ERASER_RADIUS_LEVELS.map((r, i) => {
            const selected = radius === r;
            // 预览尺寸等比:宽度约为档位值的 1.1 倍,高度按板擦真实比例
            const w = Math.round(r * 1.1 * s);
            const h = Math.max(8, Math.round(w * ERASER_ASPECT));
            return (
              <button
                key={r}
                onClick={() => onChange(r)}
                title={`板擦 ${i + 1} 档`}
                style={{
                  flex: 1,
                  height: px(64),
                  borderRadius: px(12),
                  border: selected ? '2px solid #60a5fa' : '1px solid #3a3a40',
                  background: selected ? '#2563eb' : 'rgba(255,255,255,0.03)',
                  boxShadow: selected ? '0 0 0 2px rgba(37,99,235,0.35)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(6),
                  outline: 'none',
                  padding: 0,
                  transition: 'all .15s ease',
                }}
              >
                {/* 矩形板擦示意(和擦除区域同比例,不再是圆圈) */}
                <span
                  style={{
                    width: w,
                    height: h,
                    borderRadius: px(3),
                    border: `2px solid ${selected ? '#ffffff' : '#9ca3af'}`,
                    background: selected ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)',
                    boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.12)',
                    display: 'block',
                  }}
                />
                <span style={{ fontSize: px(11), fontWeight: selected ? 600 : 400 }}>{i + 1} 档</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 擦除方式 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(10),
          padding: `${px(14)}px ${px(16)}px`,
        }}
      >
        <span style={{ fontSize: px(13), color: '#9ca3af' }}>擦除方式</span>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: px(12) }}>
          {ERASER_MODES.map((m) => {
            const selected = mode === m.key;
            const Icon = m.Icon;
            return (
              <button
                key={m.key}
                onClick={() => onModeChange(m.key)}
                title={`${m.label}：${m.desc}`}
                style={{
                  flex: 1,
                  minHeight: px(76),
                  borderRadius: px(12),
                  border: selected ? '2px solid #60a5fa' : '1px solid #3a3a40',
                  background: selected ? '#2563eb' : 'rgba(255,255,255,0.03)',
                  boxShadow: selected ? '0 0 0 2px rgba(37,99,235,0.35)' : 'none',
                  cursor: 'pointer',
                  color: selected ? '#ffffff' : '#9ca3af',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(5),
                  padding: `${px(10)}px ${px(8)}px`,
                  outline: 'none',
                  transition: 'all .15s ease',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: px(6) }}>
                  <Icon size={px(18)} />
                  <span style={{ fontSize: px(13), fontWeight: selected ? 600 : 400 }}>{m.label}</span>
                </span>
                <span
                  style={{
                    fontSize: px(11),
                    lineHeight: 1.35,
                    textAlign: 'center',
                    color: selected ? 'rgba(255,255,255,0.85)' : '#6b7280',
                  }}
                >
                  {m.desc}
                </span>
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: px(11), color: '#6b7280', lineHeight: 1.4 }}>
          按住鼠标左键拖动即可连续擦除；板擦只在按下时出现。
        </span>
      </div>
    </div>
  );
}
