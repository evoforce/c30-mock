import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, SessionMember } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import FloatingDock, { TopStatusBar, BottomToolbar } from './FloatingDock';
import Whiteboard from './Whiteboard';
import DesktopDrawLayer, { type DesktopDrawHandle } from './DesktopDrawLayer';
import SpotlightLayer, { type Rect } from './SpotlightLayer';
import type { PenConfig } from './PenPanel';
import usePointerPassthrough from '../hooks/usePointerPassthrough';

// 发送端(教师端)主界面:免登录,启动即连接内嵌课堂服务器并创建课堂,悬浮组件散落桌面。
export default function TeacherWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('');
  const [activeTool, setActiveTool] = useState('select');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [members, setMembers] = useState<SessionMember[]>([]);
  const socketRef = useRef<Socket | null>(null);
  // 已发布 mDNS 广播的 roomCode(去重,避免 StrictMode 双挂载/重连重复广播)
  const publishedCodeRef = useRef('');
  // 画笔设置(提升到此处,供底部工具栏与桌面绘制层共享)
  const [penConfig, setPenConfig] = useState<PenConfig>({
    penType: 'brush',
    color: '#e5484d',
    strokeWidth: 1,
  });
  const drawLayerRef = useRef<DesktopDrawHandle>(null);

  // 教师端本地设置(开机自启/展示教室信息/允许互动),从主进程加载并持久化
  const [appSettings, setAppSettings] = useState({
    autoLaunch: false,
    showClassInfo: true,
    allowInteraction: true,
  });

  const updateSettings = useCallback(
    (patch: Partial<typeof appSettings>) => {
      setAppSettings((prev) => ({ ...prev, ...patch }));
      (window as any).api?.settings?.set?.(patch);
    },
    [],
  );

  // 启动加载设置
  useEffect(() => {
    (window as any).api?.settings?.get?.().then((s: typeof appSettings | undefined) => {
      if (s) setAppSettings(s);
    });
  }, []);

  // 鼠标穿透:白板全屏或聚焦模式时锁定捕获;其余(选择/画笔/板擦/互动等工具)
  // 均保持穿透——画笔/板擦批注由主进程全局鼠标钩子驱动,不锁定窗口,
  // 因而画批注时仍可操作桌面/浏览器/PPT,画面不冻结(C30 式体验)。
  usePointerPassthrough(active === 'whiteboard' || activeTool === 'focus');

  // 白板进入/退出时同步主进程窗口层级:白板需全白盖住任务栏(screen-saver 层级),
  // 退出时降回 floating(普通悬浮层)。进入白板默认切「画笔」,切走时复位为「选择」。
  useEffect(() => {
    const isWhiteboard = active === 'whiteboard';
    (window as any).api?.whiteboard?.setFullscreen(isWhiteboard);
    if (isWhiteboard) {
      setActiveTool('pen');
    } else {
      setActiveTool('select');
    }
  }, [active]);

  // 广播课堂信息到局域网(mDNS),供学生端直连
  const publishToLan = useCallback(
    async (code: string) => {
      const sessionApi = (window as any).api?.session;
      if (!sessionApi) return;
      const endpoint = await sessionApi.getLocalEndpoint?.();
      if (!endpoint?.port) return; // 内嵌服务器未就绪,跳过
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
        // 去重:同一 roomCode 只广播一次 mDNS,避免 StrictMode/重连重复广播
        if (publishedCodeRef.current === d.roomCode) return;
        publishedCodeRef.current = d.roomCode;
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

  // 启动即:获取内嵌服务器端点 → 连接 → 创建课堂 → mDNS 广播
  useEffect(() => {
    const sessionApi = (window as any).api?.session;
    if (!sessionApi) return;

    let socket: Socket | null = null;
    let cancelled = false;

    sessionApi.getLocalEndpoint?.().then((ep: { host: string; port: number } | null) => {
      if (cancelled || !ep?.port) return;
      const url = `http://127.0.0.1:${ep.port}`;
      const s = io(url, { transports: ['websocket', 'polling'] });
      socket = s;
      socketRef.current = s;
      setSocket(s);
      bindEvents(s);
      // 连接成功后创建课堂(服务器端幂等,重复 create 复用同一课堂)
      s.on('connect', () => {
        s.emit('session.create', { payload: { teacherId: user.id, teacherName: user.name } });
      });
    });

    // cleanup:StrictMode 双挂载/卸载时断开旧 socket,避免残留连接
    return () => {
      cancelled = true;
      if (socket) {
        socket.disconnect();
        if (socketRef.current === socket) socketRef.current = null;
      }
    };
  }, [bindEvents, user]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      {/* 白板全屏(唯一的功能界面) */}
      {active === 'whiteboard' && (
        <div data-interactive style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
          <Whiteboard socket={socket} roomCode={roomCode} isTeacher activeTool={activeTool} penConfig={penConfig} onExit={() => setActive('')} />
        </div>
      )}

      {/* 右侧竖条导航(组件内部 fixed,可左右贴边+上下拖动+折叠箭头) */}
      <FloatingDock
        role="TEACHER"
        active={active}
        onChange={(key) => setActive(key === 'desktop' ? '' : key)}
        user={user}
        onLogout={onLogout}
        memberCount={members.filter((m) => m.role === 'STUDENT').length}
        networkStatus="direct"
        settings={appSettings}
        onSettingsChange={updateSettings}
      />

      {/* 右上角信息面板(网络/班级/人数)。白板模式下隐藏,避免与右侧悬浮/成员角标重叠遮挡;
          设置项「展示教室信息」关闭时也隐藏 */}
      {active !== 'whiteboard' && appSettings.showClassInfo && (
        <div style={{ position: 'fixed', top: 12, right: 12, pointerEvents: 'auto' }}>
          <TopStatusBar networkStatus="direct" memberCount={members.length} />
        </div>
      )}

      {/* 底部横条工具栏(组件内部 fixed 贴底边,可左右拖动+折叠;画笔模式浮出黑色画笔面板) */}
      <BottomToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        penConfig={penConfig}
        onPenConfigChange={setPenConfig}
        onUndo={() => drawLayerRef.current?.undo()}
        onRedo={() => drawLayerRef.current?.redo()}
        onClear={() => drawLayerRef.current?.clear()}
        onComplete={() => setActiveTool('select')}
        allowInteraction={appSettings.allowInteraction}
      />

      {/* 桌面批注层(常驻,切换工具不清空笔迹;由全局鼠标钩子驱动绘制/擦除)。
          白板模式下禁用(工具交给白板内部 pointer 事件,避免全局钩子与白板绘制冲突)。 */}
      <DesktopDrawLayer
        ref={drawLayerRef}
        config={penConfig}
        socket={socket}
        roomCode={roomCode}
        tool={active === 'whiteboard' ? null : activeTool === 'pen' ? 'pen' : activeTool === 'eraser' ? 'eraser' : null}
      />

      {/* 聚焦层(关灯遮罩 + 可调矩形框 + 放大/插入白板/保存) */}
      {activeTool === 'focus' && (
        <SpotlightLayer
          onClose={() => setActiveTool('select')}
          onCapture={(rect: Rect, opts?: { hideWindow?: boolean }) =>
            (window as any).api?.spotlight?.capture(rect, opts) ?? Promise.resolve(null)
          }
          onInsertToWhiteboard={async (rect: Rect) => {
            // 截屏 → 切到白板 → 广播 image.append 插入图片
            const spotlightApi = (window as any).api?.spotlight;
            if (!spotlightApi) return;
            const dataUrl = await spotlightApi.capture(rect);
            if (!dataUrl) return;
            // 图片默认放在白板可视区偏左上方(按矩形宽高等比)
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const item = {
              id: crypto.randomUUID(),
              src: dataUrl,
              x: Math.max(0, (vw - rect.w) / 2),
              y: Math.max(0, (vh - rect.h) / 2),
              w: rect.w,
              h: rect.h,
              seq: 0,
            };
            setActive('whiteboard');
            setActiveTool('select');
            // 切到白板后,若 socket 已就绪则广播 image.append(教师端也会经广播收到)
            if (socketRef.current && roomCode) {
              socketRef.current.emit('whiteboard.event', {
                roomCode,
                event: { type: 'image.append', payload: item },
              });
            }
          }}
          onSave={async (rect: Rect) => {
            const spotlightApi = (window as any).api?.spotlight;
            const res = await spotlightApi?.save(rect);
            // 保存完成后关闭聚焦层(回到选择工具)
            setActiveTool('select');
            if (res && !res.ok && !res.canceled) {
              console.warn('[spotlight] 保存失败:', res.error);
            }
          }}
        />
      )}
    </div>
  );
}

