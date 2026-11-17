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
} from 'lucide-react';

// C30 风格的桌面悬浮黑色组件:左侧竖排导航 + 右上角状态 + 底部工具条
// 教师端/学生端共用,通过 role 区分导航项。

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

// 教师端导航项(对齐 C30:头像/名称/上课/白板/课本/课件/讲评/窗口/菜单)
const TEACHER_NAV: NavItem[] = [
  { key: 'class', label: '上课', icon: <GraduationCap size={18} /> },
  { key: 'whiteboard', label: '白板', icon: <Presentation size={18} /> },
  { key: 'textbook', label: '课本', icon: <BookOpen size={18} /> },
  { key: 'courseware', label: '课件', icon: <FileText size={18} /> },
  { key: 'comment', label: '讲评', icon: <MonitorPlay size={18} /> },
];

// 学生端导航项(学生侧重:课堂/课件/白板)
const STUDENT_NAV: NavItem[] = [
  { key: 'class', label: '上课', icon: <GraduationCap size={18} /> },
  { key: 'courseware', label: '课件', icon: <FileText size={18} /> },
  { key: 'whiteboard', label: '白板', icon: <Presentation size={18} /> },
];

// 底部工具条(选择/画笔/板擦/互动/聚焦/更多)
const TOOLBAR = [
  { key: 'select', label: '选择', icon: <MousePointer2 size={16} /> },
  { key: 'pen', label: '画笔', icon: <Pen size={16} /> },
  { key: 'eraser', label: '板擦', icon: <Eraser size={16} /> },
  { key: 'interact', label: '互动', icon: <MessageSquareText size={16} /> },
  { key: 'focus', label: '聚焦', icon: <Focus size={16} /> },
  { key: 'more', label: '更多', icon: <MoreHorizontal size={16} /> },
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

  const navItems = role === 'TEACHER' ? TEACHER_NAV : STUDENT_NAV;

  return (
    <div
      style={{
        width: 64,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'rgba(27, 27, 31, 0.92)',
        borderRadius: 16,
        paddingTop: 14,
        paddingBottom: 14,
        position: 'relative',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }}
    >
      {/* 左上角:头像 + 名称(点击弹菜单) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: role === 'TEACHER' ? '#2563eb' : '#16a34a',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          {user.name.charAt(0)}
        </button>
        <span style={{ fontSize: 10, color: '#d1d5db', maxWidth: 56, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.name}
        </span>
      </div>

      {/* 导航项 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 16 }}>
        {navItems.map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              title={item.label}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
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
              <span style={{ fontSize: 9, lineHeight: 1 }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* 底部:窗口/菜单 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
        <button
          title="窗口"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            border: 'none',
            cursor: 'pointer',
            background: 'transparent',
            color: '#9ca3af',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            outline: 'none',
            padding: 0,
          }}
        >
          <LayoutGrid size={18} />
          <span style={{ fontSize: 9 }}>窗口</span>
        </button>
        <button
          title="菜单"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            border: 'none',
            cursor: 'pointer',
            background: 'transparent',
            color: '#9ca3af',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            outline: 'none',
            padding: 0,
          }}
        >
          <Menu size={18} />
          <span style={{ fontSize: 9 }}>菜单</span>
        </button>
      </div>

      {/* 弹出菜单(头像/菜单点击) */}
      {menuOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setMenuOpen(false)} />
          <div
            style={{
              position: 'absolute',
              left: 72,
              bottom: 20,
              width: 180,
              background: '#26262b',
              borderRadius: 10,
              border: '1px solid #3a3a40',
              padding: 6,
              zIndex: 21,
            }}
          >
            <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid #3a3a40' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
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
                padding: '9px 10px',
                marginTop: 4,
                border: 'none',
                background: 'transparent',
                color: '#f87171',
                fontSize: 13,
                textAlign: 'left',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
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

// 顶部状态条(右上角:网络/班级/人数) + 底部工具条,由 Workspace 层渲染
export function TopStatusBar({
  networkStatus,
  memberCount,
}: {
  networkStatus: 'direct' | 'relay' | '';
  memberCount: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', height: 44 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#6b7280', fontSize: 12 }}>
        <Wifi size={14} />
        <span>{networkStatus === 'direct' ? '局域网' : networkStatus === 'relay' ? '中继' : '离线'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#6b7280', fontSize: 12 }}>
        <UsersRound size={14} />
        <span>班级</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#6b7280', fontSize: 12 }}>
        <Users size={14} />
        <span>{memberCount} 人</span>
      </div>
    </div>
  );
}

// 底部悬浮工具条(选择/画笔/板擦/互动/聚焦/更多)
export function BottomToolbar({
  activeTool,
  onToolChange,
}: {
  activeTool: string;
  onToolChange: (key: string) => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        borderRadius: 16,
        background: '#1b1b1f',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        zIndex: 15,
      }}
    >
      {TOOLBAR.map((t) => (
        <button
          key={t.key}
          onClick={() => onToolChange(t.key)}
          title={t.label}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            background: activeTool === t.key ? 'rgba(255,255,255,0.18)' : 'transparent',
            color: activeTool === t.key ? '#fff' : '#9ca3af',
            transition: 'background .15s ease',
            outline: 'none',
            padding: 0,
          }}
        >
          {t.icon}
          <span style={{ fontSize: 9, lineHeight: 1 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
