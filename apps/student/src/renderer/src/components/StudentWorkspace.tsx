import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionMember, User, InteractionControl, StageMode } from '@c30/shared';
import { countStudents } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import { LogOut, Maximize2, Minimize2, Users, Wifi, ScreenShare, Presentation } from 'lucide-react';
import ClassWaiting from './ClassWaiting';
import ClassStage from './ClassStage';
import useStudentRtc from '../hooks/useStudentRtc';

// 房间信息(来自 mDNS 发现)
interface RoomInfo {
  roomCode: string;
  teacherName: string;
  host: string;
  port: number;
}

// 接收端(学生端):窗口化课堂客户端(会议软件形态)。
// 进入课堂前是「我的课堂」列表;上课前是等待页;上课后是「顶栏 + 老师画面舞台 + 底栏」。
export default function StudentWorkspace() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<RoomInfo | null>(null);
  const [status, setStatus] = useState<'searching' | 'connecting' | 'joined' | 'error'>('searching');
  const [error, setError] = useState('');
  const [identity, setIdentity] = useState<User | null>(null);

  // 课堂直播状态:null = 刚加入、还没同步到;false = 未上课/已下课(等待页);true = 上课中
  const [classActive, setClassActive] = useState<boolean | null>(null);
  const [classStartedAt, setClassStartedAt] = useState<number | null>(null);
  const [classEnded, setClassEnded] = useState(false);
  // 与老师的 socket 断线(老师退出 / 网络中断):先回等待页并自动重连,不要停在旧画面上
  const [connectionLost, setConnectionLost] = useState(false);
  const classWasActiveRef = useRef(false);

  // 舞台:老师共享的是屏幕还是白板;board 是老师虚拟画布尺寸
  const [stage, setStage] = useState<{ mode: StageMode; board: { w: number; h: number } | null }>({
    mode: 'screen',
    board: null,
  });
  // 老师光标(老师端 20Hz 广播)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const cursorTimerRef = useRef<number | null>(null);
  // 顶栏计时
  const [clock, setClock] = useState(() => Date.now());
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 课堂互动控制(弹幕开关 / 允许互动)
  const [interaction, setInteraction] = useState<InteractionControl>({
    danmakuEnabled: true,
    interactEnabled: true,
  });

  const socketRef = useRef<Socket | null>(null);
  // 正在尝试加入的房间:加入失败(房间已关/连不上)时用它把卡片从列表里摘掉
  const joiningRoomRef = useRef<RoomInfo | null>(null);

  // 屏幕共享:老师投屏时自动请求并接收 WebRTC 画面
  const { stream, phase } = useStudentRtc({
    socket,
    roomCode,
    classActive: classActive === true,
    stage: stage.mode,
  });

  // 匿名学生身份
  useEffect(() => {
    const id = `student-${Math.random().toString(36).slice(2, 10)}`;
    setIdentity({ id, username: id, name: '学生', role: 'STUDENT' });
  }, []);

  // 顶栏计时
  useEffect(() => {
    if (classStartedAt == null) return;
    setClock(Date.now());
    const t = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [classStartedAt]);

  // 全屏状态
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // 窗口标题
  useEffect(() => {
    document.title = joined ? `${selectedRoom?.teacherName ?? '老师'}的课堂 · C30学生端` : 'C30学生端';
  }, [joined, selectedRoom]);

  // 清理光标隐藏定时器
  useEffect(
    () => () => {
      if (cursorTimerRef.current) window.clearTimeout(cursorTimerRef.current);
    },
    [],
  );

  const pushCursor = useCallback((p: { x: number; y: number }) => {
    setCursor(p);
    if (cursorTimerRef.current) window.clearTimeout(cursorTimerRef.current);
    // 老师 2.5s 不动就隐藏光标,避免停在画面上
    cursorTimerRef.current = window.setTimeout(() => setCursor(null), 2500);
  }, []);

  const bindEvents = useCallback(
    (s: Socket) => {
      s.on('connect', () => setConnectionLost(false));
      s.on('disconnect', () => {
        setConnectionLost(true);
        setClassActive(false);
        setClassStartedAt(null);
        setCursor(null);
      });
      s.on('session.joined', (d: { roomCode: string; members: SessionMember[] }) => {
        setRoomCode(d.roomCode);
        setMembers(d.members);
        setJoined(true);
        setStatus('joined');
        setConnectionLost(false);
        setError('');
      });
      s.on('session.memberJoin', (d: { member: SessionMember }) => {
        setMembers((prev) => (prev.some((m) => m.userId === d.member.userId) ? prev : [...prev, d.member]));
      });
      s.on('session.memberLeave', (d: { userId: string }) => {
        setMembers((prev) => prev.filter((m) => m.userId !== d.userId));
      });
      s.on('session.members', (d: { members: SessionMember[] }) => {
        setMembers(d.members);
      });
      // 课堂直播状态:老师点「上课」→ true;点「下课」→ false(回到等待页)
      s.on('class.state', (d: { active: boolean; startedAt: number | null }) => {
        setClassActive(d.active);
        setClassStartedAt(d.active ? d.startedAt : null);
        if (d.active) {
          classWasActiveRef.current = true;
          setClassEnded(false);
        } else {
          setClassStartedAt(null);
          setCursor(null);
          if (classWasActiveRef.current) setClassEnded(true);
        }
      });
      // 老师切换「共享屏幕 / 白板」
      s.on('stage.state', (d: { mode: StageMode; board: { w: number; h: number } | null }) => {
        setStage({ mode: d.mode === 'whiteboard' ? 'whiteboard' : 'screen', board: d.board ?? null });
      });
      s.on('cursor.move', (d: { x: number; y: number }) => {
        if (typeof d?.x === 'number' && typeof d?.y === 'number') pushCursor({ x: d.x, y: d.y });
      });
      s.on('session.error', (d: { message: string }) => {
        setError(d.message);
        setStatus('error');
        setJoined(false);
        setClassActive(null);
        setClassStartedAt(null);
        setClassEnded(false);
        // 房间已不存在/已重建:把这张过期卡片从列表里摘掉,避免反复点进死课堂
        if (/不存在|已结束|已重建/.test(d.message)) {
          const code = joiningRoomRef.current?.roomCode;
          if (code) setRooms((prev) => prev.filter((r) => r.roomCode !== code));
        }
      });
      s.on('interaction.control', (d: { control: InteractionControl }) => {
        setInteraction(d.control);
      });
    },
    [pushCursor],
  );

  // 兼容旧版教师端:旧版只发 session.joined + 白板快照,不会发 class.state。
  // 若 2.5s 内没等到课堂状态,就按「已在上课 + 白板」处理,避免学生端一直卡在等待页。
  // 新版教师端会在 join 后立刻发 class.state / stage.state,不会走到这个兜底。
  useEffect(() => {
    if (!joined || classActive !== null) return;
    const timer = setTimeout(() => {
      setClassActive((prev) => (prev === null ? true : prev));
      setStage((prev) => (prev.mode === 'screen' && !prev.board ? { mode: 'whiteboard', board: null } : prev));
    }, 2500);
    return () => clearTimeout(timer);
  }, [joined, classActive]);

  // 直连指定房间(纯局域网,无中继)
  const joinRoom = useCallback(
    (room: RoomInfo) => {
      if (socketRef.current) socketRef.current.disconnect();
      joiningRoomRef.current = room;
      setSelectedRoom(room);
      setStatus('connecting');
      setError('');
      setClassActive(null);
      setClassStartedAt(null);
      setClassEnded(false);
      setStage({ mode: 'screen', board: null });
      setCursor(null);
      classWasActiveRef.current = false;

      const url = `http://${room.host}:${room.port}`;
      const s = io(url, { transports: ['websocket', 'polling'] });

      s.on('connect', () => {
        if (identity) {
          s.emit('session.join', {
            payload: { roomCode: room.roomCode, userId: identity.id, name: identity.name },
          });
        }
      });

      s.on('connect_error', () => {
        setStatus('error');
        setError('无法连接到该课堂,请确认发送端在线且网络可达');
        // 连不上说明这个端点已经关了:把该端点的房间全部摘掉
        setRooms((prev) => prev.filter((r) => !(r.host === room.host && r.port === room.port)));
      });

      socketRef.current = s;
      setSocket(s);
      bindEvents(s);
    },
    [bindEvents, identity],
  );

  // 订阅局域网发现 → 收集房间列表
  useEffect(() => {
    const api = (window as any).api?.discovery;
    if (!api) return;

    api.getRooms?.().then((list: RoomInfo[]) => {
      if (list && list.length > 0) setRooms(list);
    });

    const offFound = api.onFound?.((info: RoomInfo) => {
      setRooms((prev) => (prev.some((r) => r.roomCode === info.roomCode) ? prev : [...prev, info]));
    });
    const offLost = api.onLost?.((roomCode: string) => {
      setRooms((prev) => prev.filter((r) => r.roomCode !== roomCode));
    });
    return () => {
      offFound?.();
      offLost?.();
    };
  }, []);

  // 房间探活:mDNS 列表可能留着已关闭 / 已重建的旧房间(教师端刷新会换房间号),
  // 列表一变就按 host:port 各连一次服务端,只保留「老师在线」的房间;端点连不上则整段剔除。
  // 服务端判定见 localSessionServer 的 discovery.probe(teacherLastSeenAt + 10s 宽限)。
  const roomKey = rooms
    .map((r) => `${r.roomCode}@${r.host}:${r.port}`)
    .sort()
    .join('|');
  useEffect(() => {
    if (!roomKey || joined) return;

    const groups = new Map<string, { host: string; port: number; codes: string[] }>();
    for (const r of rooms) {
      const key = `${r.host}:${r.port}`;
      const group = groups.get(key);
      if (group) group.codes.push(r.roomCode);
      else groups.set(key, { host: r.host, port: r.port, codes: [r.roomCode] });
    }

    const sockets: Socket[] = [];
    let cancelled = false;
    const drop = (codes: string[]) => {
      if (cancelled || codes.length === 0) return;
      setRooms((prev) => prev.filter((r) => !codes.includes(r.roomCode)));
    };

    for (const group of groups.values()) {
      const s = io(`http://${group.host}:${group.port}`, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 2500,
      });
      sockets.push(s);
      // 老版本教师端没有 probe 处理:3s 内没答复就断开,但**不剔除**(宁可留着也不能误删活房间)
      const giveUp = window.setTimeout(() => s.disconnect(), 3000);
      s.on('connect', () => s.emit('discovery.probe', { roomCodes: group.codes }));
      s.on('discovery.probe.result', (d: { live?: string[] }) => {
        window.clearTimeout(giveUp);
        const live = Array.isArray(d?.live) ? d.live : [];
        drop(group.codes.filter((code) => !live.includes(code)));
        s.disconnect();
      });
      s.on('connect_error', () => {
        window.clearTimeout(giveUp);
        drop(group.codes);
      });
    }

    return () => {
      cancelled = true;
      for (const s of sockets) s.disconnect();
    };
    // roomKey 是列表内容的稳定签名:列表没变就不重复探活
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, joined]);

  // 退出课堂,回到房间列表
  const leave = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSocket(null);
    setJoined(false);
    setSelectedRoom(null);
    setStatus('searching');
    setMembers([]);
    setRoomCode('');
    setClassActive(null);
    setClassStartedAt(null);
    setClassEnded(false);
    setConnectionLost(false);
    setStage({ mode: 'screen', board: null });
    setCursor(null);
    setInteraction({ danmakuEnabled: true, interactEnabled: true });
    classWasActiveRef.current = false;
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const timerText = (() => {
    if (classStartedAt == null) return '00:00';
    const sec = Math.max(0, Math.floor((clock - classStartedAt) / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  })();

  const teacherName = selectedRoom?.teacherName ?? '';
  // 人数口径统一:在线学生数(不含老师),与教师端「班级 N 人」一致。
  const studentCount = countStudents(members);

  // ---- 已加入:上课前等待页(断线时也回到这里,显示正在重连) ----
  if (joined && (classActive !== true || connectionLost)) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0f1115' }}>
        <ClassWaiting
          teacherName={teacherName}
          roomCode={roomCode || selectedRoom?.roomCode || ''}
          studentCount={studentCount}
          ended={classEnded}
          pending={classActive === null}
          offline={connectionLost}
          onLeave={leave}
        />
      </div>
    );
  }

  // ---- 已加入且上课中:窗口化的课堂主界面 ----
  if (joined) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0f1115' }}>
        {/* 顶栏:课堂名 / 老师 / 上课状态 + 计时 / 人数 / 全屏 / 退出 */}
        <header
          style={{
            flex: '0 0 auto',
            height: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 14px',
            background: '#171a21',
            borderBottom: '1px solid #262b36',
            color: '#e5e7eb',
            userSelect: 'none',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{teacherName || '课堂'}</span>
          <span
            style={{
              fontSize: 12,
              color: '#cbd5e1',
              background: '#243044',
              borderRadius: 999,
              padding: '3px 9px',
              whiteSpace: 'nowrap',
            }}
          >
            上课中 {timerText}
          </span>
          <span style={{ fontSize: 12, color: '#7c8798', whiteSpace: 'nowrap' }}>房间号 {roomCode}</span>

          <span style={{ flex: 1 }} />

          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9ca3af' }}>
            <Wifi size={14} /> 局域网
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9ca3af' }}>
            <Users size={14} /> 学生 {studentCount}
          </span>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏'}
            style={iconBtnStyle}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#262d3a')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <button
            onClick={leave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              height: 30,
              padding: '0 12px',
              border: 'none',
              borderRadius: 8,
              background: '#3b1f24',
              color: '#fca5a5',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#51262d')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#3b1f24')}
          >
            <LogOut size={14} /> 退出课堂
          </button>
        </header>

        {/* 舞台:老师屏幕 / 白板 */}
        <ClassStage
          socket={socket}
          roomCode={roomCode}
          userId={identity?.id}
          interaction={interaction}
          mode={stage.mode}
          board={stage.board}
          stream={stream}
          phase={phase}
          cursor={cursor}
        />

        {/* 底栏:当前模式 + 提示 */}
        <footer
          style={{
            flex: '0 0 auto',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            background: '#171a21',
            borderTop: '1px solid #262b36',
            color: '#8b95a5',
            fontSize: 12,
            userSelect: 'none',
          }}
        >
          {stage.mode === 'screen' ? <ScreenShare size={14} /> : <Presentation size={14} />}
          <span>{stage.mode === 'screen' ? '正在跟随老师共享的屏幕' : '正在跟随老师白板'}</span>
          <span style={{ color: '#4b5563' }}>·</span>
          <span>举手 / 答题在画面右下角</span>
          <span style={{ flex: 1 }} />
          {stream && <span style={{ color: '#4ade80' }}>画面已连接</span>}
          {!stream && stage.mode === 'screen' && <span>等待老师共享画面…</span>}
        </footer>
      </div>
    );
  }

  // ---- 未加入:我的课堂(窗口内页面) ----
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0f1115',
        color: '#e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
        overflow: 'auto',
      }}
    >
      <div style={{ width: 600, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>我的课堂</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>C30 学生端</div>
        </div>
        <div style={{ fontSize: 13, color: '#8b95a5', marginBottom: 20 }}>
          已发现局域网内的课堂,点击加入;老师开始上课后自动进入画面
        </div>

        {status === 'connecting' ? (
          <div
            style={{
              padding: '36px 0',
              borderRadius: 14,
              background: '#171a21',
              border: '1px solid #262b36',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>正在接入课堂…</div>
            <div style={{ fontSize: 13, color: '#8b95a5' }}>{selectedRoom?.teacherName || ''}</div>
          </div>
        ) : rooms.length === 0 ? (
          <div
            style={{
              padding: '36px 0',
              borderRadius: 14,
              background: '#171a21',
              border: '1px solid #262b36',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>正在搜索课堂…</div>
            <div style={{ fontSize: 13, color: '#8b95a5' }}>
              {error || '请确认发送端已开启,并与本机处于同一局域网'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rooms.map((room) => (
              <button
                key={room.roomCode}
                onClick={() => joinRoom(room)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  border: '1px solid #262b36',
                  borderRadius: 12,
                  background: '#171a21',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                  transition: 'all .15s ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#3b82f6';
                  (e.currentTarget as HTMLButtonElement).style.background = '#1b2230';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#262b36';
                  (e.currentTarget as HTMLButtonElement).style.background = '#171a21';
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 17,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {room.teacherName.charAt(0) || '课'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{room.teacherName}的课堂</div>
                  <div style={{ fontSize: 13, color: '#8b95a5', marginTop: 2 }}>房间号 {room.roomCode}</div>
                </div>
                <div style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600 }}>进入</div>
              </button>
            ))}
          </div>
        )}

        {status === 'error' && (
          <button
            onClick={() => {
              setStatus('searching');
              setError('');
              setSelectedRoom(null);
            }}
            style={{
              width: '100%',
              padding: 11,
              marginTop: 16,
              border: 'none',
              borderRadius: 8,
              background: '#1e293b',
              color: '#60a5fa',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            返回重新选择
          </button>
        )}

        <div style={{ marginTop: 18, fontSize: 12, color: '#4b5563', textAlign: 'center' }}>
          同一局域网 · 无需登录 · 老师启动后自动发现
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: '#cbd5e1',
  cursor: 'pointer',
  outline: 'none',
};
