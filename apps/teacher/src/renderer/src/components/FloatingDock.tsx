import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SessionMember, User } from '@c30/shared';
import {
  Presentation,
  Menu,
  Monitor,
  LayoutGrid,
  Wifi,
  Users,
  UsersRound,
  MousePointer2,
  Pen,
  Eraser,
  MessageSquareText,
  Focus,
  Settings,
  Info,
  Power,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  Undo2,
  Redo2,
  Trash2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useDragAnywhere } from '../hooks/useDragAnywhere';
import { overlayIn } from '../lib/overlayAnim';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import PenPanel, { type PenConfig } from './PenPanel';
import EraserPanel from './EraserPanel';
import ColorWheel from './ColorWheel';
import InteractPanel from './InteractPanel';
import type { InteractController } from '../hooks/useInteract';

// C30 风格的桌面悬浮黑色组件:竖排导航(可左右贴边) + 右上角状态 + 底部工具条。
// 竖条左右两侧各有一个折叠箭头(对应同一个组件),老师站在教室任一侧都能点开。
// 所有浮层尺寸都按 useOverlayScale 动态缩放:屏幕越大浮层越大,讲台边上也能一次点中。

interface NavItem {
  key: string;
  label: string;
  Icon: LucideIcon;
}

// 发送端(教师端)导航:白板 + 窗口(其余移除)
// 「上课/下课」不再走导航切换,而是头像下方的独立矩形按钮(上课中点一次即下课并计时)
// 「窗口」点击后弹出面板:顶部「回到电脑桌面」按钮 + 窗口列表(C30 对齐)
const TEACHER_NAV: NavItem[] = [
  { key: 'whiteboard', label: '白板', Icon: Presentation },
  { key: 'windows', label: '窗口', Icon: LayoutGrid },
];

// 上课计时:秒 → mm:ss(允许分钟超过 99,不截断,课堂再长也不会回绕)
function formatClassElapsed(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// 接收端(学生端)导航:极简,仅状态展示
const STUDENT_NAV: NavItem[] = [{ key: 'whiteboard', label: '画面', Icon: Presentation }];

type DockMenuKey = 'settings' | 'about' | 'exit';
// 侧边栏「菜单」的第一层弹出菜单:设置 / 关于 / 退出。
// 交互约定:点侧边栏「菜单」(或头像)只弹这一层小浮层;点「设置」才打开居中的系统设置面板,
// 「关于」展示版本信息,「退出」二次确认后退出应用。
const DOCK_MENU_ITEMS: { key: DockMenuKey; label: string; Icon: LucideIcon; danger?: boolean }[] = [
  { key: 'settings', label: '设置', Icon: Settings },
  { key: 'about', label: '关于', Icon: Info },
  { key: 'exit', label: '退出', Icon: Power, danger: true },
];

interface ToolItem {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** 该工具是否有「更多」菜单(有则按钮右上角显示展开角标) */
  menu?: 'pen' | 'eraser' | 'interact';
}

// 底部工具栏:选择/画笔/板擦/互动/聚焦。
// 交互约定:第一次点击 = 切换到该功能;再次点击已激活且带菜单的工具 = 展开/收起调整菜单。
// 「互动」不是绘制工具而是一块面板:点一下直接展开/收起互动面板,不改变当前画笔。
const TOOLBAR: ToolItem[] = [
  { key: 'select', label: '选择', Icon: MousePointer2 },
  { key: 'pen', label: '画笔', Icon: Pen, menu: 'pen' },
  { key: 'eraser', label: '板擦', Icon: Eraser, menu: 'eraser' },
  { key: 'interact', label: '互动', Icon: MessageSquareText, menu: 'interact' },
  { key: 'focus', label: '聚焦', Icon: Focus },
];

export default function FloatingDock({
  role,
  active,
  onChange,
  classStartedAt,
  onToggleClass,
  user,
  onLogout,
  memberCount,
  networkStatus,
  settings,
  onSettingsChange,
}: {
  role: 'TEACHER' | 'STUDENT';
  active: string;
  onChange: (key: string) => void;
  /** 本次上课开始时间戳;null = 未上课。状态由 TeacherWorkspace 持有(需同步服务端) */
  classStartedAt: number | null;
  /** 点「上课/下课」:由 TeacherWorkspace 更新状态并广播 class.start / class.end */
  onToggleClass: () => void;
  user: User;
  onLogout: () => void;
  memberCount: number;
  networkStatus: 'direct' | 'relay' | '';
  settings: { autoLaunch: boolean; showClassInfo: boolean; allowInteraction: boolean };
  onSettingsChange: (patch: Partial<{ autoLaunch: boolean; showClassInfo: boolean; allowInteraction: boolean }>) => void;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  // 侧边栏「菜单」的第一层浮层(设置/关于/退出)是否展开
  const [menuOpen, setMenuOpen] = useState(false);
  // 系统设置面板(菜单 → 设置)是否展开:仍然是原来的屏幕居中面板
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 「关于」面板 / 「退出」二次确认
  const [aboutOpen, setAboutOpen] = useState(false);
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);
  // 应用版本(关于面板里展示,由主进程 app.getVersion() 提供)
  const [appVersion, setAppVersion] = useState('');
  // 菜单锚点:头像(顶部)或「菜单」按钮(底部),浮层跟着点开的按钮走
  const [menuAnchor, setMenuAnchor] = useState<'avatar' | 'menu'>('menu');
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuPanelPos, setMenuPanelPos] = useState<{ left: number; top: number } | null>(null);
  // 上课计时:startedAt 由父组件(TeacherWorkspace)持有并同步服务端;
  // 这里只负责按秒刷新显示。侧边栏收起/换边都不会卸载本组件,所以计时不会中断。
  // 计时刷新用「当前时间」:只在课堂上按秒推进,未上课时不产生定时器
  const [clockNow, setClockNow] = useState(() => Date.now());
  // 窗口面板(点击「窗口」导航项打开):顶部「回到电脑桌面」+ 系统真实窗口列表(代替任务栏)
  const [windowsOpen, setWindowsOpen] = useState(false);
  // 系统窗口列表(标题 + 缩略图 + 句柄)
  const [winList, setWinList] = useState<{ id: string; hwnd: number; title: string; thumbnail: string; minimized?: boolean }[]>([]);
  const [winLoading, setWinLoading] = useState(false);
  // 窗口面板位置:必须「贴着侧边栏」出现(左栏 → 右邻、右栏 → 左邻),
  // 顶端与侧边栏对齐并夹在屏幕内;不能用「屏幕对侧 + 垂直居中」,那样离侧边栏很远,
  // 老师点完还要满屏找面板。位置由 useLayoutEffect 量出来,拖动侧边栏时实时跟随。
  const winPanelRef = useRef<HTMLDivElement>(null);
  const [winPanelPos, setWinPanelPos] = useState<{ left: number; top: number } | null>(null);
  // 左侧/右侧浮层各自独立:
  //   · openSide = null 表示两侧都收起(允许);同时最多只展开一侧。
  //   · sideY 记录两侧各自的垂直位置(视觉 top,px;null = 垂直居中),
  //     改一侧的高度或位置不会带动另一侧。
  const [openSide, setOpenSide] = useState<'left' | 'right' | null>('right');
  const [sideY, setSideY] = useState<Record<'left' | 'right', number | null>>({ left: null, right: null });
  const leftDockRef = useRef<HTMLDivElement>(null);
  const rightDockRef = useRef<HTMLDivElement>(null);

  const navItems = role === 'TEACHER' ? TEACHER_NAV : STUDENT_NAV;

  // 上课计时:上课中每秒刷新「当前时间」;下课立即停表(计时归零,下次上课重新开始)
  useEffect(() => {
    if (classStartedAt == null) return;
    setClockNow(Date.now());
    const sync = () => setClockNow(Date.now());
    const timer = window.setInterval(sync, 1000);
    // 窗口被最小化/隐藏时定时器会被节流:回到前台立即补一次,避免计时停顿一秒以上
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [classStartedAt]);

  const inClass = classStartedAt != null;
  // 已经上课多久(秒 → mm:ss)
  const classElapsedText = classStartedAt == null ? '' : formatClassElapsed((clockNow - classStartedAt) / 1000);

  // 把某一侧的 top 夹在屏幕内(用该侧自身实际高度,不读另一侧)
  const setSideYClamped = useCallback((side: 'left' | 'right', top: number, el: HTMLElement | null) => {
    const h = el?.getBoundingClientRect().height ?? 0;
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    setSideY((prev) => ({ ...prev, [side]: Math.max(8, Math.min(top, maxTop)) }));
  }, []);

  // 展开态拖动:侧边栏上**任意位置**按下都能拖(包括按钮),
  // 不再需要「拖拽把手 / 拖动图标」,也不会只剩边缘能拖:
  //   · 位移 < 5px 视为点击,按钮功能照常;
  //   · 位移 ≥ 5px 视为拖动,松手后吞掉那一次 click(不会拖完顺手点开功能)。
  const dockDrag = useDragAnywhere('y', (p) => {
    if (!openSide) return;
    const el = openSide === 'left' ? leftDockRef.current : rightDockRef.current;
    setSideYClamped(openSide, p.y, el);
  });

  // 拉取系统窗口列表(打开面板时/手动刷新)
  const refreshWindows = useCallback(async () => {
    setWinLoading(true);
    try {
      const list = await (window as any).api?.windows?.list?.();
      setWinList(Array.isArray(list) ? list : []);
    } finally {
      setWinLoading(false);
    }
  }, []);

  // 打开/关闭窗口面板时刷新列表
  useEffect(() => {
    if (windowsOpen) refreshWindows();
  }, [windowsOpen, refreshWindows]);

  // 侧边栏收起(或换边)时,窗口面板也跟着收起:面板是侧边栏的「飞出层」,没有锚点就不该留在屏幕上。
  useEffect(() => {
    if (!openSide) setWindowsOpen(false);
  }, [openSide]);

  // 窗口面板定位:贴在侧边栏旁边,顶端与侧边栏对齐,四边夹进屏幕。
  // 依赖 sideY(拖动侧边栏)/ openSide(换边)/ s(缩放)/ winList.length(列表加载后高度变化)。
  useLayoutEffect(() => {
    if (!windowsOpen) {
      setWinPanelPos(null);
      return;
    }
    const dockEl = openSide === 'left' ? leftDockRef.current : openSide === 'right' ? rightDockRef.current : null;
    const update = () => {
      const gap = px(12);
      const margin = px(12);
      const el = winPanelRef.current;
      const panelW = el?.offsetWidth || px(380);
      const panelH = el?.offsetHeight || px(460);
      const dockRect = dockEl?.getBoundingClientRect() ?? null;
      // 水平:左栏放在栏右侧,右栏放在栏左侧(空间不够时由夹取兜底)
      let left: number;
      if (dockRect) {
        left = openSide === 'left' ? dockRect.right + gap : dockRect.left - panelW - gap;
      } else {
        left = margin;
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin));
      // 垂直:与侧边栏顶端对齐(侧边栏是垂直居中时可读成居中),再夹进屏幕
      const anchorTop = dockRect ? dockRect.top : (window.innerHeight - panelH) / 2;
      const top = Math.max(margin, Math.min(anchorTop, window.innerHeight - panelH - margin));
      setWinPanelPos((prev) =>
        prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5 ? prev : { left, top },
      );
    };
    update();
    // 列表加载/缩略图撑高后高度会变,监听面板自身尺寸再校一次
    const ro = new ResizeObserver(update);
    if (winPanelRef.current) ro.observe(winPanelRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [windowsOpen, openSide, sideY, s, winList.length]);

  // 侧边栏收起/换边时,「菜单」浮层也跟着收起:没有锚点就不该留在屏幕上
  useEffect(() => {
    setMenuOpen(false);
  }, [openSide]);

  // 打开「关于」时读取应用版本(失败保持空,面板显示「—」)
  useEffect(() => {
    if (!aboutOpen) return;
    (window as any).api?.app
      ?.version?.()
      .then((v: string) => setAppVersion(v || ''))
      .catch(() => {});
  }, [aboutOpen]);

  // 「菜单」浮层定位:紧贴侧边栏、底边与点开的按钮对齐,四边夹进屏幕。
  // 依赖 sideY(拖动侧边栏)/ openSide(换边)/ s(缩放)/ menuAnchor(头像 or 菜单按钮)。
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPanelPos(null);
      return;
    }
    const update = () => {
      const anchorEl = menuAnchor === 'avatar' ? avatarBtnRef.current : menuBtnRef.current;
      const panelEl = menuPanelRef.current;
      if (!anchorEl) return;
      const anchor = anchorEl.getBoundingClientRect();
      const dockRect =
        (openSide === 'left' ? leftDockRef.current : openSide === 'right' ? rightDockRef.current : null)?.getBoundingClientRect() ??
        null;
      const panelW = panelEl?.offsetWidth || px(212);
      const panelH = panelEl?.offsetHeight || px(240);
      const gap = px(12);
      const margin = px(12);
      // 水平:贴着侧边栏外沿留 12px(左栏 → 浮层在栏右侧;右栏 → 浮层在栏左侧)
      let left: number;
      if (dockRect) left = openSide === 'left' ? dockRect.right + gap : dockRect.left - panelW - gap;
      else left = openSide === 'left' ? anchor.right + gap : anchor.left - panelW - gap;
      left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin));
      // 垂直:浮层底边与点开的按钮底边对齐,再夹进屏幕
      let top = anchor.bottom - panelH;
      top = Math.max(margin, Math.min(top, window.innerHeight - panelH - margin));
      setMenuPanelPos((prev) =>
        prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5 ? prev : { left, top },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    if (menuPanelRef.current) ro.observe(menuPanelRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [menuOpen, menuAnchor, openSide, sideY, s]);

  // 退出应用:优先走主进程 app:quit(真正退出,而不是「关闭窗口 = 最小化到托盘」);
  // 非 Electron 预览环境没有该 API 时,退回旧行为。
  const quitApp = () => {
    const appApi = (window as any).api?.app;
    if (appApi?.quit) {
      appApi.quit();
      return;
    }
    onLogout();
  };

  // 第一层菜单的点击:关掉浮层,再打开各自的下一层
  const handleMenuAction = (key: DockMenuKey) => {
    setMenuOpen(false);
    if (key === 'settings') setSettingsOpen(true);
    else if (key === 'about') setAboutOpen(true);
    else setQuitConfirmOpen(true);
  };

  // 某一侧的定位样式:有自定义 top 就用 px,否则垂直居中
  const verticalStyle = (side: 'left' | 'right'): React.CSSProperties => {
    const top = sideY[side];
    return { top: top ?? '50%', transform: top != null ? 'none' : 'translateY(-50%)' };
  };

  // 展开后高度变大(或换了分辨率):把这一侧重新夹进屏幕;另一侧不受影响
  useLayoutEffect(() => {
    if (!openSide) return;
    const el = openSide === 'left' ? leftDockRef.current : rightDockRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    setSideY((prev) => {
      const top = prev[openSide];
      if (top == null) return prev;
      const next = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      return next === top ? prev : { ...prev, [openSide]: next };
    });
  }, [openSide, s]);

  return (
    <>
      {/* 收起态的贴边箭头:左侧/右侧都可以收起(允许两侧同时收起)。
          点箭头 = 展开该侧(同时只允许一侧展开);按住上下拖 = 调整该侧位置。 */}
      {openSide !== 'left' && (
        <div
          key="arrow-left"
          data-interactive
          data-overlay-anim
          style={{
            position: 'fixed',
            left: 0,
            zIndex: 80,
            pointerEvents: 'auto',
            ...verticalStyle('left'),
            ...overlayIn('left'),
          }}
        >
          <SideArrow
            direction="left"
            onOpen={() => setOpenSide('left')}
            onMove={(top) => setSideY((prev) => ({ ...prev, left: top }))}
            scale={s}
          />
        </div>
      )}
      {openSide !== 'right' && (
        <div
          key="arrow-right"
          data-interactive
          data-overlay-anim
          style={{
            position: 'fixed',
            right: 0,
            zIndex: 80,
            pointerEvents: 'auto',
            ...verticalStyle('right'),
            ...overlayIn('right'),
          }}
        >
          <SideArrow
            direction="right"
            onOpen={() => setOpenSide('right')}
            onMove={(top) => setSideY((prev) => ({ ...prev, right: top }))}
            scale={s}
          />
        </div>
      )}

      {/* 当前展开的侧边栏(同时最多只展开一侧;也可以两侧都收起)。
          入场:按贴边方向从屏幕外滑入 + 淡入(key 保证换边/重开都重播)。 */}
      {openSide !== null && (
      <div
        key={`dock-${openSide}`}
        ref={openSide === 'left' ? leftDockRef : rightDockRef}
        data-interactive
        data-overlay-anim
        onPointerDown={dockDrag.onPointerDown}
        onClickCapture={dockDrag.onClickCapture}
        style={{
          position: 'fixed',
          [openSide]: px(12),
          ...verticalStyle(openSide),
          width: px(82),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: 'rgba(27, 27, 31, 0.92)',
          borderRadius: px(18),
          paddingTop: px(16),
          paddingBottom: px(16),
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          pointerEvents: 'auto',
          userSelect: 'none',
          zIndex: 80,
          // 从贴边那一侧滑入 + 淡入(贴左从左进、贴右从右进)
          ...overlayIn(openSide),
        }}
      >
        {/* 收起按钮:点击后本侧收起为一个可拖动的贴边箭头(另一侧此时仍可单独展开) */}
        <button
          onClick={() => setOpenSide(null)}
          title="收起"
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            [openSide === 'right' ? 'left' : 'right']: -px(20),
            width: px(26),
            height: px(68),
            border: 'none',
            cursor: 'pointer',
            background: 'rgba(27,27,31,0.95)',
            color: '#e5e7eb',
            borderRadius: openSide === 'right' ? `${px(12)}px 0 0 ${px(12)}px` : `0 ${px(12)}px ${px(12)}px 0`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
            outline: 'none',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.95)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(27,27,31,0.95)';
          }}
        >
          {openSide === 'right' ? <ChevronRight size={px(24)} /> : <ChevronLeft size={px(24)} />}
        </button>

        {/* 头像 + 名称 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(5) }}>
          <button
            ref={avatarBtnRef}
            onClick={() => {
              // 头像和底部「菜单」一样:先弹第一层菜单,不直接开设置面板
              setMenuAnchor('avatar');
              // 保证同时只有一层浮层:开菜单时收起设置/关于/窗口
              setSettingsOpen(false);
              setAboutOpen(false);
              setWindowsOpen(false);
              setMenuOpen((v) => !v);
            }}
            title={`${user.name} · 菜单`}
            style={{
              width: px(50),
              height: px(50),
              borderRadius: '50%',
              border: 'none',
              cursor: 'pointer',
              background: role === 'TEACHER' ? '#2563eb' : '#16a34a',
              color: '#fff',
              fontSize: px(19),
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            {user.name.charAt(0)}
          </button>
          <span
            style={{
              fontSize: px(12),
              color: '#d1d5db',
              maxWidth: px(70),
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.name}
          </span>
        </div>

        {/* 上课/下课:头像名称下方的矩形圆角按钮。
            未上课 = 蓝色「上课」;点击后变红色「下课」,并在按钮内显示已上课时长 mm:ss。
            再点一次即下课(计时清零,下次上课重新计时)。 */}
        {role === 'TEACHER' && (
          <button
            onClick={onToggleClass}
            title={inClass ? `下课(已上课 ${classElapsedText})` : '上课'}
            aria-pressed={inClass}
            style={{
              marginTop: px(12),
              width: px(66),
              height: px(42),
              borderRadius: px(10),
              border: 'none',
              cursor: 'pointer',
              background: inClass ? '#dc2626' : '#2563eb',
              color: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: px(3),
              boxShadow: inClass
                ? '0 6px 16px rgba(220,38,38,0.40), 0 0 0 2px rgba(248,113,113,0.22)'
                : '0 6px 16px rgba(37,99,235,0.40), 0 0 0 2px rgba(96,165,250,0.22)',
              transition: 'background .16s ease, box-shadow .16s ease',
              outline: 'none',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = inClass ? '#ef4444' : '#3b82f6';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = inClass ? '#dc2626' : '#2563eb';
            }}
          >
            <span style={{ fontSize: px(13), fontWeight: 600, lineHeight: 1 }}>{inClass ? '下课' : '上课'}</span>
            {inClass && (
              <span
                style={{
                  fontSize: px(11),
                  lineHeight: 1,
                  opacity: 0.92,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {classElapsedText}
              </span>
            )}
          </button>
        )}

        {/* 导航项 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(10), marginTop: px(16) }}>
          {navItems.map((item) => {
            const isActive = active === item.key;
            const Icon = item.Icon;
            return (
              <button
                key={item.key}
                // 「窗口」项点击打开窗口面板(而非切换视图);其余项触发 onChange。
                // 任一导航项都先收起「菜单」浮层,避免两层浮层叠在一起。
                onClick={() => {
                  setMenuOpen(false);
                  if (item.key === 'windows') setWindowsOpen((v) => !v);
                  else onChange(item.key);
                }}
                title={item.label}
                style={{
                  width: px(60),
                  height: px(60),
                  borderRadius: px(14),
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(3),
                  // 选中态:实心蓝底 + 白字 + 外发光,一眼能看出当前在哪个功能
                  background: isActive ? 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)' : 'transparent',
                  color: isActive ? '#ffffff' : '#9ca3af',
                  boxShadow: isActive ? '0 0 0 2px rgba(96,165,250,0.28), 0 6px 18px rgba(37,99,235,0.45)' : 'none',
                  transition: 'all .16s ease',
                  outline: 'none',
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <Icon size={px(24)} />
                <span style={{ fontSize: px(12), lineHeight: 1, fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* 底部:菜单(点击先弹第一层浮层:设置/关于/退出) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(8), marginTop: 'auto' }}>
          <button
            ref={menuBtnRef}
            title="菜单"
            onClick={() => {
              setMenuAnchor('menu');
              // 保证同时只有一层浮层:开菜单时收起设置/关于/窗口
              setSettingsOpen(false);
              setAboutOpen(false);
              setWindowsOpen(false);
              setMenuOpen((v) => !v);
            }}
            style={{
              width: px(60),
              height: px(60),
              borderRadius: px(14),
              border: 'none',
              cursor: 'pointer',
              background: menuOpen ? 'rgba(255,255,255,0.10)' : 'transparent',
              color: menuOpen ? '#ffffff' : '#9ca3af',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: px(3),
              outline: 'none',
              padding: 0,
            }}
          >
            <Menu size={px(24)} />
            <span style={{ fontSize: px(12) }}>菜单</span>
          </button>
        </div>
      </div>
      )}

      {/* 第一层浮层:点侧边栏「菜单」(或头像)后,在侧边栏旁边弹出 设置 / 关于 / 退出。
          点「设置」才打开屏幕中间的系统设置面板(原来的那一层);点浮层外任意位置收起。 */}
      {menuOpen && (
        <>
          {/* 全屏透明遮罩:只负责「点外面收起」,不改变视觉 */}
          <div
            data-interactive
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 115,
              background: 'transparent',
              pointerEvents: 'auto',
            }}
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuPanelRef}
            data-interactive
            data-overlay-anim
            style={{
              position: 'fixed',
              left: menuPanelPos?.left ?? px(12),
              top: menuPanelPos?.top ?? px(12),
              // 第一帧还没量到位置时先隐藏,避免闪到错误位置
              visibility: menuPanelPos ? 'visible' : 'hidden',
              width: px(212),
              background: '#26262b',
              borderRadius: px(12),
              border: '1px solid #3a3a40',
              padding: px(6),
              zIndex: 116,
              boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
              pointerEvents: 'auto',
              userSelect: 'none',
              // 浮层在侧边栏哪一侧,就从哪一侧滑入
              ...overlayIn(openSide === 'left' ? 'left' : 'right'),
            }}
          >
            {/* 用户信息:保留菜单里的身份上下文 */}
            <div
              style={{
                padding: `${px(8)}px ${px(10)}px ${px(10)}px`,
                borderBottom: '1px solid #3a3a40',
              }}
            >
              <div style={{ fontSize: px(15), fontWeight: 600, color: '#ffffff' }}>{user.name}</div>
              <div style={{ fontSize: px(12), color: '#9ca3af', marginTop: px(2) }}>
                {role === 'TEACHER' ? '教师账号' : '学生账号'}
              </div>
            </div>
            {DOCK_MENU_ITEMS.map(({ key, label, Icon, danger }) => (
              <button
                key={key}
                onClick={() => handleMenuAction(key)}
                title={label}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: px(10),
                  padding: `${px(10)}px ${px(10)}px`,
                  marginTop: px(2),
                  border: 'none',
                  borderRadius: px(8),
                  background: 'transparent',
                  color: danger ? '#f87171' : '#e5e7eb',
                  fontSize: px(15),
                  textAlign: 'left',
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'background .12s ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = danger
                    ? 'rgba(248,113,113,0.14)'
                    : 'rgba(255,255,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <Icon size={px(17)} />
                <span style={{ flex: 1 }}>{label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 关于(菜单 → 关于):应用名称 + 版本信息 */}
      {aboutOpen && (
        <div
          data-interactive
          data-overlay-anim
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: px(360),
            maxWidth: 'calc(100vw - 32px)',
            background: '#ffffff',
            borderRadius: px(16),
            border: '1px solid #e5e7eb',
            padding: px(22),
            zIndex: 122,
            boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
            ...overlayIn('fade'),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: px(10) }}>
            <div style={{ fontSize: px(18), fontWeight: 600, color: '#1f2937' }}>关于</div>
            <button
              onClick={() => setAboutOpen(false)}
              title="关闭"
              style={{
                width: px(34),
                height: px(34),
                borderRadius: px(8),
                border: 'none',
                background: 'transparent',
                color: '#6b7280',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: 'none',
              }}
            >
              <X size={px(20)} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(4) }}>
            <div
              style={{
                width: px(64),
                height: px(64),
                borderRadius: px(18),
                background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 20px rgba(37,99,235,0.35)',
              }}
            >
              <Info size={px(32)} />
            </div>
            <div style={{ fontSize: px(20), fontWeight: 600, color: '#1f2937', marginTop: px(8) }}>C30 教师端</div>
            <div style={{ fontSize: px(13), color: '#9ca3af' }}>版本 {appVersion || '—'}</div>
            <div
              style={{
                fontSize: px(13),
                color: '#6b7280',
                textAlign: 'center',
                lineHeight: 1.6,
                marginTop: px(8),
                maxWidth: px(280),
              }}
            >
              局域网互动教学系统 · 教师端
              <br />
              白板批注 / 桌面标注 / 聚焦 / 课堂互动
            </div>
            <div style={{ fontSize: px(12), color: '#c0c4cc', marginTop: px(14) }}>© 2026 C30</div>
          </div>
        </div>
      )}

      {/* 退出确认(菜单 → 退出):确认后真正退出应用,而不是最小化到托盘 */}
      {quitConfirmOpen && (
        <div
          data-interactive
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 130,
            pointerEvents: 'auto',
          }}
          onClick={() => setQuitConfirmOpen(false)}
        >
          <div
            style={{
              width: px(380),
              maxWidth: 'calc(100vw - 32px)',
              background: '#ffffff',
              borderRadius: px(14),
              padding: px(24),
              boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: px(17), fontWeight: 600, color: '#1f2937' }}>退出 C30 教师端?</div>
            <p style={{ fontSize: px(14), color: '#7c8494', margin: `${px(10)}px 0 ${px(22)}px` }}>
              退出后本次课堂结束,学生端会断开连接。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: px(10) }}>
              <button
                onClick={() => setQuitConfirmOpen(false)}
                style={{
                  padding: `${px(9)}px ${px(18)}px`,
                  border: '1px solid #e5e7eb',
                  borderRadius: px(8),
                  background: '#ffffff',
                  color: '#4b5563',
                  fontSize: px(14),
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                取消
              </button>
              <button
                onClick={quitApp}
                style={{
                  padding: `${px(9)}px ${px(18)}px`,
                  border: 'none',
                  borderRadius: px(8),
                  background: '#dc2626',
                  color: '#ffffff',
                  fontSize: px(14),
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                退出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 系统设置窗口(菜单 → 设置):开机自启 / 展示教室信息 / 允许互动 */}
      {/* 注意:面板必须在侧边栏容器之外渲染,否则侧边栏的 transform 会使 fixed 定位失效 */}
      {settingsOpen && (
        <div
          data-interactive
          data-overlay-anim
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: px(420),
            maxWidth: 'calc(100vw - 32px)',
            background: '#ffffff',
            borderRadius: px(16),
            border: '1px solid #e5e7eb',
            padding: px(22),
            zIndex: 121,
            boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
            // 居中弹窗:原地淡入 + 轻微上浮
            ...overlayIn('fade'),
          }}
        >
          {/* 标题栏 + 关闭叉号 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: px(4) }}>
            <div style={{ fontSize: px(18), fontWeight: 600, color: '#1f2937' }}>系统设置</div>
            <button
              onClick={() => setSettingsOpen(false)}
              title="关闭"
              style={{
                width: px(34),
                height: px(34),
                borderRadius: px(8),
                border: 'none',
                background: 'transparent',
                color: '#6b7280',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: 'none',
              }}
            >
              <X size={px(20)} />
            </button>
          </div>
          <div style={{ fontSize: px(13), color: '#9ca3af', marginBottom: px(16) }}>
            {user.name} · {role === 'TEACHER' ? '发送端' : '接收端'} · {memberCount} 名学生在线上
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: px(2) }}>
            {/* 开机自启 */}
            <SettingRow
              label="开机自启"
              desc="登录系统后自动启动教师端"
              checked={settings.autoLaunch}
              onChange={(v) => onSettingsChange({ autoLaunch: v })}
              scale={s}
            />
            {/* 展示教室信息 */}
            <SettingRow
              label="展示教室信息"
              desc="右上角显示网络/班级/人数"
              checked={settings.showClassInfo}
              onChange={(v) => onSettingsChange({ showClassInfo: v })}
              scale={s}
            />
            {/* 允许互动 */}
            <SettingRow
              label="允许互动"
              desc="关闭后教师端互动置灰,学生端隐藏互动入口"
              checked={settings.allowInteraction}
              onChange={(v) => onSettingsChange({ allowInteraction: v })}
              scale={s}
            />
          </div>

          {role === 'TEACHER' && (
            <button
              // 设置面板里的「退出」也走同一套确认 + 真正退出应用
              onClick={() => {
                setSettingsOpen(false);
                setQuitConfirmOpen(true);
              }}
              style={{
                width: '100%',
                padding: `${px(11)}px 0`,
                marginTop: px(16),
                border: 'none',
                borderRadius: px(8),
                background: '#fee2e2',
                color: '#dc2626',
                fontSize: px(15),
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              退出
            </button>
          )}
        </div>
      )}

      {/* 窗口面板(「窗口」导航项点击打开):和侧边栏/菜单/画笔面板同一套深色浮层语言。
          内容:顶部「回到电脑桌面」+ 任务栏级窗口列表(系统任务栏里有的窗口才列出来) */}
      {windowsOpen && (
        <div
          ref={winPanelRef}
          data-interactive
          data-overlay-anim
          style={{
            position: 'fixed',
            // 位置由上面的 useLayoutEffect 按侧边栏矩形算出来:紧贴侧边栏、顶端对齐
            left: winPanelPos?.left ?? px(12),
            top: winPanelPos?.top ?? px(12),
            // 第一帧还没量到位置时先隐藏,避免闪到错误位置
            visibility: winPanelPos ? 'visible' : 'hidden',
            width: px(380),
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 24px)',
            // 深色浮层:与菜单浮层(#26262b)/ 侧边栏(rgba(27,27,31,.92))/ 画笔面板一致
            background: 'rgba(27,27,31,0.96)',
            border: '1px solid #3a3a40',
            borderRadius: px(16),
            padding: px(16),
            zIndex: 82,
            boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            gap: px(10),
            pointerEvents: 'auto',
            // 面板从侧边栏那一侧「长出来」:左栏的面板贴左栏右侧(从左边滑入),
            // 右栏的面板贴右栏左侧(从右边滑入)
            ...overlayIn(openSide === 'left' ? 'left' : 'right'),
          }}
        >
          {/* 标题栏 + 关闭叉号 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: px(16), fontWeight: 600, color: '#ffffff' }}>窗口</span>
            <button
              onClick={() => setWindowsOpen(false)}
              title="关闭"
              style={{
                width: px(30),
                height: px(30),
                borderRadius: px(8),
                border: 'none',
                background: 'transparent',
                color: '#9ca3af',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <X size={px(18)} />
            </button>
          </div>

          {/* 回到电脑桌面按钮 */}
          <button
            onClick={() => {
              (window as any).api?.windows?.showDesktop?.();
              setWindowsOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: px(10),
              width: '100%',
              padding: `${px(11)}px ${px(12)}px`,
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: px(10),
              background: 'rgba(255,255,255,0.07)',
              color: '#e5e7eb',
              fontSize: px(15),
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background .12s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.24)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)';
            }}
          >
            <span
              style={{
                width: px(38),
                height: px(38),
                borderRadius: px(8),
                background: '#2563eb',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Monitor size={px(20)} />
            </span>
            回到电脑桌面
          </button>

          {/* 窗口列表标题 + 刷新 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: px(13), color: '#9ca3af', fontWeight: 500 }}>已打开的窗口</span>
            <button
              onClick={refreshWindows}
              title="刷新窗口列表"
              style={{
                border: 'none',
                background: 'transparent',
                color: '#9ca3af',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: px(4),
                fontSize: px(12),
                padding: px(4),
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
              }}
            >
              <RefreshCw size={px(14)} style={{ animation: winLoading ? 'spin 1s linear infinite' : 'none' }} />
              刷新
            </button>
          </div>

          {/* 任务栏级窗口列表(缩略图 + 标题):点哪一项就把哪个窗口最大化到桌面 */}
          <div
            className="c30-dark-scroll"
            style={{ display: 'flex', flexDirection: 'column', gap: px(6), maxHeight: px(320), overflow: 'auto' }}
          >
            {winLoading && winList.length === 0 && (
              <div style={{ padding: `${px(20)}px 0`, textAlign: 'center', fontSize: px(13), color: '#6b7280' }}>
                正在读取窗口…
              </div>
            )}
            {!winLoading && winList.length === 0 && (
              <div style={{ padding: `${px(20)}px 0`, textAlign: 'center', fontSize: px(13), color: '#6b7280' }}>
                未检测到其他应用窗口
              </div>
            )}
            {winList.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  // 点开就最大化:只把这个窗口还原+最大化+置前,其他窗口保持原样
                  (window as any).api?.windows?.maximize?.(w.hwnd);
                  // 收起面板,让老师直接看到目标窗口
                  setWindowsOpen(false);
                }}
                title={`最大化「${w.title}」`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: px(10),
                  padding: px(6),
                  borderRadius: px(10),
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                  transition: 'background .12s ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.09)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {w.thumbnail ? (
                  <img
                    src={w.thumbnail}
                    alt=""
                    draggable={false}
                    style={{
                      width: px(78),
                      height: px(48),
                      borderRadius: px(6),
                      objectFit: 'cover',
                      background: '#3a3a40',
                      flexShrink: 0,
                      border: '1px solid #4b4b52',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: px(78),
                      height: px(48),
                      borderRadius: px(6),
                      background: '#3a3a40',
                      border: '1px solid #4b4b52',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#9ca3af',
                    }}
                  >
                    <Monitor size={px(20)} />
                  </span>
                )}
                <span
                  style={{
                    fontSize: px(14),
                    color: '#e5e7eb',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {w.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// 设置项:带说明文字的开关行
function SettingRow({
  label,
  desc,
  checked,
  onChange,
  scale,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  scale: number;
}) {
  const px = (n: number) => scaled(n, scale);
  const trackW = px(52);
  const trackH = px(30);
  const knob = px(24);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${px(11)}px 0`,
        gap: px(12),
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(2) }}>
        <span style={{ fontSize: px(15), color: '#1f2937' }}>{label}</span>
        <span style={{ fontSize: px(12), color: '#9ca3af' }}>{desc}</span>
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        title={label}
        style={{
          width: trackW,
          height: trackH,
          borderRadius: trackH / 2,
          border: 'none',
          cursor: 'pointer',
          background: checked ? '#2563eb' : '#d1d5db',
          position: 'relative',
          transition: 'background .16s ease',
          outline: 'none',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: (trackH - knob) / 2,
            left: checked ? trackW - knob - px(3) : px(3),
            width: knob,
            height: knob,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            transition: 'left .16s ease',
          }}
        />
      </button>
    </div>
  );
}

// 贴边收起箭头:
//   · 单击 = 展开这一侧(同时只展开一侧);
//   · 按住上下拖 = 调整这一侧的位置(位移超过 4px 就判定为拖动,松手不触发展开)。
// 不再画「可拖动」的把手短横:浮层上不出现任何拖拽图标,拖动能力保留。
function SideArrow({
  direction,
  onOpen,
  onMove,
  scale,
}: {
  direction: 'left' | 'right';
  onOpen: () => void;
  onMove: (top: number) => void;
  scale: number;
}) {
  const px = (n: number) => scaled(n, scale);
  const dragRef = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    dragRef.current = { startY: e.clientY, startTop: el.getBoundingClientRect().top, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) < 4) return; // 小抖动仍视为点击
      d.moved = true;
      setDragging(true);
    }
    const h = e.currentTarget.getBoundingClientRect().height;
    const next = Math.max(8, Math.min(d.startTop + dy, window.innerHeight - h - 8));
    onMove(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略释放失败 */
    }
    // 没拖动过 → 当作点击展开
    if (d && !d.moved) onOpen();
  };

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title="点击展开 · 按住可上下拖动"
      style={{
        width: px(38),
        height: px(104),
        border: 'none',
        cursor: dragging ? 'ns-resize' : 'grab',
        background: 'rgba(27,27,31,0.95)',
        color: '#e5e7eb',
        borderRadius: direction === 'left' ? `0 ${px(18)}px ${px(18)}px 0` : `${px(18)}px 0 0 ${px(18)}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: px(6),
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        outline: 'none',
        padding: 0,
        touchAction: 'none',
        transition: 'background .15s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.95)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(27,27,31,0.95)';
      }}
    >
      {direction === 'left' ? <ChevronRight size={px(28)} /> : <ChevronLeft size={px(28)} />}
    </button>
  );
}

// 顶部状态条(右上角:网络/班级/人数)
export function TopStatusBar({
  networkStatus,
  memberCount,
}: {
  networkStatus: 'direct' | 'relay' | '';
  memberCount: number;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);
  return (
    <div
      data-interactive
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: px(18),
        padding: `0 ${px(20)}px`,
        height: px(52),
        background: 'rgba(27,27,31,0.92)',
        borderRadius: px(16),
        color: '#d1d5db',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: px(6), color: '#9ca3af', fontSize: px(14) }}>
        <Wifi size={px(17)} />
        <span>{networkStatus === 'direct' ? '局域网' : networkStatus === 'relay' ? '中继' : '离线'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: px(6), color: '#9ca3af', fontSize: px(14) }}>
        <UsersRound size={px(17)} />
        <span>班级</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: px(6), color: '#9ca3af', fontSize: px(14) }}>
        <Users size={px(17)} />
        <span>{memberCount} 人</span>
      </div>
    </div>
  );
}

// 底部悬浮工具条:选择/画笔/板擦/互动/聚焦,贴底边,可左右拖动 + 右端收起箭头。
// 拖动不设手柄:按住工具条的空白背景就能左右拖(浮层上不出现任何拖拽图标)。
//
// 选择逻辑:
//   · 第一次点击某个工具 → 立刻切换到该功能(不做二次确认,不弹菜单);
//   · 再次点击「已激活」且带菜单的工具(画笔/板擦) → 展开/收起它的调整菜单;
//   · 带菜单的工具在按钮右上角有一枚小箭头角标(未展开朝上、展开后朝下),
//     配合 tooltip「再点一次调整」,老师不用猜就能知道这个按钮还有第二层;
//   · 选中态用「实心蓝底 + 白字加粗 + 蓝色外发光」,画笔/板擦激活时额外显示
//     撤销 / 重做 / 清空 操作条(不提供「完成」:切走工具即完成,不需要多余一步)。
export function BottomToolbar({
  activeTool,
  onToolChange,
  penConfig,
  onPenConfigChange,
  eraserRadius,
  onEraserRadiusChange,
  onUndo,
  onRedo,
  onClear,
  allowInteraction = true,
  members,
  studentCount,
  interact,
}: {
  activeTool: string;
  onToolChange: (key: string) => void;
  penConfig: PenConfig;
  onPenConfigChange: (c: PenConfig) => void;
  eraserRadius: number;
  onEraserRadiusChange: (radius: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  // 是否允许互动(设置项关闭时,互动按钮置灰并弹提示)
  allowInteraction?: boolean;
  // 课堂成员(互动面板里显示学生名字)
  members: SessionMember[];
  studentCount: number;
  // 课堂互动控制器(状态来自服务端快照)
  interact: InteractController;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const [x, setX] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // 当前展开的浮层(画笔/板擦/互动);null = 未展开
  const [openMenu, setOpenMenu] = useState<'pen' | 'eraser' | 'interact' | null>(null);
  // 互动被禁时的 toast
  const [toast, setToast] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 菜单是 fixed 浮层(不撑开工具条布局),位置随工具条矩形实时计算
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  // 颜色盘浮层:独立于画笔面板,贴在它右侧(右侧放不下就放左侧),位置同样实时计算
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ left: number; bottom: number } | null>(null);

  const isDrawingTool = activeTool === 'pen' || activeTool === 'eraser';
  // 互动按钮上的角标:有人举手 → 红点数字;有互动在跑 → 绿点常亮
  const handsCount = interact.state?.hands.length ?? 0;
  const activeSession = !!interact.state?.session && interact.state.session.endedAt == null;

  // 左右拖动:工具条上**任意位置**都能拖(同样不需要手柄),拖动结束后吞掉一次 click
  const barDrag = useDragAnywhere('x', (p) => {
    const w = wrapRef.current?.getBoundingClientRect().width ?? 0;
    setX(Math.max(8, Math.min(p.x, window.innerWidth - w - 8)));
  });

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  // 工具被外部切换(进白板默认画笔 / 退出白板复位选择 / 点完成)时,关掉已不匹配的菜单。
  // 「互动」面板不绑定绘制工具,切画笔时保持打开(方便一边看结果一边批注)。
  useEffect(() => {
    if (openMenu && openMenu !== 'interact' && openMenu !== activeTool) setOpenMenu(null);
  }, [activeTool, openMenu]);

  // 收起工具条时同时收起菜单与颜色盘
  useEffect(() => {
    if (collapsed) {
      setOpenMenu(null);
      setPickerOpen(false);
    }
  }, [collapsed]);

  // 颜色盘只属于画笔面板:菜单关掉或切到板擦时一起关
  useEffect(() => {
    if (openMenu !== 'pen') setPickerOpen(false);
  }, [openMenu]);

  // 「允许互动」被关掉时,互动面板没有存在意义,直接收起
  useEffect(() => {
    if (!allowInteraction && openMenu === 'interact') setOpenMenu(null);
  }, [allowInteraction, openMenu]);

  // 计算菜单位置:水平居中对齐工具条并夹在屏幕内;垂直贴在工具条(含操作条)上方。
  // 颜色盘是**独立浮层**,贴在画笔面板右侧(右边放不下就挪到左侧),与面板底边对齐;
  // 这样取色时画笔面板高度不变,不会出现上下抖动。
  useLayoutEffect(() => {
    if (!openMenu || collapsed) {
      setMenuPos(null);
      setPickerPos(null);
      return;
    }
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menuWidth = scaled(openMenu === 'pen' ? 400 : openMenu === 'interact' ? 620 : 360, s);
      const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
      const left = Math.min(maxLeft, Math.max(8, rect.left + rect.width / 2 - menuWidth / 2));
      const bottom = Math.max(8, window.innerHeight - rect.top + scaled(10, s));
      setMenuPos({ left, bottom });

      const pickerWidth = scaled(292, s);
      const gap = scaled(12, s);
      let pickerLeft = left + menuWidth + gap;
      if (pickerLeft + pickerWidth > window.innerWidth - 8) pickerLeft = left - pickerWidth - gap;
      pickerLeft = Math.max(8, Math.min(pickerLeft, window.innerWidth - pickerWidth - 8));
      setPickerPos({ left: pickerLeft, bottom });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [openMenu, collapsed, s, x, pickerOpen]);

  // 点击工具:先切功能,再(同一按钮)开菜单
  const handleToolClick = (tool: ToolItem) => {
    if (tool.key === 'interact' && !allowInteraction) {
      setToast('互动功能已被关闭');
      return;
    }
    // 「互动」是面板而非绘制工具:点一下展开/收起,不打断当前画笔
    if (tool.key === 'interact') {
      setOpenMenu((prev) => (prev === 'interact' ? null : 'interact'));
      return;
    }
    if (tool.menu) {
      // 已激活 → 本次点击是「打开/收起更多调整」
      if (activeTool === tool.key) {
        setOpenMenu((prev) => (prev === tool.menu ? null : tool.menu!));
        return;
      }
      // 未激活 → 本次点击先切换功能,菜单保持关闭
      setOpenMenu(null);
      onToolChange(tool.key);
      return;
    }
    // 无菜单工具:点击即切换
    setOpenMenu(null);
    onToolChange(tool.key);
  };

  // 折叠态:底部贴边半圆箭头(点击展开)
  if (collapsed) {
    return (
      <div
        data-interactive
        data-overlay-anim
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'auto',
          zIndex: 70,
          // 贴底边:从屏幕下方往上滑入 + 淡入
          ...overlayIn('up', 160),
        }}
      >
        <button
          onClick={() => setCollapsed(false)}
          title="展开工具条"
          style={{
            width: px(96),
            height: px(40),
            border: 'none',
            cursor: 'pointer',
            background: 'rgba(27,27,31,0.95)',
            color: '#e5e7eb',
            borderRadius: `${px(20)}px ${px(20)}px 0 0`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
            outline: 'none',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.95)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(27,27,31,0.95)';
          }}
        >
          <svg width={px(24)} height={px(24)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={wrapRef}
        data-interactive
        data-overlay-anim
        onPointerDown={barDrag.onPointerDown}
        onClickCapture={barDrag.onClickCapture}
        style={{
          position: 'fixed',
          bottom: px(18),
          left: x ?? '50%',
          transform: x != null ? 'none' : 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: px(10),
          pointerEvents: 'auto',
          userSelect: 'none',
          zIndex: 70,
          // 贴底边:从屏幕下方往上滑入 + 淡入
          ...overlayIn('up'),
        }}
      >
        {/* 画笔/板擦激活时:撤销/重做/清空 操作条(悬浮在工具条上方) */}
        {isDrawingTool && (
          <div style={{ display: 'flex', gap: px(10) }}>
            <ToolBtn onClick={onUndo} label="撤销" Icon={Undo2} scale={s} />
            <ToolBtn onClick={onRedo} label="重做" Icon={Redo2} scale={s} />
            <ToolBtn onClick={onClear} label="清空" Icon={Trash2} danger scale={s} />
          </div>
        )}

        {/* 互动被禁提示 toast(悬浮在工具条上方) */}
        {toast && (
          <div
            style={{
              background: '#1b1b1f',
              color: '#e5e7eb',
              fontSize: px(14),
              padding: `${px(9)}px ${px(18)}px`,
              borderRadius: px(18),
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              whiteSpace: 'nowrap',
            }}
          >
            {toast}
          </div>
        )}

        {/* 工具条本体(拖动由外层统一处理,没有拖拽手柄/图标) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: px(6),
            padding: `${px(8)}px ${px(14)}px`,
            borderRadius: px(20),
            background: '#1b1b1f',
            boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
          }}
        >
          {TOOLBAR.map((t) => {
            const disabled = t.key === 'interact' && !allowInteraction;
            // 「互动」是面板:展开时用蓝底描边区分,不和「当前画笔」的实心选中态抢视觉
            const panelOpen = t.key === 'interact' && openMenu === 'interact';
            const isActive = activeTool === t.key && !disabled;
            const menuOpenHere = openMenu != null && openMenu === t.menu;
            const Icon = t.Icon;
            return (
              <button
                key={t.key}
                onClick={() => handleToolClick(t)}
                title={
                  disabled
                    ? '互动功能已被关闭'
                    : t.key === 'interact'
                      ? '课堂互动(点击展开/收起)'
                      : t.menu
                        ? `${t.label}(再点一次调整)`
                        : t.label
                }
                aria-pressed={isActive || panelOpen}
                style={{
                  position: 'relative',
                  width: px(60),
                  height: px(60),
                  borderRadius: px(14),
                  border: 'none',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(3),
                  // 选中态:实心蓝底 + 白字 + 外发光(和侧边栏导航保持同一套视觉语言);
                  // 互动面板展开:半透明蓝底 + 蓝色内描边,表示「面板开着」而不是「当前工具」
                  background: disabled
                    ? 'transparent'
                    : isActive
                      ? 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)'
                      : panelOpen
                        ? 'rgba(37,99,235,0.26)'
                        : 'transparent',
                  color: disabled ? '#4b5563' : isActive || panelOpen ? '#ffffff' : '#9ca3af',
                  boxShadow: isActive
                    ? '0 0 0 2px rgba(96,165,250,0.28), 0 6px 18px rgba(37,99,235,0.45)'
                    : panelOpen
                      ? 'inset 0 0 0 2px rgba(96,165,250,0.85)'
                      : 'none',
                  opacity: disabled ? 0.5 : 1,
                  transition: 'all .15s ease',
                  outline: 'none',
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive && !panelOpen && !disabled)
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive && !panelOpen && !disabled)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <Icon size={px(24)} />
                <span style={{ fontSize: px(12), lineHeight: 1, fontWeight: isActive || panelOpen ? 600 : 400 }}>{t.label}</span>

                {/* 角标:画笔/板擦 = 「还有调整菜单」;互动 = 举手人数 / 进行中绿点 */}
                {t.key === 'interact'
                  ? !disabled &&
                    (handsCount > 0 ? (
                      <span
                        style={{
                          position: 'absolute',
                          top: px(2),
                          right: px(2),
                          minWidth: px(17),
                          height: px(17),
                          padding: `0 ${px(4)}px`,
                          borderRadius: px(9),
                          background: '#e5484d',
                          color: '#fff',
                          fontSize: px(11),
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          pointerEvents: 'none',
                          boxShadow: panelOpen ? '0 0 0 2px rgba(255,255,255,0.55)' : 'none',
                        }}
                      >
                        {handsCount}
                      </span>
                    ) : activeSession ? (
                      <span
                        style={{
                          position: 'absolute',
                          top: px(8),
                          right: px(8),
                          width: px(8),
                          height: px(8),
                          borderRadius: '50%',
                          background: '#34d399',
                          boxShadow: '0 0 0 2px rgba(52,211,153,0.25)',
                          pointerEvents: 'none',
                        }}
                      />
                    ) : null)
                  : t.menu &&
                    !disabled && (
                      <span
                        style={{
                          position: 'absolute',
                          top: px(3),
                          right: px(3),
                          width: px(15),
                          height: px(15),
                          borderRadius: '50%',
                          background: menuOpenHere || isActive ? '#ffffff' : 'rgba(255,255,255,0.16)',
                          color: menuOpenHere || isActive ? '#2563eb' : '#cbd5e1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          pointerEvents: 'none',
                          transition: 'all .15s ease',
                        }}
                      >
                        <ChevronUp
                          size={px(11)}
                          style={{
                            transform: menuOpenHere ? 'rotate(180deg)' : 'none',
                            transition: 'transform .15s ease',
                          }}
                        />
                      </span>
                    )}
              </button>
            );
          })}

          {/* 右端收起箭头(收起为半圆,贴底边) */}
          <button
            onClick={() => setCollapsed(true)}
            title="收起"
            style={{
              width: px(34),
              alignSelf: 'stretch',
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              color: '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: 'none',
              padding: 0,
              marginLeft: px(2),
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
            }}
          >
            <svg width={px(22)} height={px(22)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* 调整菜单(画笔设置/板擦大小):独立 fixed 浮层,不参与工具条布局,拖动时不抖。
          菜单从工具条上方「自下而上」滑入 + 淡入,key 保证两个菜单互换时重播动画。 */}
      {openMenu && menuPos && (
        <div
          key={openMenu}
          data-interactive
          data-overlay-anim
          style={{
            position: 'fixed',
            left: menuPos.left,
            bottom: menuPos.bottom,
            zIndex: 72,
            pointerEvents: 'auto',
            // 小屏/低分辨率下菜单可能比可视区还高:限高 + 内部滚动,避免顶出屏幕
            maxHeight: `calc(100vh - ${menuPos.bottom + 12}px)`,
            // 互动面板自己管内部滚动(标题栏 + 结果区),外层不再套一层滚动条
            overflowY: openMenu === 'interact' ? 'visible' : 'auto',
            ...overlayIn('up', 160),
          }}
        >
          {openMenu === 'pen' ? (
            <PenPanel
              config={penConfig}
              onChange={onPenConfigChange}
              pickerOpen={pickerOpen}
              onTogglePicker={() => setPickerOpen((v) => !v)}
            />
          ) : openMenu === 'eraser' ? (
            <EraserPanel radius={eraserRadius} onChange={onEraserRadiusChange} />
          ) : (
            <InteractPanel
              interact={interact}
              members={members}
              studentCount={studentCount}
              onClose={() => setOpenMenu(null)}
            />
          )}
        </div>
      )}

      {/* 颜色盘浮层:贴在画笔面板右侧的独立面板(不占画笔面板高度,取色时不会上下抖)。
          右侧空间不足时自动挪到左侧;关闭方式:再点一次彩虹色块 / 关掉画笔菜单。 */}
      {openMenu === 'pen' && pickerOpen && pickerPos && (
        <div
          key="color-picker"
          data-interactive
          data-overlay-anim
          style={{
            position: 'fixed',
            left: pickerPos.left,
            bottom: pickerPos.bottom,
            zIndex: 73,
            pointerEvents: 'auto',
            maxHeight: `calc(100vh - ${pickerPos.bottom + 12}px)`,
            overflowY: 'auto',
            // 从右侧滑入(颜色盘在画笔面板右边),和浮层入场动画保持一致
            ...overlayIn('right', 160),
          }}
        >
          <div
            style={{
              width: px(292),
              maxWidth: 'calc(100vw - 24px)',
              background: '#1b1b1f',
              borderRadius: px(16),
              border: '1px solid #333339',
              boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
              padding: px(14),
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: px(6),
              }}
            >
              <span style={{ fontSize: px(14), fontWeight: 600, color: '#e5e7eb' }}>颜色盘</span>
              <button
                onClick={() => setPickerOpen(false)}
                title="关闭颜色盘"
                style={{
                  width: px(28),
                  height: px(28),
                  borderRadius: px(8),
                  border: 'none',
                  background: 'transparent',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  outline: 'none',
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
                }}
              >
                <X size={px(16)} />
              </button>
            </div>
            <div style={{ fontSize: px(11), color: '#9ca3af', marginBottom: px(10) }}>
              圆盘选色相/饱和度，右侧竖条调明暗
            </div>
            <ColorWheel
              color={penConfig.color}
              onChange={(hex) => onPenConfigChange({ ...penConfig, color: hex })}
            />
          </div>
        </div>
      )}
    </>
  );
}

// 工具栏操作按钮(黑色,撤销/重做/清空)
function ToolBtn({
  onClick,
  label,
  Icon,
  danger,
  scale,
}: {
  onClick: () => void;
  label: string;
  Icon: LucideIcon;
  danger?: boolean;
  scale: number;
}) {
  const px = (n: number) => scaled(n, scale);
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: px(62),
        height: px(62),
        borderRadius: px(14),
        border: 'none',
        cursor: 'pointer',
        background: '#26262b',
        color: danger ? '#f87171' : '#d1d5db',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: px(3),
        outline: 'none',
        padding: 0,
      }}
    >
      <Icon size={px(24)} />
      <span style={{ fontSize: px(12) }}>{label}</span>
    </button>
  );
}
