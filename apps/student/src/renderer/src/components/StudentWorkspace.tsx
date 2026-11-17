import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, SessionMember } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import FloatingDock, { TopStatusBar } from './FloatingDock';
import Whiteboard from './Whiteboard';

const SOCKET_URL = 'http://127.0.0.1:3000';

interface TeacherEndpoint {
  roomCode: string;
  teacherName: string;
  host: string;
  port: number;
}

// 学生端主界面:类 Dock 左侧导航 + 右侧内容区
export default function StudentWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('class');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [joined, setJoined] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState('');
  const [members, setMembers] = useState<SessionMember[]>([]);
  const socketRef = useRef<Socket | null>(null);
  // 局域网发现的教师端(双轨连接:优先直连,回退中心服务器)
  const teacherEndpointRef = useRef<TeacherEndpoint | null>(null);
  const [connMode, setConnMode] = useState<'direct' | 'relay' | ''>('');

  // 订阅局域网发现结果(主进程 mDNS → IPC → renderer)
  useEffect(() => {
    const api = (window as any).api?.discovery;
    if (!api) return;
    // 拉取已发现的结果
    api.getTeacher?.().then((info: TeacherEndpoint | null) => {
      if (info) teacherEndpointRef.current = info;
    });
    // 订阅后续发现
    const off = api.onFound?.((info: TeacherEndpoint) => {
      teacherEndpointRef.current = info;
    });
    return off;
  }, []);

  const connectSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;

    // 双轨:优先直连教师端内嵌 server,失败回退中心服务器
    const endpoint = teacherEndpointRef.current;
    const targetUrl =
      endpoint && endpoint.host && endpoint.port
        ? `http://${endpoint.host}:${endpoint.port}`
        : SOCKET_URL;

    const s = io(targetUrl, { transports: ['websocket', 'polling'] });

    // 若直连失败且还有回退余地,自动切换中心服务器
    s.on('connect_error', () => {
      if (targetUrl !== SOCKET_URL && !s.connected) {
        console.log(`[conn] 直连 ${targetUrl} 失败,回退中心服务器`);
        socketRef.current = null;
        setConnMode('relay');
        const fallback = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
        socketRef.current = fallback;
        setSocket(fallback);
        bindEvents(fallback);
      }
    });

    socketRef.current = s;
    setSocket(s);
    setConnMode(targetUrl === SOCKET_URL ? 'relay' : 'direct');
    bindEvents(s);
    return s;
  }, []);

  // 统一事件绑定
  const bindEvents = useCallback((s: Socket) => {
    s.on('session.joined', (d: { roomCode: string; members: SessionMember[] }) => {
      setRoomCode(d.roomCode);
      setMembers(d.members);
      setJoined(true);
      setError('');
    });
    s.on('session.memberJoin', (d: { member: SessionMember }) => {
      setMembers((prev) => (prev.some((m) => m.userId === d.member.userId) ? prev : [...prev, d.member]));
    });
    s.on('session.memberLeave', (d: { userId: string }) => {
      setMembers((prev) => prev.filter((m) => m.userId !== d.userId));
    });
    s.on('session.error', (d: { message: string }) => {
      setError(d.message);
      setJoined(false);
    });
  }, []);

  const joinSession = useCallback(() => {
    const code = inputCode.trim().toUpperCase();
    if (!code) {
      setError('请输入课堂码');
      return;
    }
    const s = connectSocket();
    s.emit('session.join', {
      payload: { roomCode: code, userId: user.id, name: user.name },
    });
  }, [inputCode, connectSocket, user]);

  // 进入课堂/白板 tab 时确保 socket 连接
  useEffect(() => {
    if (active === 'class' || active === 'whiteboard') {
      if (!socketRef.current) connectSocket();
    }
  }, [active, connectSocket]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      {/* 白板全屏透明(跟随教师) */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: active === 'whiteboard' ? 'auto' : 'none' }}>
        {active === 'whiteboard' && (
          joined ? (
            <Whiteboard socket={socket} roomCode={roomCode} isTeacher={false} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: 'rgba(255,255,255,0.9)', padding: '24px 32px', borderRadius: 12, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                请先通过「上课」加入课堂
              </div>
            </div>
          )
        )}
      </div>

      {/* 课堂(加入/成员)居中悬浮面板 */}
      {active === 'class' && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'auto' }}>
          {!joined ? (
            <JoinPanel inputCode={inputCode} setInputCode={setInputCode} onJoin={joinSession} error={error} />
          ) : (
            <MemberPanel roomCode={roomCode} members={members} />
          )}
        </div>
      )}

      {/* 课件悬浮面板 */}
      {active === 'courseware' && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'auto',
            background: '#fff',
            borderRadius: 14,
            padding: '32px 40px',
            boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
            color: '#9aa1ac',
            fontSize: 14,
          }}
        >
          课件跟随即将上线
        </div>
      )}

      {/* 右侧竖条导航 */}
      <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', pointerEvents: 'auto' }}>
        <FloatingDock
          role="STUDENT"
          active={active}
          onChange={setActive}
          user={user}
          onLogout={onLogout}
          memberCount={members.length}
          networkStatus={connMode}
        />
      </div>

      {/* 右上角信息面板 */}
      <div style={{ position: 'absolute', top: 12, right: 12, pointerEvents: 'auto' }}>
        <TopStatusBar networkStatus={connMode} memberCount={members.length} />
      </div>
    </div>
  );
}

function JoinPanel({
  inputCode,
  setInputCode,
  onJoin,
  error,
}: {
  inputCode: string;
  setInputCode: (v: string) => void;
  onJoin: () => void;
  error: string;
}) {
  return (
    <div
      style={{
        width: 360,
        background: '#fff',
        borderRadius: 14,
        border: '1px solid #eef0f3',
        padding: 32,
        boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
      }}
    >
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2937', marginBottom: 6 }}>
          加入课堂
        </div>
        <div style={{ fontSize: 13, color: '#9aa1ac', marginBottom: 20 }}>
          输入教师提供的课堂码,即可进入课堂
        </div>
        <input
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onJoin()}
          placeholder="请输入 6 位课堂码"
          maxLength={6}
          style={{
            width: '100%',
            padding: '12px 14px',
            border: '1.5px solid #d5d9e0',
            borderRadius: 8,
            fontSize: 16,
            letterSpacing: 2,
            textTransform: 'uppercase',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <div style={{ fontSize: 12, color: '#e5484d', marginTop: 8 }}>{error}</div>
        )}
        <button
          onClick={onJoin}
          style={{
            width: '100%',
            marginTop: 20,
            padding: '12px',
            border: 'none',
            borderRadius: 8,
            background: '#2563eb',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          加入
        </button>
    </div>
  );
}

function MemberPanel({
  roomCode,
  members,
}: {
  roomCode: string;
  members: SessionMember[];
}) {
  return (
    <div
      style={{
        width: 420,
        maxHeight: '70vh',
        overflow: 'auto',
        background: '#fff',
        borderRadius: 14,
        border: '1px solid #eef0f3',
        padding: 24,
        boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
      }}
    >
        <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937', marginBottom: 16 }}>
          课堂 {roomCode}
        </div>
        <div style={{ fontSize: 13, color: '#7c8494', marginBottom: 10 }}>
          在线成员({members.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map((m) => (
            <div
              key={m.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: '#f8f9fb',
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: m.role === 'TEACHER' ? '#2563eb' : '#16a34a',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {m.name.charAt(0)}
              </div>
              <span style={{ fontSize: 13, color: '#1f2937' }}>{m.name}</span>
              <span
                style={{
                  fontSize: 11,
                  color: m.role === 'TEACHER' ? '#2563eb' : '#16a34a',
                  background: m.role === 'TEACHER' ? '#eaf1ff' : '#e8f7ee',
                  padding: '2px 8px',
                  borderRadius: 8,
                }}
              >
                {m.role === 'TEACHER' ? '教师' : '学生'}
              </span>
            </div>
          ))}
        </div>
    </div>
  );
}
