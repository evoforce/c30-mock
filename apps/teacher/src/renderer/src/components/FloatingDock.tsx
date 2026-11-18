import { useState, useEffect, useCallback } from 'react';
import type { User } from '@c30/shared';
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
  Undo2,
  Redo2,
  Trash2,
  Check,
  RefreshCw,
  X,
} from 'lucide-react';
import { useDrag } from '../hooks/useDrag';
import PenPanel, { type PenConfig } from './PenPanel';

// C30 风格的桌面悬浮黑色组件:竖排导航(可左右贴边) + 右上角状态 + 底部工具条。
// 竖条左右两侧各有一个折叠箭头(对应同一个组件),老师站在教室任一侧都能点开。

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

// 发送端(教师端)导航:白板 + 上课 + 窗口(其余移除)
// 「窗口」点击后弹出面板:顶部「回到电脑桌面」按钮 + 窗口列表(C30 对齐)
const TEACHER_NAV: NavItem[] = [
  { key: 'whiteboard', label: '白板', icon: <Presentation size={22} /> },
  { key: 'class', label: '上课', icon: <GraduationCap size={22} /> },
  { key: 'windows', label: '窗口', icon: <LayoutGrid size={22} /> },
];

// 接收端(学生端)导航:极简,仅状态展示
const STUDENT_NAV: NavItem[] = [
  { key: 'whiteboard', label: '画面', icon: <Presentation size={22} /> },
];

// 底部工具栏:精简为选择/画笔/板擦/互动/聚焦(移除"更多")
const TOOLBAR = [
  { key: 'select', label: '选择', icon: <MousePointer2 size={20} /> },
  { key: 'pen', label: '画笔', icon: <Pen size={20} /> },
  { key: 'eraser', label: '板擦', icon: <Eraser size={20} /> },
  { key: 'interact', label: '互动', icon: <MessageSquareText size={20} /> },
  { key: 'focus', label: '聚焦', icon: <Focus size={20} /> },
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
  const [menuOpen, setMenuOpen] = useState(false);
  // 窗口面板(点击「窗口」导航项打开):顶部「回到电脑桌面」+ 系统真实窗口列表(代替任务栏)
  const [windowsOpen, setWindowsOpen] = useState(false);
  // 系统窗口列表(标题 + 缩略图 + 句柄)
  const [winList, setWinList] = useState<{ id: string; hwnd: number; title: string; thumbnail: string }[]>([]);
  const [winLoading, setWinLoading] = useState(false);
  // 展开/贴边方向(左右两端始终各有一个入口:当前侧展开,对侧缩起为箭头)
  const [side, setSide] = useState<'left' | 'right'>('right');
  // 垂直位置(默认居中),仅可上下拖动
  const [y, setY] = useState<number | null>(null);

  const navItems = role === 'TEACHER' ? TEACHER_NAV : STUDENT_NAV;

  const onDrag = useDrag('y', (p) => setY(p.y));

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

  const verticalStyle: React.CSSProperties = {
    top: y ?? '50%',
    transform: y != null ? 'none' : 'translateY(-50%)',
  };

  // 左右两端始终各有一个入口:当前侧展开完整侧边栏,对侧缩起为箭头;
  // 点击对侧箭头即把展开切换到那一侧(方便老师在教室左右走动时随手打开)。
  const otherSide: 'left' | 'right' = side === 'right' ? 'left' : 'right';

  return (
    <>
      {/* 对侧缩起入口:老师走到另一侧时可点击展开到该侧 */}
      <div
        data-interactive
        style={{
          position: 'fixed',
          [otherSide]: 0,
          zIndex: 80,
          pointerEvents: 'auto',
          ...verticalStyle,
        }}
      >
        <CollapseArrow
          direction={otherSide}
          onClick={() => setSide(otherSide)}
          label="展开工具栏"
        />
      </div>

      {/* 当前侧展开的完整侧边栏 */}
      <div
        data-interactive
        style={{
          position: 'fixed',
          [side]: 12,
          ...verticalStyle,
          width: 76,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: 'rgba(27, 27, 31, 0.92)',
          borderRadius: 18,
          paddingTop: 16,
          paddingBottom: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          pointerEvents: 'auto',
          zIndex: 80,
        }}
      >
        {/* 顶部拖拽手柄(上下拖动) */}
        <div
          onPointerDown={onDrag}
          title="上下拖动"
          style={{
            position: 'absolute',
            top: -16,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 48,
            height: 16,
            cursor: 'ns-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ width: 32, height: 5, borderRadius: 3, background: '#9ca3af' }} />
        </div>

        {/* 折叠按钮(切到对侧):点击后展开移到对侧,本侧缩起为箭头 */}
        <button
          onClick={() => setSide(otherSide)}
          title="切到另一侧"
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            [side === 'right' ? 'left' : 'right']: -20,
            width: 24,
            height: 64,
            border: 'none',
            cursor: 'pointer',
            background: 'rgba(27,27,31,0.95)',
            color: '#e5e7eb',
            borderRadius: side === 'right' ? '12px 0 0 12px' : '0 12px 12px 0',
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
          {side === 'right' ? <ChevronRight size={22} /> : <ChevronLeft size={22} />}
        </button>

      {/* 头像 + 名称 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: role === 'TEACHER' ? '#2563eb' : '#16a34a',
            color: '#fff',
            fontSize: 18,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          {user.name.charAt(0)}
        </button>
        <span style={{ fontSize: 11, color: '#d1d5db', maxWidth: 64, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.name}
        </span>
      </div>

      {/* 导航项 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 16 }}>
        {navItems.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              // 「窗口」项点击打开窗口面板(而非切换视图);其余项触发 onChange
              onClick={() => (item.key === 'windows' ? setWindowsOpen((v) => !v) : onChange(item.key))}
              title={item.label}
              style={{
                width: 54,
                height: 54,
                borderRadius: 14,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                background: isActive ? 'rgba(255,255,255,0.16)' : 'transparent',
                color: isActive ? '#ffffff' : '#9ca3af',
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
              {item.icon}
              <span style={{ fontSize: 11, lineHeight: 1 }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* 底部:菜单(点击打开设置窗口) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <button
          title="菜单"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            width: 54,
            height: 54,
            borderRadius: 14,
            border: 'none',
            cursor: 'pointer',
            background: 'transparent',
            color: '#9ca3af',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            outline: 'none',
            padding: 0,
          }}
        >
          <Menu size={22} />
          <span style={{ fontSize: 11 }}>菜单</span>
        </button>
      </div>
      </div>

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
            width: 360,
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #e5e7eb',
            padding: 20,
            zIndex: 121,
            boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
          }}
        >
            {/* 标题栏 + 关闭叉号 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>系统设置</div>
              <button
                onClick={() => setMenuOpen(false)}
                title="关闭"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
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
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>
              {user.name} · {role === 'TEACHER' ? '发送端' : '接收端'} · {memberCount} 人在线
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* 开机自启 */}
              <SettingRow
                label="开机自启"
                desc="登录系统后自动启动教师端"
                checked={settings.autoLaunch}
                onChange={(v) => onSettingsChange({ autoLaunch: v })}
              />
              {/* 展示教室信息 */}
              <SettingRow
                label="展示教室信息"
                desc="右上角显示网络/班级/人数"
                checked={settings.showClassInfo}
                onChange={(v) => onSettingsChange({ showClassInfo: v })}
              />
              {/* 允许互动 */}
              <SettingRow
                label="允许互动"
                desc="关闭后底部「互动」按钮置灰"
                checked={settings.allowInteraction}
                onChange={(v) => onSettingsChange({ allowInteraction: v })}
              />
            </div>

            {role === 'TEACHER' && (
              <button
                onClick={onLogout}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: 16,
                  border: 'none',
                  borderRadius: 8,
                  background: '#fee2e2',
                  color: '#dc2626',
                  fontSize: 14,
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
            // 显示在侧边栏的对侧,避免与侧边栏重叠或超出屏幕
            [side === 'right' ? 'left' : 'right']: 24,
            transform: 'translateY(-50%)',
            width: 320,
            background: '#ffffff',
            borderRadius: 16,
            padding: 14,
            zIndex: 21,
            boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
            {/* 标题栏 + 关闭叉号 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#1f2937' }}>窗口</span>
              <button
                onClick={() => setWindowsOpen(false)}
                title="关闭"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
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
                <X size={16} />
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
                gap: 10,
                width: '100%',
                padding: '10px 12px',
                border: 'none',
                borderRadius: 10,
                background: '#eaf1fb',
                color: '#1f2937',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#2563eb',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Monitor size={18} />
              </span>
              回到电脑桌面
            </button>

            {/* 窗口列表标题 + 刷新 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>已打开的窗口</span>
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
                  gap: 4,
                  fontSize: 11,
                  padding: 2,
                  outline: 'none',
                }}
              >
                <RefreshCw size={13} style={{ animation: winLoading ? 'spin 1s linear infinite' : 'none' }} />
                刷新
              </button>
            </div>

            {/* 系统窗口列表(缩略图 + 标题,点击提到前台) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' }}>
              {winLoading && winList.length === 0 && (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
                  正在读取窗口…
                </div>
              )}
              {!winLoading && winList.length === 0 && (
                <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
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
                    gap: 10,
                    padding: 6,
                    borderRadius: 10,
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
                        width: 64,
                        height: 40,
                        borderRadius: 6,
                        objectFit: 'cover',
                        background: '#e5e7eb',
                        flexShrink: 0,
                        border: '1px solid #e5e7eb',
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 64,
                        height: 40,
                        borderRadius: 6,
                        background: '#e5e7eb',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af',
                      }}
                    >
                      <Monitor size={18} />
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 13,
                      color: '#1f2937',
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
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, color: '#1f2937' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>{desc}</span>
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        title={label}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
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
            top: 2,
            left: checked ? 22 : 2,
            width: 20,
            height: 20,
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

// 折叠箭头(贴边,点击展开)
function CollapseArrow({
  direction,
  onClick,
  label,
}: {
  direction: 'left' | 'right';
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 34,
        height: 96,
        border: 'none',
        cursor: 'pointer',
        background: 'rgba(27,27,31,0.95)',
        color: '#e5e7eb',
        borderRadius: direction === 'left' ? '0 18px 18px 0' : '18px 0 0 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        outline: 'none',
        padding: 0,
        transition: 'background .15s ease, width .15s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.95)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(27,27,31,0.95)';
      }}
    >
      {direction === 'left' ? <ChevronRight size={26} /> : <ChevronLeft size={26} />}
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
  return (
    <div
      data-interactive
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '0 20px',
        height: 48,
        background: 'rgba(27,27,31,0.92)',
        borderRadius: 16,
        color: '#d1d5db',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 13 }}>
        <Wifi size={16} />
        <span>{networkStatus === 'direct' ? '局域网' : networkStatus === 'relay' ? '中继' : '离线'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 13 }}>
        <UsersRound size={16} />
        <span>班级</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#9ca3af', fontSize: 13 }}>
        <Users size={16} />
        <span>{memberCount} 人</span>
      </div>
    </div>
  );
}

// 底部悬浮工具条(选择/画笔/板擦/互动/聚焦/更多),贴底边,可左右拖动 + 中间半圆折叠箭头。
// 画笔模式下在工具条上方浮出黑色画笔设置面板 + 撤销/清空/完成按钮,替代白色控件。
export function BottomToolbar({
  activeTool,
  onToolChange,
  penConfig,
  onPenConfigChange,
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
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onComplete: () => void;
  // 是否允许互动(设置项关闭时,互动按钮置灰并弹提示)
  allowInteraction?: boolean;
}) {
  const [x, setX] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // 互动被禁时的 toast
  const [toast, setToast] = useState<string | null>(null);
  const onDrag = useDrag('x', (p) => setX(p.x));

  const isPen = activeTool === 'pen';

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  // 点击工具栏按钮:互动被禁时拦截并提示
  const handleToolClick = (key: string) => {
    if (key === 'interact' && !allowInteraction) {
      setToast('互动功能已被关闭');
      return;
    }
    onToolChange(key);
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
            width: 88,
            height: 36,
            border: 'none',
            cursor: 'pointer',
            background: 'rgba(27,27,31,0.95)',
            color: '#e5e7eb',
            borderRadius: '18px 18px 0 0',
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      data-interactive
      style={{
        position: 'fixed',
        bottom: 16,
        left: x ?? '50%',
        transform: x != null ? 'none' : 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'auto',
        zIndex: 70,
      }}
    >
      {/* 画笔模式:黑色画笔设置面板 + 撤销/清空/完成(悬浮在工具条上方) */}
      {isPen && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <PenPanel config={penConfig} onChange={onPenConfigChange} />
          <div style={{ display: 'flex', gap: 10 }}>
            <ToolBtn onClick={onUndo} label="撤销" icon={<Undo2 size={22} />} />
            <ToolBtn onClick={onRedo} label="重做" icon={<Redo2 size={22} />} />
            <ToolBtn onClick={onClear} label="清空" icon={<Trash2 size={22} />} danger />
            <ToolBtn onClick={onComplete} label="完成" icon={<Check size={22} />} primary />
          </div>
        </div>
      )}

      {/* 互动被禁提示 toast(悬浮在工具条上方) */}
      {toast && (
        <div
          style={{
            background: '#1b1b1f',
            color: '#e5e7eb',
            fontSize: 13,
            padding: '8px 16px',
            borderRadius: 16,
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
          gap: 6,
          padding: '8px 12px',
          borderRadius: 18,
          background: '#1b1b1f',
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        }}
      >
        {/* 左端拖拽手柄 */}
        <div
          onPointerDown={onDrag}
          title="左右拖动"
          style={{
            width: 16,
            alignSelf: 'stretch',
            cursor: 'ew-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 2,
          }}
        >
          <div style={{ width: 5, height: 26, borderRadius: 3, background: '#9ca3af' }} />
        </div>

        {TOOLBAR.map((t) => {
          const disabled = t.key === 'interact' && !allowInteraction;
          return (
            <button
              key={t.key}
              onClick={() => handleToolClick(t.key)}
              title={disabled ? '互动功能已被关闭' : t.label}
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                background: activeTool === t.key && !disabled ? 'rgba(255,255,255,0.18)' : 'transparent',
                color: disabled ? '#4b5563' : activeTool === t.key ? '#fff' : '#9ca3af',
                opacity: disabled ? 0.5 : 1,
                transition: 'background .15s ease',
                outline: 'none',
                padding: 0,
              }}
            >
              {t.icon}
              <span style={{ fontSize: 11, lineHeight: 1 }}>{t.label}</span>
            </button>
          );
        })}

        {/* 右端折叠箭头(收起为半圆,贴底边) */}
        <button
          onClick={() => setCollapsed(true)}
          title="收起"
          style={{
            width: 32,
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
            marginLeft: 2,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// 工具栏操作按钮(黑色,撤销/清空/完成)
function ToolBtn({
  onClick,
  label,
  icon,
  danger,
  primary,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        border: 'none',
        cursor: 'pointer',
        background: primary ? '#2563eb' : '#26262b',
        color: primary ? '#fff' : danger ? '#f87171' : '#d1d5db',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        outline: 'none',
        padding: 0,
      }}
    >
      {icon}
      <span style={{ fontSize: 11 }}>{label}</span>
    </button>
  );
}
