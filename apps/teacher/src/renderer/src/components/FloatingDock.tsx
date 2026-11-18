import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { User, EraserMode } from '@c30/shared';
import {
  GraduationCap,
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
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  Undo2,
  Redo2,
  Trash2,
  Check,
  RefreshCw,
  X,
} from 'lucide-react';
import { useDrag } from '../hooks/useDrag';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import PenPanel, { type PenConfig } from './PenPanel';
import EraserPanel from './EraserPanel';

// C30 风格的桌面悬浮黑色组件:竖排导航(可左右贴边) + 右上角状态 + 底部工具条。
// 竖条左右两侧各有一个折叠箭头(对应同一个组件),老师站在教室任一侧都能点开。
// 所有浮层尺寸都按 useOverlayScale 动态缩放:屏幕越大浮层越大,讲台边上也能一次点中。

interface NavItem {
  key: string;
  label: string;
  Icon: LucideIcon;
}

// 发送端(教师端)导航:白板 + 上课 + 窗口(其余移除)
// 「窗口」点击后弹出面板:顶部「回到电脑桌面」按钮 + 窗口列表(C30 对齐)
const TEACHER_NAV: NavItem[] = [
  { key: 'whiteboard', label: '白板', Icon: Presentation },
  { key: 'class', label: '上课', Icon: GraduationCap },
  { key: 'windows', label: '窗口', Icon: LayoutGrid },
];

// 接收端(学生端)导航:极简,仅状态展示
const STUDENT_NAV: NavItem[] = [{ key: 'whiteboard', label: '画面', Icon: Presentation }];

interface ToolItem {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** 该工具是否有「更多」调整菜单(有则按钮右上角显示展开角标) */
  menu?: 'pen' | 'eraser';
}

// 底部工具栏:选择/画笔/板擦/互动/聚焦。
// 交互约定:第一次点击 = 切换到该功能;再次点击已激活且带菜单的工具 = 展开/收起调整菜单。
const TOOLBAR: ToolItem[] = [
  { key: 'select', label: '选择', Icon: MousePointer2 },
  { key: 'pen', label: '画笔', Icon: Pen, menu: 'pen' },
  { key: 'eraser', label: '板擦', Icon: Eraser, menu: 'eraser' },
  { key: 'interact', label: '互动', Icon: MessageSquareText },
  { key: 'focus', label: '聚焦', Icon: Focus },
];

export default function FloatingDock({
  role,
  active,
  onChange,
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
  user: User;
  onLogout: () => void;
  memberCount: number;
  networkStatus: 'direct' | 'relay' | '';
  settings: { autoLaunch: boolean; showClassInfo: boolean; allowInteraction: boolean };
  onSettingsChange: (patch: Partial<{ autoLaunch: boolean; showClassInfo: boolean; allowInteraction: boolean }>) => void;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const [menuOpen, setMenuOpen] = useState(false);
  // 窗口面板(点击「窗口」导航项打开):顶部「回到电脑桌面」+ 系统真实窗口列表(代替任务栏)
  const [windowsOpen, setWindowsOpen] = useState(false);
  // 系统窗口列表(标题 + 缩略图 + 句柄)
  const [winList, setWinList] = useState<{ id: string; hwnd: number; title: string; thumbnail: string; minimized?: boolean }[]>([]);
  const [winLoading, setWinLoading] = useState(false);
  // 左侧/右侧浮层各自独立:
  //   · openSide = null 表示两侧都收起(允许);同时最多只展开一侧。
  //   · sideY 记录两侧各自的垂直位置(视觉 top,px;null = 垂直居中),
  //     改一侧的高度或位置不会带动另一侧。
  const [openSide, setOpenSide] = useState<'left' | 'right' | null>('right');
  const [sideY, setSideY] = useState<Record<'left' | 'right', number | null>>({ left: null, right: null });
  const leftDockRef = useRef<HTMLDivElement>(null);
  const rightDockRef = useRef<HTMLDivElement>(null);

  const navItems = role === 'TEACHER' ? TEACHER_NAV : STUDENT_NAV;

  // 把某一侧的 top 夹在屏幕内(用该侧自身实际高度,不读另一侧)
  const setSideYClamped = useCallback((side: 'left' | 'right', top: number, el: HTMLElement | null) => {
    const h = el?.getBoundingClientRect().height ?? 0;
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    setSideY((prev) => ({ ...prev, [side]: Math.max(8, Math.min(top, maxTop)) }));
  }, []);

  // 展开态拖动:按「侧边栏自身矩形」算位移,不按把手的矩形(否则会跳 16px)
  const startDockDrag = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = side === 'left' ? leftDockRef.current : rightDockRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const startClientY = e.clientY;
    const startTop = el.getBoundingClientRect().top;
    const onMove = (ev: PointerEvent) => {
      setSideYClamped(side, startTop + (ev.clientY - startClientY), el);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
          data-interactive
          style={{
            position: 'fixed',
            left: 0,
            zIndex: 80,
            pointerEvents: 'auto',
            ...verticalStyle('left'),
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
          data-interactive
          style={{
            position: 'fixed',
            right: 0,
            zIndex: 80,
            pointerEvents: 'auto',
            ...verticalStyle('right'),
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

      {/* 当前展开的侧边栏(同时最多只展开一侧;也可以两侧都收起) */}
      {openSide !== null && (
      <div
        ref={openSide === 'left' ? leftDockRef : rightDockRef}
        data-interactive
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
          zIndex: 80,
        }}
      >
        {/* 顶部拖拽手柄(上下拖动) */}
        <div
          onPointerDown={startDockDrag(openSide)}
          title="上下拖动"
          style={{
            position: 'absolute',
            top: -px(16),
            left: '50%',
            transform: 'translateX(-50%)',
            width: px(52),
            height: px(16),
            cursor: 'ns-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: px(34), height: px(5), borderRadius: px(3), background: '#9ca3af' }} />
        </div>

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
            onClick={() => setMenuOpen((v) => !v)}
            title={`${user.name} · 设置`}
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

        {/* 导航项 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(10), marginTop: px(16) }}>
          {navItems.map((item) => {
            const isActive = active === item.key;
            const Icon = item.Icon;
            return (
              <button
                key={item.key}
                // 「窗口」项点击打开窗口面板(而非切换视图);其余项触发 onChange
                onClick={() => (item.key === 'windows' ? setWindowsOpen((v) => !v) : onChange(item.key))}
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

        {/* 底部:菜单(点击打开设置窗口) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(8), marginTop: 'auto' }}>
          <button
            title="菜单"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              width: px(60),
              height: px(60),
              borderRadius: px(14),
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              color: '#9ca3af',
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

      {/* 系统设置窗口(菜单点击打开):开机自启 / 展示教室信息 / 允许互动 */}
      {/* 注意:面板必须在侧边栏容器之外渲染,否则侧边栏的 transform 会使 fixed 定位失效 */}
      {menuOpen && (
        <div
          data-interactive
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
          }}
        >
          {/* 标题栏 + 关闭叉号 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: px(4) }}>
            <div style={{ fontSize: px(18), fontWeight: 600, color: '#1f2937' }}>系统设置</div>
            <button
              onClick={() => setMenuOpen(false)}
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
            {user.name} · {role === 'TEACHER' ? '发送端' : '接收端'} · {memberCount} 人在线
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
              desc="关闭后底部「互动」按钮置灰"
              checked={settings.allowInteraction}
              onChange={(v) => onSettingsChange({ allowInteraction: v })}
              scale={s}
            />
          </div>

          {role === 'TEACHER' && (
            <button
              onClick={onLogout}
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

      {/* 窗口面板(「窗口」导航项点击打开):顶部「回到电脑桌面」+ 系统窗口列表(代替任务栏) */}
      {windowsOpen && (
        <div
          data-interactive
          style={{
            position: 'fixed',
            top: '50%',
            // 显示在侧边栏的对侧,避免与侧边栏重叠或超出屏幕;两侧都收起时按右侧算
            [openSide === 'left' ? 'right' : 'left']: px(24),
            transform: 'translateY(-50%)',
            width: px(380),
            maxWidth: 'calc(100vw - 32px)',
            background: '#ffffff',
            borderRadius: px(16),
            padding: px(16),
            zIndex: 82,
            boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
            display: 'flex',
            flexDirection: 'column',
            gap: px(10),
            pointerEvents: 'auto',
          }}
        >
          {/* 标题栏 + 关闭叉号 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: px(16), fontWeight: 600, color: '#1f2937' }}>窗口</span>
            <button
              onClick={() => setWindowsOpen(false)}
              title="关闭"
              style={{
                width: px(30),
                height: px(30),
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
              border: 'none',
              borderRadius: px(10),
              background: '#eaf1fb',
              color: '#1f2937',
              fontSize: px(15),
              fontWeight: 500,
              cursor: 'pointer',
              textAlign: 'left',
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
            <span style={{ fontSize: px(13), color: '#6b7280', fontWeight: 500 }}>已打开的窗口</span>
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
            >
              <RefreshCw size={px(14)} style={{ animation: winLoading ? 'spin 1s linear infinite' : 'none' }} />
              刷新
            </button>
          </div>

          {/* 系统窗口列表(缩略图 + 标题,点击提到前台) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: px(6), maxHeight: px(320), overflow: 'auto' }}>
            {winLoading && winList.length === 0 && (
              <div style={{ padding: `${px(20)}px 0`, textAlign: 'center', fontSize: px(13), color: '#9ca3af' }}>
                正在读取窗口…
              </div>
            )}
            {!winLoading && winList.length === 0 && (
              <div style={{ padding: `${px(20)}px 0`, textAlign: 'center', fontSize: px(13), color: '#9ca3af' }}>
                未检测到其他应用窗口
              </div>
            )}
            {winList.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  // 聚焦单窗口:最小化其他窗口,只保留该窗口在桌面展示
                  (window as any).api?.windows?.focus?.(w.hwnd);
                  // 聚焦后收起面板,让教师直接查看目标窗口
                  setWindowsOpen(false);
                }}
                title={`只显示「${w.title}」,其余最小化`}
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
                  (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6';
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
                      background: '#e5e7eb',
                      flexShrink: 0,
                      border: '1px solid #e5e7eb',
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: px(78),
                      height: px(48),
                      borderRadius: px(6),
                      background: '#e5e7eb',
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
                    color: '#1f2937',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                >
                  {w.title}
                </span>
                {w.minimized && (
                  <span style={{ fontSize: px(12), color: '#9ca3af', flexShrink: 0 }}>已最小化</span>
                )}
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
//   · 按住上下拖 = 调整这一侧的位置(位移超过 4px 就判定为拖动,松手不触发展开);
//   · 下方两道短横是「可拖动」的视觉提示,避免老师以为它只能点。
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
      {/* 拖动把手提示 */}
      <span style={{ display: 'flex', flexDirection: 'column', gap: px(3), opacity: 0.5 }}>
        <span style={{ width: px(14), height: px(2), borderRadius: px(1), background: 'currentColor' }} />
        <span style={{ width: px(14), height: px(2), borderRadius: px(1), background: 'currentColor' }} />
      </span>
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
//
// 选择逻辑(本次优化重点):
//   · 第一次点击某个工具 → 立刻切换到该功能(不做二次确认,不弹菜单);
//   · 再次点击「已激活」且带菜单的工具(画笔/板擦) → 展开/收起它的调整菜单;
//   · 带菜单的工具在按钮右上角有一枚小箭头角标(未展开朝上、展开后朝下),
//     配合 tooltip「再点一次调整」,老师不用猜就能知道这个按钮还有第二层;
//   · 选中态用「实心蓝底 + 白字加粗 + 蓝色外发光」,并额外显示撤销/重做/清空/完成操作条。
export function BottomToolbar({
  activeTool,
  onToolChange,
  penConfig,
  onPenConfigChange,
  eraserRadius,
  onEraserRadiusChange,
  eraserMode,
  onEraserModeChange,
  onUndo,
  onRedo,
  onClear,
  onComplete,
  allowInteraction = true,
}: {
  activeTool: string;
  onToolChange: (key: string) => void;
  penConfig: PenConfig;
  onPenConfigChange: (c: PenConfig) => void;
  eraserRadius: number;
  onEraserRadiusChange: (radius: number) => void;
  // 板擦擦除方式(清笔迹 / 区域擦除),由「板擦」高级菜单切换
  eraserMode: EraserMode;
  onEraserModeChange: (mode: EraserMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onComplete: () => void;
  // 是否允许互动(设置项关闭时,互动按钮置灰并弹提示)
  allowInteraction?: boolean;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const [x, setX] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // 当前展开的调整菜单(画笔/板擦);null = 未展开
  const [openMenu, setOpenMenu] = useState<'pen' | 'eraser' | null>(null);
  // 互动被禁时的 toast
  const [toast, setToast] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // 菜单是 fixed 浮层(不撑开工具条布局),位置随工具条矩形实时计算
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);

  const isDrawingTool = activeTool === 'pen' || activeTool === 'eraser';

  // 左右拖动:夹在屏幕内,避免把工具条拖到屏幕外
  const onDrag = useDrag('x', (p) => {
    const w = wrapRef.current?.getBoundingClientRect().width ?? 0;
    setX(Math.max(8, Math.min(p.x, window.innerWidth - w - 8)));
  });

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  // 工具被外部切换(进白板默认画笔 / 退出白板复位选择 / 点完成)时,关掉已不匹配的菜单
  useEffect(() => {
    if (openMenu && openMenu !== activeTool) setOpenMenu(null);
  }, [activeTool, openMenu]);

  // 收起工具条时同时收起菜单
  useEffect(() => {
    if (collapsed) setOpenMenu(null);
  }, [collapsed]);

  // 计算菜单位置:水平居中对齐工具条并夹在屏幕内;垂直贴在工具条(含操作条)上方
  useLayoutEffect(() => {
    if (!openMenu || collapsed) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menuWidth = scaled(openMenu === 'pen' ? 400 : 360, s);
      const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
      const left = Math.min(maxLeft, Math.max(8, rect.left + rect.width / 2 - menuWidth / 2));
      const bottom = Math.max(8, window.innerHeight - rect.top + scaled(10, s));
      setMenuPos({ left, bottom });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [openMenu, collapsed, s, x]);

  // 点击工具:先切功能,再(同一按钮)开菜单
  const handleToolClick = (tool: ToolItem) => {
    if (tool.key === 'interact' && !allowInteraction) {
      setToast('互动功能已被关闭');
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
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'auto',
          zIndex: 70,
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
          zIndex: 70,
        }}
      >
        {/* 画笔/板擦激活时:撤销/重做/清空/完成 操作条(悬浮在工具条上方) */}
        {isDrawingTool && (
          <div style={{ display: 'flex', gap: px(10) }}>
            <ToolBtn onClick={onUndo} label="撤销" Icon={Undo2} scale={s} />
            <ToolBtn onClick={onRedo} label="重做" Icon={Redo2} scale={s} />
            <ToolBtn onClick={onClear} label="清空" Icon={Trash2} danger scale={s} />
            <ToolBtn onClick={onComplete} label="完成" Icon={Check} primary scale={s} />
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

        {/* 工具条本体 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: px(6),
            padding: `${px(8)}px ${px(12)}px`,
            borderRadius: px(20),
            background: '#1b1b1f',
            boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
          }}
        >
          {/* 左端拖拽手柄 */}
          <div
            onPointerDown={onDrag}
            title="左右拖动"
            style={{
              width: px(18),
              alignSelf: 'stretch',
              cursor: 'ew-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: px(2),
            }}
          >
            <div style={{ width: px(5), height: px(28), borderRadius: px(3), background: '#6b7280' }} />
          </div>

          {TOOLBAR.map((t) => {
            const disabled = t.key === 'interact' && !allowInteraction;
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
                    : t.menu
                      ? `${t.label}(再点一次调整)`
                      : t.label
                }
                aria-pressed={isActive}
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
                  // 选中态:实心蓝底 + 白字 + 外发光(和侧边栏导航保持同一套视觉语言)
                  background: disabled
                    ? 'transparent'
                    : isActive
                      ? 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)'
                      : 'transparent',
                  color: disabled ? '#4b5563' : isActive ? '#ffffff' : '#9ca3af',
                  boxShadow: isActive ? '0 0 0 2px rgba(96,165,250,0.28), 0 6px 18px rgba(37,99,235,0.45)' : 'none',
                  opacity: disabled ? 0.5 : 1,
                  transition: 'all .15s ease',
                  outline: 'none',
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive && !disabled)
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive && !disabled)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <Icon size={px(24)} />
                <span style={{ fontSize: px(12), lineHeight: 1, fontWeight: isActive ? 600 : 400 }}>{t.label}</span>

                {/* 「有更多菜单」角标:未展开朝上、展开后朝下 */}
                {t.menu && !disabled && (
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

      {/* 调整菜单(画笔设置/板擦大小):独立 fixed 浮层,不参与工具条布局,拖动时不抖 */}
      {openMenu && menuPos && (
        <div
          data-interactive
          style={{
            position: 'fixed',
            left: menuPos.left,
            bottom: menuPos.bottom,
            zIndex: 72,
            pointerEvents: 'auto',
          }}
        >
          {openMenu === 'pen' ? (
            <PenPanel config={penConfig} onChange={onPenConfigChange} />
          ) : (
            <EraserPanel
              radius={eraserRadius}
              onChange={onEraserRadiusChange}
              mode={eraserMode}
              onModeChange={onEraserModeChange}
            />
          )}
        </div>
      )}
    </>
  );
}

// 工具栏操作按钮(黑色,撤销/重做/清空/完成)
function ToolBtn({
  onClick,
  label,
  Icon,
  danger,
  primary,
  scale,
}: {
  onClick: () => void;
  label: string;
  Icon: LucideIcon;
  danger?: boolean;
  primary?: boolean;
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
        background: primary ? '#2563eb' : '#26262b',
        color: primary ? '#fff' : danger ? '#f87171' : '#d1d5db',
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
