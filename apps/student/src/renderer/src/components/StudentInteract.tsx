import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { InteractKind } from '@c30/shared';
import { tallyPoll } from '@c30/shared';
import { Check, CheckCheck, Cloud, Hand, Timer, Trophy, Zap } from 'lucide-react';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import { overlayIn } from '../lib/overlayAnim';
import useInteract from '../hooks/useInteract';

// 学生端课堂互动(与教师端「互动」面板一一对应):
//   · 举手按钮常驻右下角,老师面板实时可见,可随时举起/放下;
//   · 随机点名:点到你 → 居中卡片请你确认;点到别人 → 顶部提示;
//   · 抢答:倒计时 + 大按钮,点完立刻知道自己是第几个;
//   · 投票 / 观点云:直接在自己的屏幕上作答,提交后能看到实时结果(可改票/改观点);
//   · 计时:屏幕顶部与老师端同步倒计时。
// 所有状态都来自服务端 interact.state 快照,不是本地演示数据。
const KIND_META: Record<InteractKind, { label: string; color: string }> = {
  rollcall: { label: '随机点名', color: '#60a5fa' },
  buzz: { label: '抢答', color: '#fbbf24' },
  poll: { label: '投票', color: '#818cf8' },
  cloud: { label: '观点云', color: '#67e8f9' },
  timer: { label: '计时', color: '#34d399' },
};

function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** 有倒计时时每 500ms 重渲染一次(没有倒计时就不开定时器) */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export default function StudentInteract({
  socket,
  roomCode,
  userId,
  enabled,
}: {
  socket: Socket | null;
  roomCode: string;
  userId: string;
  /** 老师「允许互动」总开关;关闭时学生端不出现任何互动入口 */
  enabled: boolean;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const { state, myResponse, myHandRaised, respond, setHand } = useInteract(socket, roomCode, userId);
  const session = state?.session ?? null;
  const active = !!session && session.endedAt == null;
  const now = useNow(!!session?.endsAt && active);
  const remainSec =
    session?.endsAt != null ? Math.max(0, Math.ceil((session.endsAt - now) / 1000)) : null;

  // 观点云草稿:提交后可修改,老师端会实时合并更新
  const [cloudDraft, setCloudDraft] = useState('');
  useEffect(() => {
    setCloudDraft(myResponse?.text && myResponse.text !== 'ack' ? myResponse.text : '');
  }, [myResponse?.text]);

  if (!enabled) return null;

  const picked = state?.picked ?? null;
  const pickedMe = picked != null && picked.userId === userId;
  const acked = myResponse?.text === 'ack';
  const buzzRank = state?.buzzOrder.indexOf(userId) ?? -1;
  const buzzFirstId = state?.buzzOrder[0] ?? null;
  const buzzFirstName =
    buzzFirstId != null
      ? (state?.responses.find((r) => r.userId === buzzFirstId)?.name ?? '有同学')
      : null;

  const cardStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: px(440),
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: '78vh',
    overflowY: 'auto',
    background: '#1b1b1f',
    borderRadius: px(16),
    border: '1px solid #3a3a40',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    padding: `${px(18)}px ${px(20)}px ${px(16)}px`,
    color: '#e5e7eb',
    zIndex: 40,
    pointerEvents: 'auto',
  };

  const primaryBtn = (disabled = false): React.CSSProperties => ({
    width: '100%',
    padding: `${px(11)}px 0`,
    borderRadius: px(10),
    border: 'none',
    background: disabled ? '#374151' : 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
    color: disabled ? '#9ca3af' : '#ffffff',
    fontSize: px(15),
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: px(7),
    outline: 'none',
  });

  const statusRow = (color: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: px(7), marginBottom: px(10) }}>
      <span
        style={{
          fontSize: px(12),
          padding: `${px(3)}px ${px(9)}px`,
          borderRadius: px(999),
          background: `${color}22`,
          color,
          fontWeight: 600,
        }}
      >
        {KIND_META[session!.kind].label}
      </span>
      <span
        style={{
          width: px(6),
          height: px(6),
          borderRadius: '50%',
          background: active ? '#34d399' : '#6b7280',
        }}
      />
      <span style={{ fontSize: px(12), color: '#9ca3af' }}>{active ? '进行中' : '已结束'}</span>
      {remainSec != null && active && (
        <span
          style={{
            marginLeft: 'auto',
            fontSize: px(13),
            color: '#fbbf24',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          剩余 {formatClock(remainSec)}
        </span>
      )}
    </div>
  );

  // ---- 各互动的作答卡片 ----
  const renderRollcall = () => {
    if (!pickedMe) return null;
    return (
      <div key="rollcall" data-interactive data-overlay-anim style={{ ...cardStyle, ...overlayIn('up', 180) }}>
        {statusRow('#60a5fa')}
        <div style={{ textAlign: 'center', padding: `${px(6)}px 0 ${px(4)}px` }}>
          <div
            style={{
              width: px(64),
              height: px(64),
              margin: '0 auto',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: px(28),
              fontWeight: 700,
              boxShadow: '0 8px 22px rgba(37,99,235,0.45)',
            }}
          >
            {picked?.name.charAt(0) ?? '?'}
          </div>
          <div style={{ fontSize: px(20), fontWeight: 700, marginTop: px(10) }}>老师点到你啦</div>
          <div style={{ fontSize: px(13), color: '#9ca3af', marginTop: px(6), lineHeight: 1.6 }}>
            {acked ? '已确认,请起立回答' : '请起立回答,点下方按钮告诉老师你收到了'}
          </div>
        </div>
        <div style={{ marginTop: px(14) }}>
          {acked ? (
            <div
              style={{
                ...primaryBtn(true),
                background: 'rgba(52,211,153,0.14)',
                color: '#6ee7b7',
              }}
            >
              <CheckCheck size={px(17)} /> 已确认
            </div>
          ) : (
            <button onClick={() => respond({ text: 'ack' })} style={primaryBtn()}>
              <Check size={px(17)} /> 我知道了
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderBuzz = () => {
    if (session!.kind !== 'buzz') return null;
    const canBuzz = active && buzzRank < 0;
    return (
      <div key="buzz" data-interactive data-overlay-anim style={{ ...cardStyle, ...overlayIn('up', 180) }}>
        {statusRow('#fbbf24')}
        <div style={{ fontSize: px(18), fontWeight: 700, marginBottom: px(4) }}>老师发起了抢答</div>
        <div style={{ fontSize: px(13), color: '#9ca3af', lineHeight: 1.6, marginBottom: px(14) }}>
          {buzzRank >= 0
            ? `你是第 ${buzzRank + 1} 个抢到的同学,等待老师点名回答。`
            : buzzFirstName
              ? `${buzzFirstName} 已经抢到第 1 名,你还可以继续排队,老师会按顺序点名。`
              : '手快有手慢无,点击下方按钮抢答!'}
        </div>

        {buzzRank >= 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: px(6),
              padding: `${px(14)}px 0`,
              borderRadius: px(12),
              background: buzzRank === 0 ? 'rgba(251,191,36,0.16)' : 'rgba(255,255,255,0.05)',
              border: buzzRank === 0 ? '1px solid rgba(251,191,36,0.4)' : '1px solid transparent',
            }}
          >
            <Trophy size={px(30)} style={{ color: buzzRank === 0 ? '#fbbf24' : '#9ca3af' }} />
            <span style={{ fontSize: px(22), fontWeight: 700, color: buzzRank === 0 ? '#fde68a' : '#e5e7eb' }}>
              第 {buzzRank + 1} 名
            </span>
            <span style={{ fontSize: px(12), color: '#9ca3af' }}>
              {active ? '已记录你的抢答顺序' : '抢答已结束'}
            </span>
          </div>
        ) : (
          <button
            onClick={() => respond({})}
            disabled={!canBuzz}
            style={{
              ...primaryBtn(!canBuzz),
              padding: `${px(18)}px 0`,
              fontSize: px(20),
              background: canBuzz ? 'linear-gradient(180deg, #f59e0b 0%, #d97706 100%)' : '#374151',
            }}
          >
            <Zap size={px(22)} /> {active ? '抢答' : '抢答已结束'}
          </button>
        )}
      </div>
    );
  };

  const renderPoll = () => {
    if (session!.kind !== 'poll') return null;
    const selectedId = myResponse?.optionIds[0] ?? null;
    const tally = tallyPoll(session, state?.responses ?? []);
    const voted = tally.reduce((n, t) => n + t.count, 0);
    return (
      <div key="poll" data-interactive data-overlay-anim style={{ ...cardStyle, ...overlayIn('up', 180) }}>
        {statusRow('#818cf8')}
        <div style={{ fontSize: px(16), fontWeight: 700, lineHeight: 1.5, marginBottom: px(12) }}>
          {session!.question}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(8) }}>
          {session!.options.map((opt, i) => {
            const selected = selectedId === opt.id;
            const count = tally.find((t) => t.option.id === opt.id)?.count ?? 0;
            return (
              <button
                key={opt.id}
                onClick={() => respond({ optionIds: [opt.id] })}
                disabled={!active}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: px(10),
                  width: '100%',
                  padding: `${px(10)}px ${px(12)}px`,
                  borderRadius: px(11),
                  border: selected ? '1px solid #60a5fa' : '1px solid #3a3a40',
                  background: selected ? 'rgba(37,99,235,0.22)' : 'rgba(255,255,255,0.05)',
                  color: '#f3f4f6',
                  cursor: active ? 'pointer' : 'default',
                  textAlign: 'left',
                  outline: 'none',
                }}
              >
                <span
                  style={{
                    width: px(24),
                    height: px(24),
                    borderRadius: '50%',
                    background: selected ? '#2563eb' : 'rgba(255,255,255,0.12)',
                    color: '#fff',
                    fontSize: px(12),
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span style={{ flex: 1, fontSize: px(14), lineHeight: 1.4 }}>{opt.label}</span>
                <span style={{ fontSize: px(12), color: selected ? '#bfdbfe' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                  {count} 票
                </span>
                {selected && <Check size={px(16)} style={{ color: '#93c5fd' }} />}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: px(10), marginTop: px(12), fontSize: px(12), color: '#9ca3af' }}>
          <span>已投 {voted} 人</span>
          <span style={{ color: active ? '#93c5fd' : '#9ca3af' }}>
            {!active ? '投票已结束' : selectedId ? '已投票,点击其它选项可改票' : '点击选项投票'}
          </span>
        </div>
      </div>
    );
  };

  const renderCloud = () => {
    if (session!.kind !== 'cloud') return null;
    const submitted = !!myResponse?.text && myResponse.text !== 'ack';
    const count = state?.responses.filter((r) => r.text && r.text !== 'ack').length ?? 0;
    return (
      <div key="cloud" data-interactive data-overlay-anim style={{ ...cardStyle, ...overlayIn('up', 180) }}>
        {statusRow('#67e8f9')}
        <div style={{ display: 'flex', alignItems: 'center', gap: px(7), marginBottom: px(6) }}>
          <Cloud size={px(17)} style={{ color: '#67e8f9' }} />
          <span style={{ fontSize: px(15), fontWeight: 700, lineHeight: 1.5 }}>{session!.question}</span>
        </div>
        <div style={{ fontSize: px(12), color: '#9ca3af', lineHeight: 1.6, marginBottom: px(10) }}>
          用一句话说说你的观点(最多 30 字),相同观点会在老师端合并聚合成词云。
        </div>
        <textarea
          value={cloudDraft}
          onChange={(e) => setCloudDraft(e.target.value.slice(0, 30))}
          disabled={!active}
          rows={2}
          placeholder="在这里写下你的观点…"
          style={{
            width: '100%',
            resize: 'none',
            padding: `${px(9)}px ${px(11)}px`,
            borderRadius: px(10),
            border: '1px solid #3a3a40',
            background: 'rgba(255,255,255,0.06)',
            color: '#f3f4f6',
            fontSize: px(14),
            lineHeight: 1.5,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', margin: `${px(6)}px 0 ${px(10)}px`, fontSize: px(11), color: '#6b7280' }}>
          <span>{cloudDraft.length}/30</span>
          <span style={{ marginLeft: 'auto' }}>已收到 {count} 条观点</span>
        </div>
        <button
          onClick={() => respond({ text: cloudDraft.trim() })}
          disabled={!active || !cloudDraft.trim()}
          style={primaryBtn(!active || !cloudDraft.trim())}
        >
          {submitted ? '更新我的观点' : '提交观点'}
        </button>
        {submitted && (
          <div style={{ marginTop: px(9), fontSize: px(12), color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: px(5) }}>
            <CheckCheck size={px(14)} /> 已提交,可修改后重新提交
          </div>
        )}
      </div>
    );
  };

  // ---- 举手常驻按钮 ----
  const raiseHandBtn = (
    <button
      data-interactive
      onClick={() => setHand(!myHandRaised)}
      title={myHandRaised ? '点击放下手' : '点击举手'}
      style={{
        position: 'absolute',
        right: px(18),
        bottom: px(18),
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: px(7),
        padding: `${px(9)}px ${px(16)}px`,
        borderRadius: px(999),
        border: myHandRaised ? '1px solid rgba(52,211,153,0.6)' : '1px solid #3a3a40',
        background: myHandRaised ? 'rgba(22,163,74,0.92)' : 'rgba(27,27,31,0.92)',
        color: myHandRaised ? '#ffffff' : '#d1d5db',
        fontSize: px(14),
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        outline: 'none',
        pointerEvents: 'auto',
      }}
    >
      <Hand size={px(17)} />
      {myHandRaised ? '已举手' : '举手'}
      {(state?.hands.length ?? 0) > 1 && (
        <span style={{ fontSize: px(12), color: myHandRaised ? '#d1fae5' : '#9ca3af' }}>
          · {state?.hands.length} 人
        </span>
      )}
    </button>
  );

  // ---- 顶部提示 ----
  const topChip = (() => {
    if (session?.kind === 'timer' && active) {
      return (
        <div
          data-interactive
          key="timer-chip"
          style={{
            position: 'absolute',
            top: px(54),
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: px(8),
            padding: `${px(8)}px ${px(18)}px`,
            borderRadius: px(999),
            background: 'rgba(6,78,59,0.92)',
            border: '1px solid rgba(52,211,153,0.45)',
            color: '#d1fae5',
            fontSize: px(14),
            zIndex: 35,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          <Timer size={px(16)} />
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: px(18) }}>
            {formatClock(remainSec ?? 0)}
          </span>
          <span style={{ fontSize: px(12), color: '#a7f3d0' }}>课堂计时</span>
        </div>
      );
    }
    if (session?.kind === 'rollcall' && active && !pickedMe && picked) {
      return (
        <div
          key="rollcall-chip"
          style={{
            position: 'absolute',
            top: px(54),
            left: '50%',
            transform: 'translateX(-50%)',
            padding: `${px(7)}px ${px(16)}px`,
            borderRadius: px(999),
            background: 'rgba(30,58,138,0.92)',
            border: '1px solid rgba(96,165,250,0.45)',
            color: '#dbeafe',
            fontSize: px(13),
            zIndex: 35,
            whiteSpace: 'nowrap',
          }}
        >
          老师正在点名:<b>{picked.name}</b>
        </div>
      );
    }
    return null;
  })();

  return (
    <>
      {raiseHandBtn}
      {topChip}
      {active && session?.kind === 'rollcall' && renderRollcall()}
      {active && session?.kind === 'buzz' && renderBuzz()}
      {session?.kind === 'poll' && renderPoll()}
      {session?.kind === 'cloud' && renderCloud()}
    </>
  );
}
