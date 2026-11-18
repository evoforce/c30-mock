import { useState } from 'react';
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
  Trash2,
  Check,
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

const TEACHER_NAV: NavItem[] = [
  { key: 'whiteboard', label: '白板', icon: <Presentation size={22} /> },
  { key: 'class', label: '上课', icon: <GraduationCap size={22} /> },
  { key: 'textbook', label: '课本', icon: <BookOpen size={22} /> },
  { key: 'courseware', label: '课件', icon: <FileText size={22} /> },
  { key: 'comment', label: '讲评', icon: <MonitorPlay size={22} /> },
];

const STUDENT_NAV: NavItem[] = [
  { key: 'class', label: '上课', icon: <GraduationCap size={22} /> },
  { key: 'courseware', label: '课件', icon: <FileText size={22} /> },
  { key: 'whiteboard', label: '白板', icon: <Presentation size={22} /> },
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

  const navItems = role === 'TEACHER' ? TEACHER_NAV : STUDENT_NAV;

  const onDrag = useDrag('y', (p) => setY(p.y));

  const verticalStyle: React.CSSProperties = {
    top: y ?? '50%',
    transform: y != null ? 'none' : 'translateY(-50%)',
  };

  // 折叠态:仅在当前贴边侧显示一个箭头(点击展开),另一侧不显示
  if (collapsed) {
    return (
      <div
        data-interactive
        style={{
          position: 'fixed',
          [side]: 0,
          zIndex: 80,
          pointerEvents: 'auto',
          ...verticalStyle,
        }}
      >
        <CollapseArrow
          direction={side}
          onClick={() => setCollapsed(false)}
          label="展开工具栏"
        />
      </div>
    );
  }

  return (
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

      {/* 折叠按钮(贴边侧的对侧,垂直居中,半圆形) */}
      <button
        onClick={() => setCollapsed(true)}
        title="收起"
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
              onClick={() => onChange(item.key)}
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

      {/* 底部:窗口/菜单 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <button
          title="窗口"
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
          <LayoutGrid size={22} />
          <span style={{ fontSize: 11 }}>窗口</span>
        </button>
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

      {/* 弹出菜单(头像/菜单点击) */}
      {menuOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenuOpen(false)} />
          <div
            style={{
              position: 'absolute',
              [side === 'right' ? 'left' : 'right']: 68,
              bottom: 20,
              width: 200,
              background: '#26262b',
              borderRadius: 10,
              border: '1px solid #3a3a40',
              padding: 6,
              zIndex: 21,
            }}
          >
            <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid #3a3a40' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{user.name}</div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
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
                padding: '10px',
                marginTop: 4,
                border: 'none',
                background: 'transparent',
                color: '#f87171',
                fontSize: 14,
                textAlign: 'left',
                borderRadius: 6,
                cursor: 'pointer',
                display: role === 'STUDENT' ? 'none' : 'flex',
                alignItems: 'center',
                gap: 8,
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
              width: 320,
              background: '#ffffff',
              borderRadius: 14,
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>确认退出登录?</div>
            <p style={{ fontSize: 13, color: '#7c8494', margin: '10px 0 22px' }}>退出后需要重新登录才能继续使用。</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{ padding: '8px 16px', border: '1px solid #e2e5ea', borderRadius: 8, background: '#fff', color: '#4b5563', fontSize: 13, cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={onLogout}
                style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: '#e5484d', color: '#fff', fontSize: 13, cursor: 'pointer' }}
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
  onClear,
  onComplete,
}: {
  activeTool: string;
  onToolChange: (key: string) => void;
  penConfig: PenConfig;
  onPenConfigChange: (c: PenConfig) => void;
  onUndo: () => void;
  onClear: () => void;
  onComplete: () => void;
}) {
  const [x, setX] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const onDrag = useDrag('x', (p) => setX(p.x));

  const isPen = activeTool === 'pen';

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
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
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
            <ToolBtn onClick={onClear} label="清空" icon={<Trash2 size={22} />} danger />
            <ToolBtn onClick={onComplete} label="完成" icon={<Check size={22} />} primary />
          </div>
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
