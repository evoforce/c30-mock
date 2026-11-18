import { useEffect, useState } from 'react';

// 浮层统一动态缩放
// -----------------------------------------------------------------------------
// 教室里的电脑分辨率差异很大:1080p 笔记本、2.5K 一体机、4K 大屏/电视都有。
// 浮层若写死像素(52px 按钮),在 4K 屏上会小得像一粒芝麻,老师站在讲台上点不中。
// 因此所有浮层尺寸都乘一个「视口比例」:以 1600×900 为基准设计,窗口越大浮层越大。
//   · 1280×720  → 1.00 倍(最小 1 倍,小屏不会越缩越小)
//   · 1920×1080 → 1.20 倍
//   · 2560×1440 → 1.60 倍
//   · 3840×2160 → 2.00 倍(上限 2 倍,避免按钮大到挤不下)
// Electron 的主窗口铺满主显示器,窗口 CSS 像素即显示器 DIP 尺寸,故直接用视口计算。

const BASE_WIDTH = 1600;
const BASE_HEIGHT = 900;
const MIN_SCALE = 1;
const MAX_SCALE = 2;

/** 根据视口尺寸计算浮层缩放倍率(纯函数,便于单测/复用)。 */
export function computeOverlayScale(width: number, height: number): number {
  if (!width || !height) return MIN_SCALE;
  const raw = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  // 保留两位小数:避免 1.3333333 这类值让像素出现半像素毛边
  return Math.round(clamped * 100) / 100;
}

/** 订阅窗口尺寸变化,返回当前浮层缩放倍率。 */
export default function useOverlayScale(): number {
  const [scale, setScale] = useState(() =>
    typeof window === 'undefined'
      ? MIN_SCALE
      : computeOverlayScale(window.innerWidth, window.innerHeight),
  );

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setScale(computeOverlayScale(window.innerWidth, window.innerHeight));
      });
    };
    window.addEventListener('resize', update);
    // 显示器 DPI/分辨率切换后,窗口尺寸可能没触发 resize,补一次延迟校准
    const timer = setTimeout(update, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener('resize', update);
    };
  }, []);

  return scale;
}

/** 按缩放倍率换算像素(四舍五入,避免半像素模糊)。 */
export function scaled(px: number, scale: number): number {
  return Math.round(px * scale);
}
