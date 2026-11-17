import { useState } from 'react';
import type { User } from '@c30/shared';

interface DockItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: DockItem[] = [
  { key: 'session', label: '课堂', icon: <IconSession /> },
  { key: 'courseware', label: '课件', icon: <IconCourseware /> },
  { key: 'whiteboard', label: '白板', icon: <IconWhiteboard /> },
];

export default function DockNav({
  active,
  onChange,
  user,
  onLogout,
}: {
  active: string;
  onChange: (key: string) => void;
  user: User;
  onLogout: () => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div
      style={{
        width: 72,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 16,
        gap: 8,
        borderRight: '1px solid #eef0f3',
        background: '#ffffff',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
          color: '#fff',
          fontWeight: 700,
          fontSize: 16,
        }}
      >
        C
      </div>

      {NAV_ITEMS.map((item) => {
        const isActive = active === item.key;
        return (
          <div
            key={item.key}
            style={{ position: 'relative' }}
            onMouseEnter={() => setHover(item.key)}
            onMouseLeave={() => setHover(null)}
          >
            <button
              onClick={() => onChange(item.key)}
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isActive ? '#eaf1ff' : 'transparent',
                color: isActive ? '#2563eb' : '#7c8494',
                transition: 'all .18s ease',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = '#f4f6fa';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }
              }}
            >
              {item.icon}
            </button>

            {hover === item.key && (
              <div
                style={{
                  position: 'absolute',
                  left: 58,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#1f2937',
                  color: '#fff',
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                {item.label}
              </div>
            )}
          </div>
        );
      })}

      {/* 底部用户信息 */}
      <div style={{ marginTop: 'auto', paddingBottom: 16, position: 'relative' }}>
        <div
          title={user.name}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 17,
            fontWeight: 600,
            cursor: 'pointer',
          }}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {user.name.charAt(0)}
        </div>

        {/* 弹出菜单 */}
        {menuOpen && (
          <>
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 20,
              }}
              onClick={() => setMenuOpen(false)}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 60,
                left: 8,
                width: 160,
                background: '#ffffff',
                borderRadius: 10,
                boxShadow: '0 8px 30px rgba(0,0,0,0.14)',
                border: '1px solid #eef0f3',
                padding: 6,
                zIndex: 21,
              }}
            >
              <div
                style={{
                  padding: '8px 10px 10px',
                  borderBottom: '1px solid #f0f2f5',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                  {user.name}
                </div>
                <div style={{ fontSize: 11, color: '#9aa1ac', marginTop: 2 }}>
                  {user.role === 'TEACHER' ? '教师账号' : '学生账号'}
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
                  color: '#e5484d',
                  fontSize: 13,
                  textAlign: 'left',
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#fef2f2';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                退出登录
              </button>
            </div>
          </>
        )}
      </div>

      {/* 退出确认对话框 */}
      {confirmOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.32)',
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
              boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>
              确认退出登录?
            </div>
            <p style={{ fontSize: 13, color: '#7c8494', margin: '10px 0 22px', lineHeight: 1.6 }}>
              退出后需要重新登录才能继续使用。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #e2e5ea',
                  borderRadius: 8,
                  background: '#fff',
                  color: '#4b5563',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={onLogout}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: 8,
                  background: '#e5484d',
                  color: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
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

function IconCourseware() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4a2 2 0 012-2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" strokeLinejoin="round" />
      <path d="M15 2v5h5" strokeLinejoin="round" />
      <path d="M8 13h8M8 17h5" strokeLinecap="round" />
    </svg>
  );
}

function IconWhiteboard() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" strokeLinecap="round" />
      <path d="M7 10c1.5-1 4-1 5 0s3.5 1 5 0" strokeLinecap="round" />
    </svg>
  );
}

function IconSession() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" strokeLinecap="round" />
    </svg>
  );
}
