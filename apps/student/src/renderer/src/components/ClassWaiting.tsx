import { GraduationCap, Users, LogOut } from 'lucide-react';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import { overlayIn } from '../lib/overlayAnim';

// 上课前 / 下课后的等待页。
// 学生已经进入「房间」,但老师还没点「上课」:此时不跟随画面,
// 只显示一张小卡片说明「等待老师开始上课」,学生仍可使用自己的电脑。
export default function ClassWaiting({
  teacherName,
  roomCode,
  studentCount,
  ended,
  pending,
  offline,
  onLeave,
}: {
  teacherName: string;
  roomCode: string;
  /** 在线学生数(不含老师),与教师端「班级 N 人」同一口径 */
  studentCount: number;
  /** 本节课已结束(老师点了「下课」) */
  ended: boolean;
  /** 刚加入、课堂状态还没同步回来 */
  pending: boolean;
  /** 与老师的连接已断开(老师退出 / 网络中断),正在自动重连 */
  offline?: boolean;
  onLeave: () => void;
}) {
  const s = useOverlayScale();
  const spx = (n: number) => scaled(n, s);

  const title = offline ? '课堂连接已断开' : pending ? '正在接入课堂…' : ended ? '本节课已结束' : '已进入课堂';
  const subtitle = offline
    ? '正在尝试重新连接老师…'
    : pending
      ? '正在同步课堂状态'
      : ended
        ? '等待老师再次开始上课'
        : '等待老师开始上课';

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60 }}>
      <div
        data-interactive
        data-overlay-anim
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: spx(380),
          maxWidth: 'calc(100vw - 32px)',
          background: '#ffffff',
          borderRadius: spx(18),
          boxShadow: '0 20px 56px rgba(15,23,42,0.28)',
          padding: `${spx(26)}px ${spx(28)}px ${spx(22)}px`,
          color: '#1f2937',
          pointerEvents: 'auto',
          ...overlayIn('fade'),
        }}
      >
        {/* 状态图标:上课中/等待都复用头像式圆标,视觉与应用其它卡片一致 */}
        <div
          style={{
            width: spx(56),
            height: spx(56),
            borderRadius: '50%',
            margin: `0 auto ${spx(14)}px`,
            background: ended ? '#e5e7eb' : 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
            color: ended ? '#6b7280' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: ended ? 'none' : '0 8px 20px rgba(37,99,235,0.35)',
          }}
        >
          <GraduationCap size={spx(28)} />
        </div>

        <div style={{ fontSize: spx(20), fontWeight: 700, textAlign: 'center' }}>{title}</div>
        <div style={{ fontSize: spx(13), color: '#9aa1ac', textAlign: 'center', marginTop: spx(6) }}>{subtitle}</div>

        <div
          style={{
            marginTop: spx(20),
            padding: `${spx(14)}px ${spx(16)}px`,
            background: '#f8fafc',
            border: '1px solid #eef2f7',
            borderRadius: spx(12),
            display: 'flex',
            flexDirection: 'column',
            gap: spx(8),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spx(12) }}>
            <span style={{ fontSize: spx(14), fontWeight: 600, color: '#1f2937' }}>
              {teacherName ? `${teacherName}的课堂` : '课堂'}
            </span>
            <span
              style={{
                fontSize: spx(12),
                color: '#2563eb',
                background: '#eaf1ff',
                borderRadius: spx(999),
                padding: `${spx(3)}px ${spx(9)}px`,
                whiteSpace: 'nowrap',
              }}
            >
              房间号 {roomCode}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spx(6), fontSize: spx(12), color: '#6b7280' }}>
            <Users size={spx(14)} />
            {studentCount} 名学生在课堂
          </div>
        </div>

        <div
          style={{
            marginTop: spx(16),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spx(8),
            fontSize: spx(12),
            color: '#9aa1ac',
          }}
        >
          {!ended && (
            <span
              style={{
                width: spx(7),
                height: spx(7),
                borderRadius: '50%',
                background: offline || pending ? '#f59e0b' : '#22c55e',
                animation: 'c30-wait-pulse 1.4s ease-in-out infinite',
              }}
            />
          )}
          {ended ? '老师重新「上课」后,画面会自动接入' : '老师点「上课」后,画面会自动接入'}
        </div>

        <button
          onClick={onLeave}
          style={{
            marginTop: spx(18),
            width: '100%',
            padding: `${spx(10)}px 0`,
            border: 'none',
            borderRadius: spx(10),
            background: '#eef2ff',
            color: '#2563eb',
            fontSize: spx(14),
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spx(6),
            outline: 'none',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#e0e7ff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#eef2ff';
          }}
        >
          <LogOut size={spx(15)} />
          退出课堂
        </button>

        <style>{`
          @keyframes c30-wait-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.35; transform: scale(0.72); }
          }
        `}</style>
      </div>
    </div>
  );
}
