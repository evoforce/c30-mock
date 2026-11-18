import { useEffect, useRef } from 'react';

// 鼠标穿透控制：全屏透明窗口默认穿透到桌面（可操作桌面），
// 仅当鼠标悬停在带 [data-interactive] 标记的容器上时才恢复交互。
//
// 原理：主进程 setIgnoreMouseEvents(true, { forward: true }) 后，
// mousemove 事件仍会转发到渲染层（forward），据此实时判断是否命中可交互区域。
// 白板/画笔等全屏交互场景，通过 `lockedRef` 强制 interactive=true 临时关闭穿透。
export default function usePointerPassthrough(locked: boolean) {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const setInteractive = (window as any).api?.pointer?.setInteractive;
    if (!setInteractive) return;

    const isInteractiveEl = (el: EventTarget | null): boolean => {
      if (!(el instanceof Element)) return false;
      return el.closest('[data-interactive]') != null;
    };

    let lastState: boolean | null = null;

    const apply = (next: boolean) => {
      if (next !== lastState) {
        lastState = next;
        setInteractive(next);
      }
    };

    // 锁定（白板/画笔）时强制全屏交互
    if (lockedRef.current) {
      apply(true);
    }

    const onMove = (e: MouseEvent) => {
      const interactive = lockedRef.current || isInteractiveEl(e.target);
      apply(interactive);
    };

    window.addEventListener('mousemove', onMove, true);
    return () => {
      window.removeEventListener('mousemove', onMove, true);
    };
  }, []);

  // locked 变化时立即同步穿透状态
  useEffect(() => {
    const setInteractive = (window as any).api?.pointer?.setInteractive;
    setInteractive?.(locked);
  }, [locked]);
}
