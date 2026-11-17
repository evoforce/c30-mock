import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, SessionMember } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import DockNav from './DockNav';
import Whiteboard from './Whiteboard';

const SOCKET_URL = 'http://127.0.0.1:3000';

// 学生端主界面:类 Dock 左侧导航 + 右侧内容区
export default function StudentWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('session');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [joined, setJoined] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState('');
  const [members, setMembers] = useState<SessionMember[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const connectSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const s = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = s;
    setSocket(s);

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
    return s;
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
    if (active === 'session' || active === 'whiteboard') {
      if (!socketRef.current) connectSocket();
    }
  }, [active, connectSocket]);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <DockNav active={active} onChange={setActive} user={user} onLogout={onLogout} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            borderBottom: '1px solid #eef0f3',
            background: '#ffffff',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>
            {active === 'session' && '课堂'}
            {active === 'courseware' && '课件'}
            {active === 'whiteboard' && '白板'}
          </div>
          {joined && roomCode && (
            <span
              style={{
                fontSize: 12,
                color: '#16a34a',
                background: '#e8f7ee',
                padding: '3px 10px',
                borderRadius: 12,
                fontWeight: 600,
              }}
            >
              已加入课堂 {roomCode} · {members.length} 人在线
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          {active === 'session' && (
            !joined ? (
              <JoinPanel
                inputCode={inputCode}
                setInputCode={setInputCode}
                onJoin={joinSession}
                error={error}
              />
            ) : (
              <MemberPanel roomCode={roomCode} members={members} />
            )
          )}
          {active === 'whiteboard' && (
            joined ? (
              <Whiteboard socket={socket} roomCode={roomCode} isTeacher={false} />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f7f8fa',
                  color: '#9aa1ac',
                  fontSize: 14,
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div>请先在「课堂」中通过课堂码加入</div>
                <button
                  onClick={() => setActive('session')}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    borderRadius: 8,
                    background: '#2563eb',
                    color: '#fff',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  去加入课堂
                </button>
              </div>
            )
          )}
          {active === 'courseware' && (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f7f8fa',
                color: '#9aa1ac',
                fontSize: 14,
              }}
            >
              课件跟随即将上线
            </div>
          )}
        </div>
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
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f7f8fa',
      }}
    >
      <div
        style={{
          width: 360,
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #eef0f3',
          padding: 32,
          boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
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
    <div style={{ height: '100%', background: '#f7f8fa', padding: 24, overflow: 'auto' }}>
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #eef0f3',
          padding: 24,
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
    </div>
  );
}
