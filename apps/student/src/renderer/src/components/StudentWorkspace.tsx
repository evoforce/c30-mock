import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionMember, User } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import FloatingDock, { TopStatusBar } from './FloatingDock';
import Whiteboard from './Whiteboard';
import usePointerPassthrough from '../hooks/usePointerPassthrough';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

// 房间信息(来自 mDNS 发现)
interface RoomInfo {
  roomCode: string;
  teacherName: string;
  host: string;
  port: number;
}

// 接收端(学生端)极简模式:无登录,启动即搜索局域网课堂 → 选择进入 → 跟随接收发送端画面。
export default function StudentWorkspace() {
  // 浮层缩放:选择课堂面板等按屏幕尺寸等比放大
  const uiScale = useOverlayScale();
  const spx = (n: number) => scaled(n, uiScale);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<RoomInfo | null>(null);
  const [status, setStatus] = useState<'searching' | 'connecting' | 'joined' | 'error'>('searching');
  const [error, setError] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const identityRef = useRef<User | null>(null);

  // 鼠标穿透:接收端跟随画面(进入后)时锁定全屏,其余场景穿透桌面
  usePointerPassthrough(status === 'joined');

  // 生成匿名学生身份
  useEffect(() => {
    const id = `student-${Math.random().toString(36).slice(2, 10)}`;
    identityRef.current = { id, username: id, name: '学生', role: 'STUDENT' };
  }, []);

  const bindEvents = useCallback((s: Socket) => {
    s.on('session.joined', (d: { roomCode: string; members: SessionMember[] }) => {
      setRoomCode(d.roomCode);
      setMembers(d.members);
      setJoined(true);
      setStatus('joined');
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
    s.on('session.error', (d: { message: string }) => {
      setError(d.message);
      setStatus('error');
      setJoined(false);
    });
  }, []);

  // 直连指定房间(纯局域网,无中继)
  const joinRoom = useCallback(
    (room: RoomInfo) => {
      if (socketRef.current) socketRef.current.disconnect();
      setSelectedRoom(room);
      setStatus('connecting');
      setError('');

      const url = `http://${room.host}:${room.port}`;
      const s = io(url, { transports: ['websocket', 'polling'] });

      s.on('connect', () => {
        const identity = identityRef.current;
        if (identity) {
          s.emit('session.join', {
            payload: { roomCode: room.roomCode, userId: identity.id, name: identity.name },
          });
        }
      });

      s.on('connect_error', () => {
        setStatus('error');
        setError('无法连接到该课堂,请确认发送端在线且网络可达');
      });

      socketRef.current = s;
      setSocket(s);
      bindEvents(s);
    },
    [bindEvents],
  );

  // 订阅局域网发现 → 收集房间列表
  useEffect(() => {
    const api = (window as any).api?.discovery;
    if (!api) return;

    // 拉取已发现的房间
    api.getRooms?.().then((list: RoomInfo[]) => {
      if (list && list.length > 0) setRooms(list);
    });

    // 订阅后续发现(去重合并)
    const off = api.onFound?.((info: RoomInfo) => {
      setRooms((prev) => (prev.some((r) => r.roomCode === info.roomCode) ? prev : [...prev, info]));
    });
    return off;
  }, []);

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
  }, []);

  // 已加入 → 全屏跟随画面
  if (joined) {
    return (
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        <div data-interactive style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
          <Whiteboard socket={socket} roomCode={roomCode} isTeacher={false} />
        </div>
        <FloatingDock
          role="STUDENT"
          active="whiteboard"
          onChange={() => {}}
          user={identityRef.current ?? { id: '', username: '', name: '学生', role: 'STUDENT' }}
          onLogout={leave}
          memberCount={members.length}
          networkStatus="direct"
        />
        <div style={{ position: 'fixed', top: 12, right: 12, pointerEvents: 'auto' }}>
          <TopStatusBar networkStatus="direct" memberCount={members.length} />
        </div>
      </div>
    );
  }

  // 未加入 → 房间选择界面(居中悬浮面板)
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      <div
        data-interactive
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          pointerEvents: 'auto',
          width: spx(480),
          maxWidth: 'calc(100vw - 32px)',
          background: '#ffffff',
          borderRadius: spx(16),
          boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
          padding: `${spx(28)}px ${spx(28)}px`,
          color: '#1f2937',
        }}
      >
        <div style={{ fontSize: spx(20), fontWeight: 700, marginBottom: spx(4) }}>选择课堂</div>
        <div style={{ fontSize: spx(14), color: '#9aa1ac', marginBottom: spx(20) }}>
          已发现局域网内的课堂,点击进入即可跟随画面
        </div>

        {status === 'connecting' ? (
          <div style={{ padding: `${spx(32)}px 0`, textAlign: 'center', color: '#6b7280' }}>
            <div style={{ fontSize: spx(16), fontWeight: 600, color: '#1f2937', marginBottom: spx(8) }}>正在接入课堂…</div>
            <div style={{ fontSize: spx(14), color: '#9aa1ac' }}>{selectedRoom?.teacherName || ''}</div>
          </div>
        ) : rooms.length === 0 ? (
          <div style={{ padding: `${spx(32)}px 0`, textAlign: 'center', color: '#9aa1ac' }}>
            <div style={{ fontSize: spx(16), fontWeight: 600, color: '#1f2937', marginBottom: spx(8) }}>正在搜索课堂…</div>
            <div style={{ fontSize: spx(14) }}>
              {error || '请确认发送端已开启,并与本机处于同一局域网'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spx(10) }}>
            {rooms.map((room) => (
              <button
                key={room.roomCode}
                onClick={() => joinRoom(room)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: spx(12),
                  padding: `${spx(14)}px ${spx(16)}px`,
                  border: '1px solid #e5e7eb',
                  borderRadius: spx(12),
                  background: '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  outline: 'none',
                  transition: 'all .15s ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#2563eb';
                  (e.currentTarget as HTMLButtonElement).style.background = '#f5f8ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb';
                  (e.currentTarget as HTMLButtonElement).style.background = '#fff';
                }}
              >
                <div
                  style={{
                    width: spx(44),
                    height: spx(44),
                    borderRadius: '50%',
                    background: '#2563eb',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: spx(17),
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {room.teacherName.charAt(0) || '课'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: spx(16), fontWeight: 600 }}>{room.teacherName}的课堂</div>
                  <div style={{ fontSize: spx(13), color: '#9aa1ac', marginTop: spx(2) }}>房间号 {room.roomCode}</div>
                </div>
                <div style={{ fontSize: spx(13), color: '#2563eb', fontWeight: 600 }}>进入</div>
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
              padding: spx(11),
              marginTop: spx(16),
              border: 'none',
              borderRadius: spx(8),
              background: '#eef2ff',
              color: '#2563eb',
              fontSize: spx(15),
              cursor: 'pointer',
            }}
          >
            返回重新选择
          </button>
        )}
      </div>
    </div>
  );
}
