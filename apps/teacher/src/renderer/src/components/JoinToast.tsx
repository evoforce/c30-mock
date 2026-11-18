import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

interface Toast {
  id: string;
  name: string;
}

// 右下角"XXX 加入教室"通知浮层(参考腾讯会议入会提示,自动淡出)
export default function JoinToast({ toasts }: { toasts: Toast[] }) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);
  return (
    <div
      style={{
        position: 'absolute',
        right: px(16),
        bottom: px(16),
        display: 'flex',
        flexDirection: 'column',
        gap: px(8),
        zIndex: 30,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'rgba(17,24,39,0.88)',
            color: '#fff',
            fontSize: px(14),
            padding: `${px(10)}px ${px(16)}px`,
            borderRadius: px(10),
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: px(8),
            animation: 'c30-slide-in 0.3s ease',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span
            style={{
              width: px(8),
              height: px(8),
              borderRadius: '50%',
              background: '#22c55e',
              flexShrink: 0,
            }}
          />
          <span>
            <b>{t.name}</b> 加入了教室
          </span>
        </div>
      ))}
      <style>{`
        @keyframes c30-slide-in {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
