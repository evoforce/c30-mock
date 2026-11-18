import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import { ERASER_ASPECT } from '../lib/eraser';

// 板擦设置(底部工具条「板擦」再点一次打开的高级菜单)
// -----------------------------------------------------------------------------
// 与画笔面板同款黑色浮层,只保留一件事:**板擦大小**(4 档,预览是矩形板擦,
// 和真实擦除区域同比例,所见即所擦)+ 一行操作提示。
//
// 擦除语义已收敛为**自由擦除**(涂到哪擦到哪,只擦掉相交部分):
// 原来的「清笔迹 / 区域擦除」两个选项被移除,不再让老师在两类语义之间做选择。
// 尺寸整体比旧版大一号(最小档也够擦),大屏上更顺手;文字统一用浅灰(#9ca3af /
// #cbd5e1 / 选中 #ffffff),避免出现深色默认字被黑色面板吞掉、看不清的问题。

/** 板擦半径档位(逻辑像素;实际擦除区域按此换算,见 lib/eraser.ts)。
 *  整体比旧版(16/24/36/52)大一号:最小档也要够擦,老师站着也能看到板擦。 */
export const ERASER_RADIUS_LEVELS = [28, 40, 56, 72] as const;
export const DEFAULT_ERASER_RADIUS = 40;

export default function EraserPanel({
  radius,
  onChange,
}: {
  radius: number;
  onChange: (radius: number) => void;
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
        <span style={{ fontSize: px(11), color: '#9ca3af' }}>再点一次「板擦」收起</span>
      </div>

      {/* 板擦大小(4 档,整体比旧版大一号) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(10),
          padding: `${px(14)}px ${px(16)}px`,
        }}
      >
        <span style={{ fontSize: px(13), color: '#9ca3af' }}>板擦大小</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: px(12) }}>
          {ERASER_RADIUS_LEVELS.map((r, i) => {
            const selected = radius === r;
            // 预览按真实板擦比例缩放(等比缩到按钮里):宽度 ≈ 0.55 × 半径,
            // 高度 = 宽度 × 板擦高宽比;四档大小差异一眼可辨,选中时蓝底仍露得出来
            const w = Math.round(r * 0.55 * s);
            const h = Math.max(8, Math.round(w * ERASER_ASPECT));
            return (
              <button
                key={r}
                onClick={() => onChange(r)}
                title={`板擦 ${i + 1} 档`}
                style={{
                  flex: 1,
                  height: px(76),
                  borderRadius: px(12),
                  border: selected ? '2px solid #60a5fa' : '1px solid #3a3a40',
                  background: selected ? '#2563eb' : 'rgba(255,255,255,0.03)',
                  boxShadow: selected ? '0 0 0 2px rgba(37,99,235,0.35)' : 'none',
                  // 文字颜色必须显式指定:按钮默认黑色字在黑色面板上看不见
                  color: selected ? '#ffffff' : '#cbd5e1',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(8),
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
                    border: `2px solid ${selected ? '#ffffff' : '#cbd5e1'}`,
                    background: selected ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.1)',
                    boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.12)',
                    display: 'block',
                  }}
                />
                <span style={{ fontSize: px(12), fontWeight: selected ? 600 : 400 }}>{i + 1} 档</span>
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: px(12), color: '#9ca3af', lineHeight: 1.45 }}>
          按住鼠标左键拖动即可连续擦除；板擦只在按下时出现，涂到哪擦到哪。
        </span>
      </div>
    </div>
  );
}
