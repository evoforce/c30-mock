import type { SessionMember, InteractionControl } from '@c30/shared';
import { Users, X, MessageSquare, ListChecks } from 'lucide-react';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

interface Props {
  members: SessionMember[];
  open: boolean;
  onToggle: () => void;
  isTeacher: boolean;
  interaction: InteractionControl;
  onInteractionChange?: (patch: Partial<InteractionControl>) => void;
  // 右上角按钮的右偏移(px):白板模式下右侧有悬浮竖条,需右移避开遮挡
  rightOffset?: number;
}

// 右上角成员名单浮层(黑色,参考腾讯会议/钉钉的参会人面板)
// 尺寸随 useOverlayScale 动态缩放,大屏上班主任也能一眼看清并点中。
export default function MemberOverlay({
  members,
  open,
  onToggle,
  isTeacher,
  interaction,
  onInteractionChange,
  rightOffset = 12,
}: Props) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  return (
    <>
      {/* 右上角触发按钮(黑色) */}
      <button
        data-interactive
        onClick={onToggle}
        title="成员名单"
        style={{
          position: 'absolute',
          top: px(12),
          right: rightOffset,
          width: px(46),
          height: px(46),
          borderRadius: px(12),
          border: 'none',
          background: open ? '#2563eb' : 'rgba(17,24,39,0.82)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: open
            ? '0 0 0 2px rgba(96,165,250,0.35), 0 6px 16px rgba(37,99,235,0.45)'
            : '0 4px 14px rgba(0,0,0,0.18)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <Users size={px(21)} />
        <span
          style={{
            position: 'absolute',
            top: -px(7),
            right: -px(7),
            minWidth: px(20),
            height: px(20),
            padding: `0 ${px(5)}px`,
            borderRadius: px(10),
            background: '#e5484d',
            color: '#fff',
            fontSize: px(12),
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {members.length}
        </span>
      </button>

      {/* 浮层面板 */}
      {open && (
        <div
          data-interactive
          style={{
            position: 'absolute',
            top: px(66),
            right: rightOffset,
            width: px(320),
            maxWidth: 'calc(100vw - 24px)',
            background: 'rgba(17,24,39,0.95)',
            backdropFilter: 'blur(10px)',
            borderRadius: px(14),
            padding: px(18),
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: px(14),
            }}
          >
            <div style={{ fontSize: px(16), fontWeight: 600, color: '#fff' }}>
              课堂成员({members.length})
            </div>
            <button
              onClick={onToggle}
              title="关闭"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                padding: px(4),
                display: 'flex',
              }}
            >
              <X size={px(20)} />
            </button>
          </div>

          {/* 教师互动控制开关 */}
          {isTeacher && onInteractionChange && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: px(10), marginBottom: px(14) }}>
              <SwitchRow
                icon={<MessageSquare size={px(17)} />}
                label="学生弹幕"
                checked={interaction.danmakuEnabled}
                onChange={(v) => onInteractionChange({ danmakuEnabled: v })}
                scale={s}
              />
              <SwitchRow
                icon={<ListChecks size={px(17)} />}
                label="参与答题"
                checked={interaction.quizEnabled}
                onChange={(v) => onInteractionChange({ quizEnabled: v })}
                scale={s}
              />
              <div
                style={{
                  height: 1,
                  background: 'rgba(255,255,255,0.12)',
                  margin: `${px(4)}px 0 ${px(2)}px`,
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: px(6), maxHeight: px(380), overflow: 'auto' }}>
            {members.length === 0 ? (
              <div style={{ fontSize: px(13), color: 'rgba(255,255,255,0.4)', padding: `${px(8)}px 0`, textAlign: 'center' }}>
                暂无成员
              </div>
            ) : (
              members.map((m) => (
                <div
                  key={m.userId}
                  style={{ display: 'flex', alignItems: 'center', gap: px(10), padding: `${px(7)}px ${px(4)}px` }}
                >
                  <div
                    style={{
                      width: px(36),
                      height: px(36),
                      borderRadius: '50%',
                      background: m.role === 'TEACHER' ? '#3b82f6' : '#22c55e',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: px(15),
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {m.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: px(15),
                        color: '#fff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.name}
                      {m.role === 'TEACHER' && (
                        <span style={{ fontSize: px(12), color: '#60a5fa', marginLeft: px(6) }}>老师</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SwitchRow({
  icon,
  label,
  checked,
  onChange,
  scale,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  scale: number;
}) {
  const px = (n: number) => scaled(n, scale);
  const trackW = px(48);
  const trackH = px(28);
  const knob = px(22);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: px(9) }}>
      <span style={{ color: checked ? '#93c5fd' : 'rgba(255,255,255,0.65)', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, fontSize: px(15), color: 'rgba(255,255,255,0.9)' }}>{label}</span>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        title={`${label}:${checked ? '已开启' : '已关闭'}`}
        style={{
          width: trackW,
          height: trackH,
          borderRadius: trackH / 2,
          border: 'none',
          background: checked ? '#2563eb' : 'rgba(255,255,255,0.2)',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.2s',
          padding: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: (trackH - knob) / 2,
            left: checked ? trackW - knob - px(3) : px(3),
            width: knob,
            height: knob,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
          }}
        />
      </button>
    </div>
  );
}
