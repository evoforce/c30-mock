import { useEffect, useState } from 'react';

// 无标题栏方案:内容铺满窗口,窗口控制按钮悬浮右上角,顶部留隐形拖拽条
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
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 28,
          WebkitAppRegion: 'drag',
          zIndex: 999,
        }}
      />

      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: 28,
          display: 'flex',
          alignItems: 'stretch',
          WebkitAppRegion: 'no-drag',
          zIndex: 1000,
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(8px)',
          borderRadius: '0 0 0 10px',
          overflow: 'hidden',
        }}
      >
        <ControlBtn label="最小化" onClick={() => win?.minimize()}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </ControlBtn>
        <ControlBtn
          label={maximized ? '还原' : '最大化'}
          onClick={() => win?.toggleMaximize()}
        >
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="3" width="7" height="7" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 3V2h6v6H9" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </ControlBtn>
        <ControlBtn label="关闭" danger onClick={() => win?.close()}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </ControlBtn>
      </div>
    </>
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
        width: 40,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        color: '#374151',
        cursor: 'pointer',
        outline: 'none',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? '#e81123'
          : 'rgba(0,0,0,0.06)';
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
