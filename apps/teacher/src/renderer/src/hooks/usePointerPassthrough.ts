import { useCallback, useEffect, useRef } from 'react';

// 鼠标穿透控制:全屏透明窗口默认穿透到桌面(可操作桌面),
// 仅当鼠标悬停在带 [data-interactive] 标记的容器上时才恢复交互;
// 白板/聚焦等全屏场景用 locked 强制交互。
//
// 踩坑点:穿透状态只能保留「一份」真源(lastStateRef),锁定切换与 hover 检测必须共用。
// 否则两者各存一份缓存,主进程的实际状态会和渲染层缓存失同步——主进程已切到穿透态,
// 渲染层却「以为自己已经是交互态」而不再上报,浮层/工具栏就永久点不动
// (聚焦层保存/关闭、白板退出后最易复现)。
//
// 另一层兜底:forward 转发在窗口 hide→show、GPU 进程重建后可能静默失效(不再转发
// mousemove),因此主进程会主动推送鼠标位置,渲染层用 elementFromPoint 自行判定悬停。
export default function usePointerPassthrough(locked: boolean) {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  // 渲染层已上报给主进程的穿透状态(唯一真源,锁定切换与 hover 共用)
  const lastStateRef = useRef<boolean | null>(null);
  // 最近一次鼠标位置(CSS 像素):解除锁定时用它重新判定,不必等下一次 mousemove
  // (关闭原生对话框后鼠标通常停在按钮上不动)
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  const apply = useCallback((next: boolean) => {
    if (next === lastStateRef.current) return;
    lastStateRef.current = next;
    (window as any).api?.pointer?.setInteractive?.(next);
  }, []);

  // 某坐标是否落在可交互组件上。elementFromPoint 会跳过 pointer-events:none 的元素,
  // 与真实点击的命中结果一致。
  const interactiveAt = useCallback((x: number, y: number): boolean => {
    if (lockedRef.current) return true;
    const el = document.elementFromPoint(x, y);
    return el != null && el.closest('[data-interactive]') != null;
  }, []);

  // ① 悬停检测:forward 转发的 mousemove + 主进程推送的鼠标位置(兜底)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      const target = e.target;
      const hoverInteractive = target instanceof Element && target.closest('[data-interactive]') != null;
      apply(lockedRef.current || hoverInteractive);
    };
    window.addEventListener('mousemove', onMove, true);

    const offSync = (window as any).api?.pointer?.onSyncCursor?.(
      (p: { x: number; y: number }) => {
        cursorRef.current = p;
        apply(interactiveAt(p.x, p.y));
      },
    );

    return () => {
      window.removeEventListener('mousemove', onMove, true);
      offSync?.();
    };
  }, [apply, interactiveAt]);

  // ② 锁定状态切换立即同步:进入白板/聚焦 → 强制全屏交互;
  // 退出锁定 → 按当前鼠标位置重新判定。不能直接 apply(false):鼠标此刻若停在
  // 工具栏上,会把工具栏锁死成穿透态(点不动)。
  useEffect(() => {
    if (locked) {
      apply(true);
      return;
    }
    const cursor = cursorRef.current;
    apply(cursor ? interactiveAt(cursor.x, cursor.y) : false);
  }, [locked, apply, interactiveAt]);
}
