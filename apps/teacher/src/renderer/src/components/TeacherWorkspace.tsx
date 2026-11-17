import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, SessionMember } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import DockNav from './DockNav';
import ResourceLibrary from './ResourceLibrary';
import Whiteboard from './Whiteboard';

const SOCKET_URL = 'http://127.0.0.1:3000';

// 教师端主界面:类 Dock 左侧导航 + 右侧内容区
export default function TeacherWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('resource');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [members, setMembers] = useState<SessionMember[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // 建立 socket 连接(进入白板/课堂 tab 时)
  const connectSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const s = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = s;
    setSocket(s);

    s.on('session.created', (d: { roomCode: string }) => {
      setRoomCode(d.roomCode);
    });
    s.on('session.joined', (d: { roomCode: string; members: SessionMember[] }) => {
      setRoomCode(d.roomCode);
      setMembers(d.members);
    });
    s.on('session.memberJoin', (d: { member: SessionMember }) => {
      setMembers((prev) => (prev.some((m) => m.userId === d.member.userId) ? prev : [...prev, d.member]));
    });
    s.on('session.memberLeave', (d: { userId: string }) => {
      setMembers((prev) => prev.filter((m) => m.userId !== d.userId));
    });
    return s;
  }, []);

  // 教师创建课堂
  const createSession = useCallback(() => {
    const s = connectSocket();
    s.emit('session.create', { payload: { teacherId: user.id, teacherName: user.name } });
  }, [connectSocket, user]);

  // 进入白板 tab 时自动创建课堂
  useEffect(() => {
    if (active === 'whiteboard' || active === 'session') {
      if (!socketRef.current) {
        connectSocket();
      }
    }
  }, [active, connectSocket]);

  // 首次进入白板时若还没课堂则创建
  useEffect(() => {
    if (active === 'whiteboard' && socketRef.current && !roomCode) {
      createSession();
    }
  }, [active, roomCode, createSession]);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <DockNav active={active} onChange={setActive} user={user} onLogout={onLogout} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 顶部标题条 */}
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
            {active === 'resource' && '资源库'}
            {active === 'whiteboard' && '白板'}
            {active === 'session' && '课堂'}
          </div>
          {roomCode && (active === 'whiteboard' || active === 'session') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  color: '#2563eb',
                  background: '#eaf1ff',
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontWeight: 600,
                }}
              >
                课堂码 {roomCode}
              </span>
              <span style={{ fontSize: 12, color: '#9aa1ac' }}>{members.length} 人在线</span>
            </div>
          )}
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {active === 'resource' && <ResourceLibrary userId={user.id} />}
          {active === 'whiteboard' && (
            <Whiteboard socket={socket} roomCode={roomCode} isTeacher />
          )}
          {active === 'session' && (
            <SessionPanel roomCode={roomCode} members={members} />
          )}
        </div>
      </div>
    </div>
  );
}

// 课堂面板:展示课堂码和成员列表
function SessionPanel({
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
          课堂信息
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: '#7c8494' }}>课堂码</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 3,
              color: '#2563eb',
              background: '#eaf1ff',
              padding: '6px 20px',
              borderRadius: 10,
            }}
          >
            {roomCode || '—'}
          </div>
        </div>
        <div style={{ fontSize: 13, color: '#7c8494', marginBottom: 10 }}>
          在线成员({members.length})
        </div>
        {members.length === 0 ? (
          <div style={{ fontSize: 13, color: '#b6bcc6', padding: '16px 0', textAlign: 'center' }}>
            暂无成员,学生输入课堂码即可加入
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
