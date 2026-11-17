import { useEffect, useState } from 'react';

// 极简自绘窗口控制区:仅右上角最小化/最大化/关闭,其余区域可拖拽、留给功能区
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const w = (window as any).api?.window;
    if (!w) return;
    w.isMaximized().then(setMaximized);
    const off = w.onMaximizedChange(setMaximized);
    return off;
  }, []);

  const win = (window as any).api?.window;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        background: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
        WebkitAppRegion: 'drag',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          WebkitAppRegion: 'no-drag',
        }}
      >
        <ControlBtn label="最小化" onClick={() => win?.minimize()}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </ControlBtn>
        <ControlBtn
          label={maximized ? '还原' : '最大化'}
          onClick={() => win?.toggleMaximize()}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="3" width="7" height="7" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4 3V2h6v6H9" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </ControlBtn>
        <ControlBtn label="关闭" danger onClick={() => win?.close()}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </ControlBtn>
      </div>
    </div>
  );
}

function ControlBtn({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        width: 46,
        height: 36,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        color: '#374151',
        cursor: 'pointer',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? '#e81123'
          : '#f3f4f6';
        if (danger) (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = '#374151';
      }}
    >
      {children}
    </button>
  );
}
