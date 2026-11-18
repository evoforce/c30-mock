import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  CheckCheck,
  Cloud,
  Dices,
  Hand,
  Play,
  Sparkles,
  Square,
  Timer,
  Trophy,
  Vote,
  X,
  Zap,
} from 'lucide-react';
import type { InteractKind, SessionMember } from '@c30/shared';
import { tallyCloud, tallyPoll } from '@c30/shared';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';
import type { InteractController } from '../hooks/useInteract';

// 教师端「互动」面板:底部工具条点「互动」弹出的深色浮层。
//
// 交互:
//   · 默认是一张功能菜单(随机点名/抢答/举手/投票/观点云/计时),对应 C30 授课助手的互动板块;
//   · 点任意一项 → 进配置页(需要题目的先填题) → 「发起」;
//   · 一旦有互动在跑,面板自动切到「结果」页:投票实时柱状图、抢答排名、观点云、点名确认……
//   · 所有结果来自服务端快照(interact.state),不是前端假数据;
//   · 举手是常驻的:标题栏的「✋ n」随时展开名单,老师可以一键全部放下。
const KIND_LABEL: Record<InteractKind, string> = {
  rollcall: '随机点名',
  buzz: '抢答',
  poll: '投票',
  cloud: '观点云',
  timer: '计时',
};

type FeatureKey = InteractKind | 'hand';

const FEATURES: { key: FeatureKey; label: string; desc: string; Icon: LucideIcon }[] = [
  { key: 'rollcall', label: '随机点名', desc: '从在线学生里抽一位', Icon: Dices },
  { key: 'buzz', label: '抢答', desc: '学生抢答并实时排名', Icon: Zap },
  { key: 'hand', label: '举手', desc: '查看 / 清空举手名单', Icon: Hand },
  { key: 'poll', label: '投票', desc: '选项投票 + 实时票数', Icon: Vote },
  { key: 'cloud', label: '观点云', desc: '一句话观点聚合成云', Icon: Cloud },
  { key: 'timer', label: '计时', desc: '课堂倒计时,两端同步', Icon: Timer },
];

const DURATION_CHOICES = [
  { value: 15, label: '15 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '60 秒' },
  { value: 0, label: '不限时' },
];

const POLL_DURATION_CHOICES = [
  { value: 30, label: '30 秒' },
  { value: 60, label: '60 秒' },
  { value: 120, label: '120 秒' },
  { value: 0, label: '不限时' },
];

const TIMER_CHOICES = [
  { value: 1, label: '1 分钟' },
  { value: 3, label: '3 分钟' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
];

const CLOUD_COLORS = ['#93c5fd', '#a7f3d0', '#fde68a', '#fca5a5', '#c4b5fd', '#67e8f9'];

/** 秒 → mm:ss(分钟可超过 99) */
function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** 互动有倒计时时每 500ms 触发一次重渲染(面板关闭时不走这个 hook) */
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

export default function InteractPanel({
  interact,
  members,
  studentCount,
  onClose,
}: {
  interact: InteractController;
  members: SessionMember[];
  studentCount: number;
  onClose: () => void;
}) {
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const snap = interact.state;
  const session = snap?.session ?? null;
  const enabled = snap?.enabled !== false;
  const ended = session?.endedAt != null;
  const now = useNow(!!session?.endsAt && !ended);
  const remainSec =
    session?.endsAt != null ? Math.max(0, Math.ceil((session.endsAt - now) / 1000)) : null;

  // 正在配置的功能;null = 功能菜单。会话一开就自动回到结果页。
  const [pending, setPending] = useState<FeatureKey | null>(null);
  const [handsOpen, setHandsOpen] = useState(false);

  // 抢答 / 投票 / 计时的配置草稿
  const [buzzSeconds, setBuzzSeconds] = useState(30);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '', '', '']);
  const [pollSeconds, setPollSeconds] = useState(60);
  const [cloudTopic, setCloudTopic] = useState('');
  const [timerMinutes, setTimerMinutes] = useState(3);

  // 互动开始/结束时收起配置页(避免旧表单盖在新会话上)
  useEffect(() => {
    if (session) setPending(null);
  }, [session?.id, session?.endedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const hands = snap?.hands ?? [];
  const responses = snap?.responses ?? [];

  const nameOf = (userId: string): string =>
    members.find((m) => m.userId === userId)?.name ??
    responses.find((r) => r.userId === userId)?.name ??
    '同学';

  const openFeature = (key: FeatureKey) => {
    if (!enabled) return;
    if (key === 'hand') {
      setHandsOpen(true);
      return;
    }
    if (key === 'rollcall') {
      interact.start({ kind: 'rollcall' });
      return;
    }
    setPending(key);
  };

  const startPoll = () => {
    const options = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!pollQuestion.trim() || options.length < 2) return;
    interact.start({
      kind: 'poll',
      question: pollQuestion.trim(),
      options,
      durationSec: pollSeconds || null,
    });
  };

  const startCloud = () => {
    if (!cloudTopic.trim()) return;
    interact.start({ kind: 'cloud', question: cloudTopic.trim() });
  };

  // ---- 通用小控件 ----

  const chip = (active: boolean): React.CSSProperties => ({
    padding: `${px(7)}px ${px(13)}px`,
    borderRadius: px(9),
    border: active ? '1px solid #3b82f6' : '1px solid #3a3a40',
    background: active ? 'rgba(37,99,235,0.22)' : 'rgba(255,255,255,0.04)',
    color: active ? '#bfdbfe' : '#cbd5e1',
    fontSize: px(13),
    cursor: 'pointer',
    outline: 'none',
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: `${px(9)}px ${px(11)}px`,
    borderRadius: px(9),
    border: '1px solid #3a3a40',
    background: 'rgba(255,255,255,0.06)',
    color: '#f3f4f6',
    fontSize: px(14),
    outline: 'none',
  };

  const btnStyle = (kind: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
    padding: `${px(8)}px ${px(16)}px`,
    borderRadius: px(9),
    border: kind === 'ghost' ? '1px solid #3a3a40' : 'none',
    background:
      kind === 'primary' ? '#2563eb' : kind === 'danger' ? 'rgba(229,72,77,0.16)' : 'transparent',
    color: kind === 'primary' ? '#ffffff' : kind === 'danger' ? '#fca5a5' : '#cbd5e1',
    fontSize: px(13),
    fontWeight: kind === 'primary' ? 600 : 400,
    cursor: 'pointer',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: px(6),
  });

  const sectionTitle = (text: string): React.ReactNode => (
    <div style={{ fontSize: px(12), color: '#9ca3af', marginBottom: px(6) }}>{text}</div>
  );

  // ---- 结果页 ----

  const renderResult = () => {
    if (!session) return null;
    return (
      <div>
        {/* 状态行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: px(8), marginBottom: px(10) }}>
          <span
            style={{
              fontSize: px(12),
              padding: `${px(3)}px ${px(9)}px`,
              borderRadius: px(999),
              background: 'rgba(59,130,246,0.18)',
              color: '#93c5fd',
              fontWeight: 600,
            }}
          >
            {KIND_LABEL[session.kind]}
          </span>
          <span
            style={{
              fontSize: px(12),
              color: ended ? '#9ca3af' : '#34d399',
              display: 'flex',
              alignItems: 'center',
              gap: px(5),
            }}
          >
            <span
              style={{
                width: px(6),
                height: px(6),
                borderRadius: '50%',
                background: ended ? '#6b7280' : '#34d399',
              }}
            />
            {ended ? '已结束' : '进行中'}
          </span>
          {remainSec != null && !ended && (
            <span style={{ marginLeft: 'auto', fontSize: px(13), color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
              剩余 {formatClock(remainSec)}
            </span>
          )}
          <span style={{ marginLeft: remainSec != null && !ended ? px(10) : 'auto', fontSize: px(12), color: '#9ca3af' }}>
            {studentCount} 名学生
          </span>
        </div>

        {session.question && (
          <div style={{ fontSize: px(15), fontWeight: 600, color: '#f3f4f6', lineHeight: 1.5, marginBottom: px(12) }}>
            {session.question}
          </div>
        )}

        {session.kind === 'rollcall' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: `${px(18)}px ${px(12)}px ${px(8)}px`,
            }}
          >
            <div
              style={{
                width: px(72),
                height: px(72),
                borderRadius: '50%',
                background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: px(30),
                fontWeight: 700,
                boxShadow: '0 8px 22px rgba(37,99,235,0.4)',
              }}
            >
              {(snap?.picked?.name ?? '?').charAt(0)}
            </div>
            <div style={{ fontSize: px(22), fontWeight: 700, color: '#ffffff', marginTop: px(10) }}>
              {snap?.picked?.name ?? '还没有点到人'}
            </div>
            <div
              style={{
                fontSize: px(13),
                color: responses.some((r) => r.text === 'ack') ? '#34d399' : '#9ca3af',
                marginTop: px(6),
                display: 'flex',
                alignItems: 'center',
                gap: px(5),
              }}
            >
              {responses.some((r) => r.text === 'ack') ? (
                <>
                  <CheckCheck size={px(15)} /> 学生已确认,请 TA 起立回答
                </>
              ) : (
                '等待学生确认…'
              )}
            </div>
          </div>
        )}

        {session.kind === 'buzz' && (
          <div>
            {(snap?.buzzOrder.length ?? 0) === 0 ? (
              <div
                style={{
                  padding: `${px(26)}px 0`,
                  textAlign: 'center',
                  color: '#9ca3af',
                  fontSize: px(14),
                }}
              >
                <Zap size={px(28)} style={{ color: '#fbbf24', marginBottom: px(6) }} />
                <div>{ended ? '本次抢答没有学生参与' : '等待学生抢答…'}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: px(8) }}>
                {snap!.buzzOrder.map((userId, index) => (
                  <div
                    key={userId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: px(10),
                      padding: `${px(9)}px ${px(12)}px`,
                      borderRadius: px(10),
                      background: index === 0 ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.05)',
                      border: index === 0 ? '1px solid rgba(251,191,36,0.45)' : '1px solid transparent',
                    }}
                  >
                    <span
                      style={{
                        width: px(26),
                        height: px(26),
                        borderRadius: '50%',
                        background: index === 0 ? '#f59e0b' : index === 1 ? '#9ca3af' : index === 2 ? '#b45309' : 'rgba(255,255,255,0.12)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: px(13),
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {index + 1}
                    </span>
                    <span style={{ fontSize: px(15), color: '#f3f4f6', fontWeight: index === 0 ? 600 : 400 }}>
                      {nameOf(userId)}
                    </span>
                    {index === 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: px(12), color: '#fbbf24', display: 'flex', alignItems: 'center', gap: px(4) }}>
                        <Trophy size={px(14)} /> 抢到
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {session.kind === 'poll' &&
          (() => {
            const tally = tallyPoll(session, responses);
            const votes = responses.filter((r) => r.optionIds.length > 0).length;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: px(9) }}>
                {tally.map((row, i) => (
                  <div key={row.option.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: px(13), marginBottom: px(4) }}>
                      <span style={{ color: '#e5e7eb' }}>
                        {String.fromCharCode(65 + i)}. {row.option.label}
                      </span>
                      <span style={{ color: row.count > 0 ? '#93c5fd' : '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                        {row.count} 票 · {Math.round(row.ratio * 100)}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: px(8),
                        borderRadius: px(4),
                        background: 'rgba(255,255,255,0.08)',
                        overflow: 'hidden',
                      }}
                      title={row.voters.join('、')}
                    >
                      <div
                        style={{
                          width: `${Math.round(row.ratio * 100)}%`,
                          height: '100%',
                          borderRadius: px(4),
                          background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
                          transition: 'width .3s ease',
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: px(14), fontSize: px(12), color: '#9ca3af', marginTop: px(2) }}>
                  <span>已投 {votes} 人</span>
                  <span>未投 {Math.max(0, studentCount - votes)} 人</span>
                </div>
              </div>
            );
          })()}

        {session.kind === 'cloud' &&
          (() => {
            const words = tallyCloud(responses);
            return (
              <div>
                {words.length === 0 ? (
                  <div style={{ padding: `${px(26)}px 0`, textAlign: 'center', color: '#9ca3af', fontSize: px(14) }}>
                    <Cloud size={px(28)} style={{ color: '#93c5fd', marginBottom: px(6) }} />
                    <div>{ended ? '本次没有收到观点' : '等待学生提交观点…'}</div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: `${px(6)}px ${px(12)}px`,
                      padding: `${px(12)}px ${px(6)}px`,
                      maxHeight: px(210),
                      overflowY: 'auto',
                    }}
                    className="c30-dark-scroll"
                  >
                    {words.map((w, i) => (
                      <span
                        key={w.text}
                        title={`${w.count} 人提到`}
                        style={{
                          fontSize: px(15 + Math.min(4, w.count - 1) * 4),
                          fontWeight: w.count > 1 ? 700 : 500,
                          color: CLOUD_COLORS[i % CLOUD_COLORS.length],
                          lineHeight: 1.25,
                        }}
                      >
                        {w.text}
                        {w.count > 1 && (
                          <span style={{ fontSize: px(11), color: '#9ca3af', marginLeft: px(3) }}>
                            ×{w.count}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: px(14), fontSize: px(12), color: '#9ca3af', marginTop: px(6) }}>
                  <span>共 {responses.length} 条观点</span>
                  <span>去重后 {words.length} 个</span>
                </div>
              </div>
            );
          })()}

        {session.kind === 'timer' && (
          <div style={{ textAlign: 'center', padding: `${px(10)}px 0 ${px(4)}px` }}>
            <div
              style={{
                fontSize: px(52),
                fontWeight: 700,
                color: ended ? '#6b7280' : '#f3f4f6',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: px(2),
              }}
            >
              {formatClock(ended ? 0 : remainSec ?? 0)}
            </div>
            <div style={{ fontSize: px(13), color: '#9ca3af', marginTop: px(4) }}>
              {ended ? '计时已结束' : '全班同步倒计时,学生端屏幕顶部可见'}
            </div>
          </div>
        )}

        {/* 操作区 */}
        <div style={{ display: 'flex', gap: px(8), justifyContent: 'flex-end', marginTop: px(16) }}>
          {!ended && (
            <button onClick={interact.end} style={btnStyle('danger')}>
              <Square size={px(14)} /> 结束{KIND_LABEL[session.kind]}
            </button>
          )}
          <button onClick={interact.reset} style={btnStyle('primary')}>
            关闭结果
          </button>
        </div>
      </div>
    );
  };

  // ---- 配置页 ----

  const configHeader = (title: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: px(8), marginBottom: px(14) }}>
      <button
        onClick={() => setPending(null)}
        title="返回"
        style={{
          width: px(28),
          height: px(28),
          borderRadius: px(8),
          border: 'none',
          background: 'rgba(255,255,255,0.06)',
          color: '#cbd5e1',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          outline: 'none',
          padding: 0,
        }}
      >
        <ArrowLeft size={px(16)} />
      </button>
      <span style={{ fontSize: px(15), fontWeight: 600, color: '#f3f4f6' }}>{title}</span>
    </div>
  );

  const renderConfig = () => {
    if (pending === 'buzz') {
      return (
        <div>
          {configHeader('抢答设置')}
          {sectionTitle('限时(到点自动结束)')}
          <div style={{ display: 'flex', gap: px(8), flexWrap: 'wrap', marginBottom: px(16) }}>
            {DURATION_CHOICES.map((c) => (
              <button key={c.value} onClick={() => setBuzzSeconds(c.value)} style={chip(buzzSeconds === c.value)}>
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: px(12), color: '#9ca3af', lineHeight: 1.7, marginBottom: px(16) }}>
            学生端会出现一个大号「抢答」按钮,点击后按先后排序;
            老师面板实时显示名次,可以据此点名回答。
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                interact.start({ kind: 'buzz', question: '抢答', durationSec: buzzSeconds || null });
                setPending(null);
              }}
              style={btnStyle('primary')}
            >
              <Play size={px(14)} /> 发起抢答
            </button>
          </div>
        </div>
      );
    }

    if (pending === 'poll') {
      const validOptions = pollOptions.filter((o) => o.trim()).length;
      const valid = pollQuestion.trim().length > 0 && validOptions >= 2;
      return (
        <div>
          {configHeader('发起投票')}
          {sectionTitle('题目')}
          <input
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value)}
            placeholder="例如:今天讲的三种岩石里,哪一种由岩浆冷却形成?"
            style={{ ...inputStyle, marginBottom: px(14) }}
          />
          {sectionTitle(`选项(最少 2 个,最多 6 个,当前 ${validOptions} 个有效)`)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: px(7), marginBottom: px(10) }}>
            {pollOptions.map((opt, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: px(8) }}>
                <span style={{ width: px(20), color: '#9ca3af', fontSize: px(13) }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <input
                  value={opt}
                  onChange={(e) =>
                    setPollOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))
                  }
                  placeholder={`选项 ${String.fromCharCode(65 + i)}`}
                  style={inputStyle}
                />
                <button
                  onClick={() => setPollOptions((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={pollOptions.length <= 2}
                  title={pollOptions.length <= 2 ? '至少保留 2 个选项' : '删除该选项'}
                  style={{
                    width: px(26),
                    height: px(26),
                    borderRadius: px(7),
                    border: 'none',
                    background: 'transparent',
                    color: pollOptions.length <= 2 ? '#4b5563' : '#9ca3af',
                    cursor: pollOptions.length <= 2 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    outline: 'none',
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <X size={px(15)} />
                </button>
              </div>
            ))}
          </div>
          {pollOptions.length < 6 && (
            <button
              onClick={() => setPollOptions((prev) => [...prev, ''])}
              style={{ ...btnStyle('ghost'), marginBottom: px(14) }}
            >
              + 添加选项
            </button>
          )}
          {sectionTitle('限时')}
          <div style={{ display: 'flex', gap: px(8), flexWrap: 'wrap', marginBottom: px(18) }}>
            {POLL_DURATION_CHOICES.map((c) => (
              <button key={c.value} onClick={() => setPollSeconds(c.value)} style={chip(pollSeconds === c.value)}>
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={startPoll} disabled={!valid} style={{ ...btnStyle('primary'), opacity: valid ? 1 : 0.45 }}>
              <Play size={px(14)} /> 发起投票
            </button>
          </div>
        </div>
      );
    }

    if (pending === 'cloud') {
      return (
        <div>
          {configHeader('观点云')}
          {sectionTitle('话题')}
          <input
            value={cloudTopic}
            onChange={(e) => setCloudTopic(e.target.value)}
            placeholder="例如:用一句话说说你对「自适应」的理解"
            style={{ ...inputStyle, marginBottom: px(12) }}
          />
          <div style={{ fontSize: px(12), color: '#9ca3af', lineHeight: 1.7, marginBottom: px(18) }}>
            学生提交一句话(最多 30 字),相同观点自动合并计数并按热度放大;
            老师端实时聚合成词云,适合开放讨论后的收束。
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={startCloud}
              disabled={!cloudTopic.trim()}
              style={{ ...btnStyle('primary'), opacity: cloudTopic.trim() ? 1 : 0.45 }}
            >
              <Play size={px(14)} /> 发起观点云
            </button>
          </div>
        </div>
      );
    }

    if (pending === 'timer') {
      return (
        <div>
          {configHeader('课堂计时')}
          {sectionTitle('时长')}
          <div style={{ display: 'flex', gap: px(8), flexWrap: 'wrap', marginBottom: px(18) }}>
            {TIMER_CHOICES.map((c) => (
              <button key={c.value} onClick={() => setTimerMinutes(c.value)} style={chip(timerMinutes === c.value)}>
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: px(12), color: '#9ca3af', lineHeight: 1.7, marginBottom: px(18) }}>
            开始后教师端面板与学生端屏幕顶部同步倒计时,时间到自动结束,可用于限时练、小组讨论计时。
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                interact.start({ kind: 'timer', question: '课堂计时', durationSec: timerMinutes * 60 });
                setPending(null);
              }}
              style={btnStyle('primary')}
            >
              <Play size={px(14)} /> 开始计时
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  // ---- 功能菜单 ----

  const renderMenu = () => (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: px(9) }}>
        {FEATURES.map((f) => {
          const Icon = f.Icon;
          return (
            <button
              key={f.key}
              onClick={() => openFeature(f.key)}
              disabled={!enabled}
              style={{
                textAlign: 'left',
                padding: `${px(11)}px ${px(12)}px`,
                borderRadius: px(11),
                border: '1px solid #333339',
                background: 'rgba(255,255,255,0.045)',
                color: '#e5e7eb',
                cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: enabled ? 1 : 0.45,
                outline: 'none',
                transition: 'all .15s ease',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!enabled) return;
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.18)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(96,165,250,0.55)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.045)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#333339';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: px(8), marginBottom: px(6) }}>
                <span
                  style={{
                    width: px(28),
                    height: px(28),
                    borderRadius: px(8),
                    background: 'rgba(37,99,235,0.22)',
                    color: '#93c5fd',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={px(16)} />
                </span>
                <span style={{ fontSize: px(14), fontWeight: 600 }}>{f.label}</span>
                {f.key === 'hand' && hands.length > 0 && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      minWidth: px(18),
                      height: px(18),
                      padding: `0 ${px(5)}px`,
                      borderRadius: px(9),
                      background: '#e5484d',
                      color: '#fff',
                      fontSize: px(11),
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {hands.length}
                  </span>
                )}
              </div>
              <div style={{ fontSize: px(11), color: '#9ca3af', lineHeight: 1.4 }}>{f.desc}</div>
            </button>
          );
        })}
      </div>

      {!enabled && (
        <div
          style={{
            marginTop: px(12),
            padding: `${px(9)}px ${px(12)}px`,
            borderRadius: px(9),
            background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.28)',
            color: '#fcd34d',
            fontSize: px(12),
            lineHeight: 1.6,
          }}
        >
          系统设置里「允许互动」已关闭:学生端不会出现互动入口。到「菜单 → 设置 → 允许互动」打开即可。
        </div>
      )}
    </div>
  );

  // ---- 举手名单(常驻叠加区,不影响当前结果页) ----
  const renderHands = () => (
    <div
      style={{
        padding: `${px(10)}px ${px(16)}px ${px(12)}px`,
        borderBottom: '1px solid #2a2a30',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: px(8), marginBottom: px(8) }}>
        <Hand size={px(15)} style={{ color: '#fbbf24' }} />
        <span style={{ fontSize: px(13), fontWeight: 600, color: '#f3f4f6' }}>
          举手名单({hands.length})
        </span>
        {hands.length > 0 && (
          <button
            onClick={interact.clearHands}
            style={{ ...btnStyle('ghost'), marginLeft: 'auto', padding: `${px(5)}px ${px(10)}px`, fontSize: px(12) }}
          >
            全部放下
          </button>
        )}
      </div>
      {hands.length === 0 ? (
        <div style={{ fontSize: px(12), color: '#9ca3af', padding: `${px(4)}px 0` }}>
          暂无学生举手(学生端「举手」按钮随时可用)
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(6), maxHeight: px(96), overflowY: 'auto' }} className="c30-dark-scroll">
          {hands.map((h) => (
            <span
              key={h.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: px(5),
                padding: `${px(4)}px ${px(9)}px`,
                borderRadius: px(999),
                background: 'rgba(251,191,36,0.14)',
                border: '1px solid rgba(251,191,36,0.3)',
                color: '#fde68a',
                fontSize: px(12),
              }}
            >
              {h.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        width: px(620),
        maxWidth: 'calc(100vw - 24px)',
        background: '#1b1b1f',
        borderRadius: px(16),
        border: '1px solid #333339',
        boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        overflow: 'hidden',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: px(10),
          padding: `${px(12)}px ${px(16)}px`,
          borderBottom: '1px solid #2a2a30',
        }}
      >
        <span
          style={{
            width: px(30),
            height: px(30),
            borderRadius: px(9),
            background: 'rgba(37,99,235,0.22)',
            color: '#93c5fd',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Sparkles size={px(17)} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: px(15), fontWeight: 600, color: '#ffffff' }}>课堂互动</span>
          <span style={{ fontSize: px(11), color: '#9ca3af', marginTop: px(1) }}>
            {session ? `${KIND_LABEL[session.kind]} · ${ended ? '已结束' : '进行中'}` : '选择一种互动方式,学生端实时参与'}
          </span>
        </div>

        {hands.length > 0 && (
          <button
            onClick={() => setHandsOpen((v) => !v)}
            title="举手名单"
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: px(5),
              padding: `${px(5)}px ${px(10)}px`,
              borderRadius: px(999),
              border: '1px solid rgba(251,191,36,0.35)',
              background: handsOpen ? 'rgba(251,191,36,0.22)' : 'rgba(251,191,36,0.1)',
              color: '#fde68a',
              fontSize: px(12),
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <Hand size={px(14)} /> {hands.length}
          </button>
        )}

        <button
          onClick={onClose}
          title="关闭互动面板"
          style={{
            marginLeft: hands.length > 0 ? px(8) : 'auto',
            width: px(28),
            height: px(28),
            borderRadius: px(8),
            border: 'none',
            background: 'transparent',
            color: '#9ca3af',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            outline: 'none',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
          }}
        >
          <X size={px(17)} />
        </button>
      </div>

      {/* 报错(例如未上课就发起互动) */}
      {interact.error && (
        <div
          style={{
            padding: `${px(8)}px ${px(16)}px`,
            background: 'rgba(229,72,77,0.14)',
            color: '#fca5a5',
            fontSize: px(12),
            borderBottom: '1px solid rgba(229,72,77,0.25)',
          }}
        >
          {interact.error}
        </div>
      )}

      {handsOpen && renderHands()}

      <div
        className="c30-dark-scroll"
        style={{
          padding: px(16),
          maxHeight: `calc(100vh - ${px(200)}px)`,
          overflowY: 'auto',
        }}
      >
        {session ? renderResult() : pending ? renderConfig() : renderMenu()}
      </div>
    </div>
  );
}
