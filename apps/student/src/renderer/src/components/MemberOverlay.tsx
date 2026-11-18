import { useState } from 'react';
import type { SessionMember, InteractionControl } from '@c30/shared';
import { Users, X, MessageSquare, ListChecks } from 'lucide-react';

interface Props {
  members: SessionMember[];
  open: boolean;
  onToggle: () => void;
  isTeacher: boolean;
  interaction: InteractionControl;
  onInteractionChange?: (patch: Partial<InteractionControl>) => void;
}

// 右上角成员名单浮层(黑色,参考腾讯会议/钉钉的参会人面板)
export default function MemberOverlay({
  members,
  open,
  onToggle,
  isTeacher,
  interaction,
  onInteractionChange,
}: Props) {
  return (
    <>
      {/* 右上角触发按钮(黑色) */}
      <button
        data-interactive
        onClick={onToggle}
        title="成员名单"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 40,
          height: 40,
          borderRadius: 10,
          border: 'none',
          background: 'rgba(17,24,39,0.82)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <Users size={20} />
        <span
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            padding: '0 4px',
            borderRadius: 9,
            background: '#e5484d',
            color: '#fff',
            fontSize: 11,
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
            top: 60,
            right: 12,
            width: 264,
            background: 'rgba(17,24,39,0.95)',
            backdropFilter: 'blur(10px)',
            borderRadius: 14,
            padding: 16,
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
              课堂成员({members.length})
            </div>
            <button
              onClick={onToggle}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* 教师互动控制开关 */}
          {isTeacher && onInteractionChange && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              <SwitchRow
                icon={<MessageSquare size={16} />}
                label="学生弹幕"
                checked={interaction.danmakuEnabled}
                onChange={(v) => onInteractionChange({ danmakuEnabled: v })}
              />
              <SwitchRow
                icon={<ListChecks size={16} />}
                label="参与答题"
                checked={interaction.quizEnabled}
                onChange={(v) => onInteractionChange({ quizEnabled: v })}
              />
              <div
                style={{
                  height: 1,
                  background: 'rgba(255,255,255,0.12)',
                  margin: '4px 0 2px',
                }}
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflow: 'auto' }}>
            {members.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '8px 0', textAlign: 'center' }}>
                暂无成员
              </div>
            ) : (
              members.map((m) => (
                <div
                  key={m.userId}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: m.role === 'TEACHER' ? '#3b82f6' : '#22c55e',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {m.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: '#fff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.name}
                      {m.role === 'TEACHER' && (
                        <span style={{ fontSize: 11, color: '#60a5fa', marginLeft: 6 }}>老师</span>
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
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'rgba(255,255,255,0.75)', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>{label}</span>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 38,
          height: 22,
          borderRadius: 11,
          border: 'none',
          background: checked ? '#2563eb' : 'rgba(255,255,255,0.2)',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.2s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
          }}
        />
      </button>
    </div>
  );
}
