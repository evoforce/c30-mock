import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, SessionMember } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import FloatingDock, { TopStatusBar, BottomToolbar } from './FloatingDock';
import ResourceLibrary from './ResourceLibrary';
import Whiteboard from './Whiteboard';
import DesktopDrawLayer from './DesktopDrawLayer';

const SOCKET_URL = 'http://127.0.0.1:3000';

// 教师端主界面:类 Dock 左侧导航 + 右侧内容区
export default function TeacherWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('courseware');
  const [activeTool, setActiveTool] = useState('select');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [members, setMembers] = useState<SessionMember[]>([]);
  const socketRef = useRef<Socket | null>(null);
  // 内嵌课堂服务器端点(教师端自己也是局域网直连)
  const localEndpointRef = useRef<{ host: string; port: number } | null>(null);

  // 启动时获取内嵌服务器端点
  useEffect(() => {
    const sessionApi = (window as any).api?.session;
    sessionApi?.getLocalEndpoint?.().then((ep: { host: string; port: number } | null) => {
      if (ep?.port) localEndpointRef.current = ep;
    });
  }, []);

  // 广播课堂信息到局域网(mDNS),供学生端直连
  const publishToLan = useCallback(
    async (code: string) => {
      const sessionApi = (window as any).api?.session;
      if (!sessionApi) return;
      const endpoint = await sessionApi.getLocalEndpoint?.();
      if (!endpoint?.port) return; // 内嵌服务器未就绪,跳过(回退中心服务器)
      await sessionApi.publish?.({
        roomCode: code,
        teacherName: user.name,
        host: endpoint.host,
        port: endpoint.port,
      });
    },
    [user],
  );

  const bindEvents = useCallback(
    (s: Socket) => {
      s.on('session.created', (d: { roomCode: string }) => {
        setRoomCode(d.roomCode);
        publishToLan(d.roomCode);
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
    },
    [publishToLan],
  );

  // 建立 socket 连接(优先内嵌服务器,失败回退中心服务器)
  const connectSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;

    const endpoint = localEndpointRef.current;
    const targetUrl =
      endpoint && endpoint.port ? `http://127.0.0.1:${endpoint.port}` : SOCKET_URL;

    const s = io(targetUrl, { transports: ['websocket', 'polling'] });

    // 内嵌服务器连不上 → 回退中心服务器
    s.on('connect_error', () => {
      if (targetUrl !== SOCKET_URL && !s.connected) {
        console.log(`[conn] 内嵌服务器 ${targetUrl} 不可用,回退中心服务器`);
        socketRef.current = null;
        const fallback = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
        socketRef.current = fallback;
        setSocket(fallback);
        bindEvents(fallback);
      }
    });

    socketRef.current = s;
    setSocket(s);
    bindEvents(s);
    return s;
  }, [bindEvents]);

  // 教师创建课堂
  const createSession = useCallback(() => {
    const s = connectSocket();
    s.emit('session.create', { payload: { teacherId: user.id, teacherName: user.name } });
  }, [connectSocket, user]);

  // 进入白板 tab 时自动创建课堂
  useEffect(() => {
    if (active === 'whiteboard' || active === 'class') {
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
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      {/* 内容层:白板全屏透明铺满,课件/课堂作为悬浮面板 */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: active === 'whiteboard' ? 'auto' : 'none' }}>
        {active === 'whiteboard' && (
          <Whiteboard socket={socket} roomCode={roomCode} isTeacher />
        )}
      </div>

      {/* 课件/课堂等:居中悬浮面板 */}
      {active === 'courseware' && (
        <FloatingPanel title="课件" onClose={() => setActive('class')}>
          <ResourceLibrary userId={user.id} />
        </FloatingPanel>
      )}
      {active === 'class' && (
        <FloatingPanel title="上课" onClose={() => setActive('courseware')}>
          <SessionPanel roomCode={roomCode} members={members} />
        </FloatingPanel>
      )}
      {(active === 'textbook' || active === 'comment') && (
        <FloatingPanel title={active === 'textbook' ? '课本' : '讲评'} onClose={() => setActive('courseware')}>
          <Placeholder title={active === 'textbook' ? '课本' : '讲评'} />
        </FloatingPanel>
      )}

      {/* 右侧竖条导航(黑色悬浮) */}
      <div style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', pointerEvents: 'auto' }}>
        <FloatingDock
          role="TEACHER"
          active={active}
          onChange={setActive}
          user={user}
          onLogout={onLogout}
          memberCount={members.length}
          networkStatus="direct"
        />
      </div>

      {/* 右上角信息面板(网络/班级/人数) */}
      <div style={{ position: 'absolute', top: 12, right: 12, pointerEvents: 'auto' }}>
        <TopStatusBar networkStatus="direct" memberCount={members.length} />
      </div>

      {/* 底部横条工具栏(选择/画笔/板擦/互动/聚焦/更多) */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto', zIndex: 70 }}>
        <BottomToolbar activeTool={activeTool} onToolChange={setActiveTool} />
      </div>

      {/* 桌面绘制层(选中画笔时) */}
      {activeTool === 'pen' && (
        <DesktopDrawLayer onClose={() => setActiveTool('select')} />
      )}
    </div>
  );
}

// 居中悬浮面板(课件/课堂/课本等)
function FloatingPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 720,
        maxHeight: '80vh',
        background: '#ffffff',
        borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
        overflow: 'hidden',
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: '1px solid #eef0f3',
          background: '#ffffff',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: '#1f2937' }}>{title}</span>
        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            width: 28,
            height: 28,
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: '#9aa1ac',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </div>
  );
}

// 占位面板(课本/讲评等未实现模块)
function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa1ac', fontSize: 14 }}>
      {title}模块开发中
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
    <div style={{ padding: 24, overflow: 'auto' }}>
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
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
