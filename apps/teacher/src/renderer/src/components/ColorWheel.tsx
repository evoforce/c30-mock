import { useEffect, useRef, useState } from 'react';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

// 画笔「颜色」里的颜色盘(自定义取色)。
//   · 圆盘:角度 = 色相(红/黄/绿/青/蓝/品红),半径 = 饱和度(圆心白、边缘纯色);
//   · 右侧竖条:明度(上亮下黑),圆盘整体用一层黑色遮罩压暗,所见即所选;
//   · 点击 / 按住拖动都实时回写 #RRGGBB 给画笔配置;
//   · 圆盘用纯 CSS 渐变绘制(conic + radial),不用 canvas —— 浮层反复开合也不会掉帧。
//
// 背景:此前「颜色」区最后那个彩虹色块是个占位,点它只会把 color 写成字符串 'custom',
// 白板拿到的不是合法颜色,等于颜色盘没实现。这里补上真正的取色盘。

interface HSV {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** HSV → #rrggbb(h∈[0,360), s/v∈[0,1]) */
export function hsvToHex(h: number, s: number, v: number): string {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  const hex = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n + m)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** #rrggbb → HSV;不是合法 6 位十六进制时返回 null */
export function hexToHsv(hex: string): HSV | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export default function ColorWheel({
  color,
  onChange,
}: {
  /** 当前颜色(#rrggbb);变化时同步圆盘光标 */
  color: string;
  /** 取色回调,实时给出 #rrggbb */
  onChange: (hex: string) => void;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(color) ?? { h: 275, s: 0.7, v: 0.85 });
  // 自己刚发出的颜色不回灌状态:否则取整后的 hex 再解析回来会让光标抖动
  const emittedRef = useRef('');

  useEffect(() => {
    if (color.trim().toLowerCase() === emittedRef.current) return;
    const parsed = hexToHsv(color);
    if (parsed) setHsv(parsed);
  }, [color]);

  const commit = (next: HSV) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    emittedRef.current = hex;
    onChange(hex);
  };

  const wheelRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLDivElement>(null);

  const pickWheel = (clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const radius = Math.max(1, rect.width / 2);
    // CSS conic 渐变从正上方(12 点)开始顺时针:atan2(dx, -dy) 正好对应同一角度
    const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    commit({ ...hsv, h: hue, s: clamp01(Math.hypot(dx, dy) / radius) });
  };

  const pickValue = (_clientX: number, clientY: number) => {
    const el = valueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    commit({ ...hsv, v: clamp01(1 - (clientY - rect.top) / Math.max(1, rect.height)) });
  };

  // 按下即取色,并持续跟随拖动(用 window 监听,拖到面板外也不断)
  const startDrag =
    (handler: (x: number, y: number) => void) => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handler(e.clientX, e.clientY);
      const onMove = (ev: PointerEvent) => handler(ev.clientX, ev.clientY);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

  const wheelSize = px(158);
  const markerSize = px(18);
  const valueKnobW = px(32);
  const valueKnobH = px(14);
  // 光标半径留出半个光标位,避免贴边时被圆盘裁掉
  const markerRadius = Math.max(0, hsv.s * (wheelSize / 2 - markerSize / 2 - px(1)));
  const markerAngle = (hsv.h * Math.PI) / 180;
  const markerX = Math.sin(markerAngle) * markerRadius;
  const markerY = -Math.cos(markerAngle) * markerRadius;
  const solid = hsvToHex(hsv.h, hsv.s, 1);
  const current = hsvToHex(hsv.h, hsv.s, hsv.v);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: px(16) }}>
      {/* 色相 / 饱和度圆盘 */}
      <div
        ref={wheelRef}
        onPointerDown={startDrag(pickWheel)}
        title="色相 / 饱和度"
        style={{
          position: 'relative',
          width: wheelSize,
          height: wheelSize,
          borderRadius: '50%',
          cursor: 'crosshair',
          touchAction: 'none',
          background:
            // 圆心白 → 边缘纯色:closest-side 让白色渐变正好收在圆盘边缘,
            // 这样「视觉上的饱和度」与取到的 s 完全一致(所见即所选)
            'radial-gradient(circle closest-side at 50% 50%, #ffffff 0%, rgba(255,255,255,0) 100%), ' +
            'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14), 0 2px 10px rgba(0,0,0,0.35)',
        }}
      >
        {/* 明度压暗层(不拦指针,拖拽仍由圆盘处理) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: '#000000',
            opacity: 1 - hsv.v,
            pointerEvents: 'none',
          }}
        />
        {/* 当前色光标 */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: markerSize,
            height: markerSize,
            marginLeft: -markerSize / 2,
            marginTop: -markerSize / 2,
            transform: `translate(${markerX}px, ${markerY}px)`,
            borderRadius: '50%',
            border: `${px(2)}px solid #ffffff`,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* 明度滑杆 */}
      <div
        ref={valueRef}
        onPointerDown={startDrag(pickValue)}
        title="明度"
        style={{
          position: 'relative',
          width: px(24),
          height: wheelSize,
          borderRadius: px(12),
          cursor: 'ns-resize',
          touchAction: 'none',
          background: `linear-gradient(to top, #000000 0%, ${solid} 100%)`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: valueKnobH / 2 + (1 - hsv.v) * (wheelSize - valueKnobH),
            width: valueKnobW,
            height: valueKnobH,
            transform: 'translate(-50%, -50%)',
            borderRadius: px(7),
            border: `${px(2)}px solid #ffffff`,
            background: solid,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* 预览 + 色值 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(8) }}>
        <span
          aria-hidden
          style={{
            width: px(48),
            height: px(48),
            borderRadius: px(10),
            background: current,
            border: '1px solid rgba(255,255,255,0.25)',
            boxShadow: '0 0 0 2px rgba(0,0,0,0.25)',
          }}
        />
        <span
          style={{
            fontSize: px(11),
            color: '#cbd5e1',
            fontFamily: 'Consolas, "Courier New", monospace',
            letterSpacing: 0.4,
          }}
        >
          {current.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
