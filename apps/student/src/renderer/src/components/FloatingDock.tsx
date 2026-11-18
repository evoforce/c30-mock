import { useState, useRef, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { User } from '@c30/shared';
import {
  GraduationCap,
  Presentation,
  FileText,
  BookOpen,
  MonitorPlay,
  LayoutGrid,
  Menu,
  Wifi,
  Users,
  UsersRound,
  MousePointer2,
  Pen,
  Eraser,
  MessageSquareText,
  Focus,
  MoreHorizontal,
  ChevronRight,
  ChevronLeft,
  Undo2,
  Redo2,
  Trash2,
} from 'lucide-react';
import { useDragAnywhere } from '../hooks/useDragAnywhere';
import { overlayIn } from '../lib/overlayAnim';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import PenPanel, { type PenConfig } from './PenPanel';

// C30 风格的桌面悬浮黑色组件:竖排导航(可左右贴边) + 右上角状态 + 底部工具条。
// 竖条左右两侧各有一个折叠箭头(对应同一个组件),老师站在教室任一侧都能点开。
// 所有浮层尺寸都按 useOverlayScale 动态缩放:屏幕越大浮层越大,远距离也能点中。

interface NavItem {
  key: string;
  label: string;
  Icon: LucideIcon;
}

const TEACHER_NAV: NavItem[] = [
  { key: 'whiteboard', label: '白板', Icon: Presentation },
  { key: 'class', label: '上课', Icon: GraduationCap },
  { key: 'textbook', label: '课本', Icon: BookOpen },
  { key: 'courseware', label: '课件', Icon: FileText },
  { key: 'comment', label: '讲评', Icon: MonitorPlay },
];

const STUDENT_NAV: NavItem[] = [
  { key: 'class', label: '上课', Icon: GraduationCap },
  { key: 'courseware', label: '课件', Icon: FileText },
  { key: 'whiteboard', label: '白板', Icon: Presentation },
];

const TOOLBAR = [
  { key: 'select', label: '选择', icon: <MousePointer2 size={20} /> },
  { key: 'pen', label: '画笔', icon: <Pen size={20} /> },
  { key: 'eraser', label: '板擦', icon: <Eraser size={20} /> },
  { key: 'interact', label: '互动', icon: <MessageSquareText size={20} /> },
  { key: 'focus', label: '聚焦', icon: <Focus size={20} /> },
  { key: 'more', label: '更多', icon: <MoreHorizontal size={20} /> },
];

export default function FloatingDock({
  role,
  active,
  onChange,
  user,
  onLogout,
  memberCount,
  networkStatus,
}: {
  role: 'TEACHER' | 'STUDENT';
  active: string;
  onChange: (key: string) => void;
  user: User;
  onLogout: () => void;
  memberCount: number;
  networkStatus: 'direct' | 'relay' | '';
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 展开/折叠 + 贴边方向(左右对应同一组件)
  const [collapsed, setCollapsed] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('right');
  // 垂直位置(默认居中),仅可上下拖动
  const [y, setY] = useState<number | null>(null);

  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const navItems = role === 'TEACHER' ? TEACHER_NAV : STUDENT_NAV;

  const dockRef = useRef<HTMLDivElement>(null);

  // 把 top 夹在屏幕内(用当前组件自身高度:收起后的箭头比展开态矮,各自夹各自的)
  const topClamped = useCallback((top: number, el: HTMLElement | null) => {
    const h = el?.getBoundingClientRect().height ?? 0;
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    return Math.max(8, Math.min(top, maxTop));
  }, []);

  // 展开态拖动:侧边栏任意位置按下都能拖(含按钮),位移 <5px 仍算点击;
  // 浮层上不再有任何拖拽把手/图标。
  const dockDrag = useDragAnywhere('y', (p) => {
    setY(topClamped(p.y, dockRef.current));
  });

  const verticalStyle: React.CSSProperties = {
    top: y ?? '50%',
    transform: y != null ? 'none' : 'translateY(-50%)',
  };

  // 折叠态:仅在当前贴边侧显示一个箭头(点击展开;按住可上下拖动调整位置)
  if (collapsed) {
    return (
      <div
        key={`arrow-${side}`}
        data-interactive
        data-overlay-anim
        style={{
          position: 'fixed',
          [side]: 0,
          zIndex: 80,
          pointerEvents: 'auto',
          ...verticalStyle,
          // 从贴边那一侧滑入 + 淡入
          ...overlayIn(side),
        }}
      >
        <SideArrow
          direction={side}
          onOpen={() => setCollapsed(false)}
          onMove={(top) => setY(top)}
          scale={s}
        />
      </div>
    );
  }

  return (
    <div
      key={`dock-${side}`}
      ref={dockRef}
      data-interactive
      data-overlay-anim
      onPointerDown={dockDrag.onPointerDown}
      onClickCapture={dockDrag.onClickCapture}
      style={{
        position: 'fixed',
        [side]: px(12),
        ...verticalStyle,
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
        // 从贴边那一侧滑入 + 淡入
        ...overlayIn(side),
      }}
    >
      {/* 折叠按钮(贴边侧的对侧,垂直居中,半圆形) */}
      <button
        onClick={() => setCollapsed(true)}
        title="收起"
        style={{
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          [side === 'right' ? 'left' : 'right']: -px(20),
          width: px(26),
          height: px(68),
          border: 'none',
          cursor: 'pointer',
          background: 'rgba(27,27,31,0.95)',
          color: '#e5e7eb',
          borderRadius: side === 'right' ? `${px(12)}px 0 0 ${px(12)}px` : `0 ${px(12)}px ${px(12)}px 0`,
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
        {side === 'right' ? <ChevronRight size={px(24)} /> : <ChevronLeft size={px(24)} />}
      </button>

      {/* 头像 + 名称 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(5) }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="菜单"
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
        <span style={{ fontSize: px(12), color: '#d1d5db', maxWidth: px(70), textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              onClick={() => onChange(item.key)}
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
                // 选中态:实心蓝底 + 白字 + 外发光
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

      {/* 底部:窗口/菜单 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <button
          title="窗口"
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
          <LayoutGrid size={px(24)} />
          <span style={{ fontSize: px(12) }}>窗口</span>
        </button>
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

      {/* 弹出菜单(头像/菜单点击) */}
      {menuOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenuOpen(false)} />
          <div
            style={{
              position: 'absolute',
              [side === 'right' ? 'left' : 'right']: px(72),
              bottom: px(20),
              width: px(220),
              background: '#26262b',
              borderRadius: px(10),
              border: '1px solid #3a3a40',
              padding: px(6),
              zIndex: 21,
            }}
          >
            <div style={{ padding: `${px(8)}px ${px(10)}px ${px(10)}px`, borderBottom: '1px solid #3a3a40' }}>
              <div style={{ fontSize: px(15), fontWeight: 600, color: '#fff' }}>{user.name}</div>
              <div style={{ fontSize: px(13), color: '#9ca3af', marginTop: px(2) }}>
                {role === 'TEACHER' ? '教师账号' : '学生账号'}
              </div>
            </div>
            <button
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
              style={{
                width: '100%',
                padding: px(10),
                marginTop: px(4),
                border: 'none',
                background: 'transparent',
                color: '#f87171',
                fontSize: px(15),
                textAlign: 'left',
                borderRadius: px(6),
                cursor: 'pointer',
                display: role === 'STUDENT' ? 'none' : 'flex',
                alignItems: 'center',
                gap: px(8),
              }}
            >
              退出登录
            </button>
          </div>
        </>
      )}

      {/* 退出确认 */}
      {confirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setConfirmOpen(false)}
        >
          <div
            style={{
              width: px(360),
              maxWidth: 'calc(100vw - 32px)',
              background: '#ffffff',
              borderRadius: px(14),
              padding: px(24),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: px(17), fontWeight: 600, color: '#1f2937' }}>确认退出登录?</div>
            <p style={{ fontSize: px(14), color: '#7c8494', margin: `${px(10)}px 0 ${px(22)}px` }}>退出后需要重新连接课堂才能继续使用。</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: px(10) }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{ padding: `${px(9)}px ${px(18)}px`, border: '1px solid #e2e5ea', borderRadius: px(8), background: '#fff', color: '#4b5563', fontSize: px(14), cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={onLogout}
                style={{ padding: `${px(9)}px ${px(18)}px`, border: 'none', borderRadius: px(8), background: '#e5484d', color: '#fff', fontSize: px(14), cursor: 'pointer' }}
              >
                退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 贴边收起箭头:
//   · 单击 = 展开;
//   · 按住上下拖 = 调整位置(位移超过 4px 判为拖动,松手不触发展开);
//   · 下方两道短横是「可拖动」的视觉提示。
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
      if (Math.abs(dy) < 4) return;
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
}: {
  activeTool: string;
  onToolChange: (key: string) => void;
  penConfig: PenConfig;
  onPenConfigChange: (c: PenConfig) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  const [x, setX] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // 整条工具条任意位置可拖(位移 <5px 仍算点击),没有拖拽手柄
  const barDrag = useDragAnywhere('x', (p) => setX(p.x));

  const isPen = activeTool === 'pen';

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
          ...overlayIn('up', 160),
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
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      data-interactive
      data-overlay-anim
      onPointerDown={barDrag.onPointerDown}
      onClickCapture={barDrag.onClickCapture}
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
        userSelect: 'none',
        zIndex: 70,
        // 贴底边:从屏幕下方往上滑入 + 淡入
        ...overlayIn('up'),
      }}
    >
      {/* 画笔模式:黑色画笔设置面板 + 撤销/重做/清空(悬浮在工具条上方) */}
      {isPen && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <PenPanel config={penConfig} onChange={onPenConfigChange} />
          <div style={{ display: 'flex', gap: 10 }}>
            <ToolBtn onClick={onUndo} label="撤销" icon={<Undo2 size={22} />} />
            <ToolBtn onClick={onRedo} label="重做" icon={<Redo2 size={22} />} />
            <ToolBtn onClick={onClear} label="清空" icon={<Trash2 size={22} />} danger />
          </div>
        </div>
      )}

      {/* 工具条本体(整块任意位置可拖,没有拖拽手柄) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 18,
          background: '#1b1b1f',
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        }}
      >
        {TOOLBAR.map((t) => (
          <button
            key={t.key}
            onClick={() => onToolChange(t.key)}
            title={t.label}
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              background: activeTool === t.key ? 'rgba(255,255,255,0.18)' : 'transparent',
              color: activeTool === t.key ? '#fff' : '#9ca3af',
              transition: 'background .15s ease',
              outline: 'none',
              padding: 0,
            }}
          >
            {t.icon}
            <span style={{ fontSize: 11, lineHeight: 1 }}>{t.label}</span>
          </button>
        ))}

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
            <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// 工具栏操作按钮(黑色,撤销/重做/清空)
function ToolBtn({
  onClick,
  label,
  icon,
  danger,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
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
        background: '#26262b',
        color: danger ? '#f87171' : '#d1d5db',
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
