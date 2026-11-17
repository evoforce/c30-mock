import { useState } from 'react';

interface DockItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: DockItem[] = [
  { key: 'courseware', label: '课件', icon: <IconCourseware /> },
  { key: 'whiteboard', label: '白板', icon: <IconWhiteboard /> },
  { key: 'session', label: '课堂', icon: <IconSession /> },
];

// 类 Dock 风格左侧导航:竖向圆润图标 + 悬浮标签,不带传统后台侧边栏的生硬感
export default function DockNav({
  active,
  onChange,
}: {
  active: string;
  onChange: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);

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
      {/* 顶部品牌小标记 */}
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

            {/* 悬浮标签 */}
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
