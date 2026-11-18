import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, SessionMember, ImageItem, InteractionControl, StageMode } from '@c30/shared';
import { countStudents } from '@c30/shared';
import { io, type Socket } from 'socket.io-client';
import FloatingDock, { TopStatusBar, BottomToolbar } from './FloatingDock';
import Whiteboard, { type WhiteboardHandle } from './Whiteboard';
import DesktopDrawLayer, { type DesktopDrawHandle } from './DesktopDrawLayer';
import SpotlightLayer, { type Rect } from './SpotlightLayer';
import type { PenConfig } from './PenPanel';
import { DEFAULT_ERASER_RADIUS } from './EraserPanel';
import useInteract from '../hooks/useInteract';
import useScreenShare from '../hooks/useScreenShare';
import usePointerPassthrough from '../hooks/usePointerPassthrough';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

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
  // 上课状态(null=未上课):老师点「上课」后置为开始时间并广播;
  // 服务端持久这份状态,学生端据此决定「等待页 / 跟随画面」。
  const [classStartedAt, setClassStartedAt] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // 供 socket 事件回调读取最新值(事件注册一次,不能闭包到旧的 active/上课状态)
  const classActiveRef = useRef(false);
  const stageModeRef = useRef<StageMode>('screen');
  // 已发布 mDNS 广播的 roomCode(去重,避免 StrictMode 双挂载/重连重复广播)
  const publishedCodeRef = useRef('');
  // 画笔设置(提升到此处,供底部工具栏与桌面绘制层共享)
  const [penConfig, setPenConfig] = useState<PenConfig>({
    penType: 'brush',
    color: '#e5484d',
    strokeWidth: 1,
  });
  // 板擦粗细(底部工具条「板擦」菜单调整,桌面批注层与白板共用)。
  // 擦除语义固定为「自由擦除」:涂到哪擦到哪,不再有清笔迹/区域擦除的选项。
  const [eraserRadius, setEraserRadius] = useState<number>(DEFAULT_ERASER_RADIUS);
  // 浮层缩放(提示条等也跟随屏幕尺寸)
  const uiScale = useOverlayScale();
  const drawLayerRef = useRef<DesktopDrawHandle>(null);
  // 白板操作句柄:白板模式下,底部工具条的撤销/重做/清空路由到白板内部
  const whiteboardRef = useRef<WhiteboardHandle>(null);

  // 聚焦保存后的轻提示(显示保存路径/失败原因,4s 自动消失)
  const [saveToast, setSaveToast] = useState('');
  // 待插入白板的底图(聚焦「插入白板」):白板挂载后由 effect 交给它本地追加
  const [pendingImage, setPendingImage] = useState<ImageItem | null>(null);

  // 教师端本地设置(开机自启/展示教室信息/允许互动),从主进程加载并持久化
  const [appSettings, setAppSettings] = useState({
    autoLaunch: false,
    showClassInfo: true,
    allowInteraction: true,
  });

  // 课堂互动控制(弹幕 + 允许互动总开关)。由 TeacherWorkspace 统一持有:
  // 设置面板、成员面板、白板、互动面板都读写同一份状态,不会出现两边各存一份、互相覆盖。
  const [interaction, setInteraction] = useState<InteractionControl>({
    danmakuEnabled: true,
    interactEnabled: true,
  });

  // 「互动」面板的数据源:状态来自内嵌服务端的 interact.state 快照
  const interact = useInteract(socket, roomCode);

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

  // 互动控制(弹幕开关 / 允许互动):写入本地状态并同步给课堂。
  // 服务端是控制项的真源,学生端收到 interaction.control 后才知道能不能发弹幕、能不能举手。
  const updateInteraction = useCallback(
    (patch: Partial<InteractionControl>) => {
      const next = { ...interaction, ...patch };
      setInteraction(next);
      // 成员面板里的「课堂互动」开关与设置里的「允许互动」是同一个总开关:
      // 在成员面板关掉时同步回设置,避免两处 UI 状态不一致。
      if (patch.interactEnabled !== undefined && patch.interactEnabled !== appSettings.allowInteraction) {
        updateSettings({ allowInteraction: patch.interactEnabled });
      }
      const s = socketRef.current;
      if (s && roomCode) s.emit('interaction.control', { roomCode, control: next });
    },
    [interaction, roomCode, appSettings.allowInteraction, updateSettings],
  );

  // 重连 / 其它端改动时恢复控制项
  useEffect(() => {
    if (!socket) return;
    const onControl = (d: { control: InteractionControl }) => setInteraction(d.control);
    socket.on('interaction.control', onControl);
    return () => {
      socket.off('interaction.control', onControl);
    };
  }, [socket]);

  // 设置面板的「允许互动」是总开关:变更时同步到课堂(学生端互动入口随之显示/隐藏)。
  // 依赖里带上 roomCode:课堂创建完成后再补发一次,避免课前改设置丢失。
  useEffect(() => {
    if (!roomCode) return;
    updateInteraction({ interactEnabled: appSettings.allowInteraction });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSettings.allowInteraction, roomCode]);

  // 聚焦保存提示:4s 后自动消失
  useEffect(() => {
    if (!saveToast) return;
    const t = setTimeout(() => setSaveToast(''), 4000);
    return () => clearTimeout(t);
  }, [saveToast]);

  // 白板挂载后,把「插入白板」的底图交给它本地追加(追加后清空 pending)
  useEffect(() => {
    if (!pendingImage || active !== 'whiteboard') return;
    whiteboardRef.current?.appendImage(pendingImage);
    setPendingImage(null);
  }, [pendingImage, active]);

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
        // 重连/HMR 后立即把当前舞台模式同步一次:否则服务端可能还停在旧模式,
        // 学生端会卡在「老师白板」而老师其实已经回到桌面。
        s.emit('stage.set', {
          roomCode: d.roomCode,
          stage: stageModeRef.current,
          board: { w: window.innerWidth, h: window.innerHeight },
        });
        // 去重:同一 roomCode 只广播一次 mDNS,避免 StrictMode/重连重复广播
        if (publishedCodeRef.current === d.roomCode) return;
        publishedCodeRef.current = d.roomCode;
        publishToLan(d.roomCode);
      });
      s.on('session.joined', (d: { roomCode: string; members: SessionMember[] }) => {
        setRoomCode(d.roomCode);
        setMembers(d.members);
        // create/join 之后服务端才建立 socket 索引,此时再同步一次舞台模式最稳
        s.emit('stage.set', {
          roomCode: d.roomCode,
          stage: stageModeRef.current,
          board: { w: window.innerWidth, h: window.innerHeight },
        });
      });
      s.on('session.memberJoin', (d: { member: SessionMember }) => {
        setMembers((prev) => (prev.some((m) => m.userId === d.member.userId) ? prev : [...prev, d.member]));
      });
      s.on('session.memberLeave', (d: { userId: string }) => {
        setMembers((prev) => prev.filter((m) => m.userId !== d.userId));
      });
      // 服务端广播的课堂状态:重连 / HMR 后恢复「正在上课」,也作为多端唯一真源
      s.on('class.state', (d: { active: boolean; startedAt: number | null }) => {
        setClassStartedAt(d.active ? d.startedAt : null);
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

  // 右上角「人数」只统计学生:教师本人是课堂创建者,不计入学生人数。
  // 否则一台学生机都没开时会显示 1,而会话/连接重建的瞬间又会显示 0(0/1 跳动)。
  // 口径与学生端完全一致(shared.countStudents),避免教师端 1 / 学生端 2 的错位。
  const studentCount = countStudents(members);

  // 舞台模式:老师在白板里 → 学生看白板;其余(桌面/PPT/批注)→ 学生看屏幕共享。
  const stageMode: StageMode = active === 'whiteboard' ? 'whiteboard' : 'screen';
  const classActive = classStartedAt != null;
  classActiveRef.current = classActive;
  stageModeRef.current = stageMode;

  // 屏幕共享:上课且处于「投屏」模式时采集主屏,给每个学生一路 WebRTC;
  // 切白板只暂停视频轨,切回投屏立刻恢复。
  useScreenShare({
    socket,
    roomCode,
    classActive,
    stage: stageMode,
    onError: (message) => setSaveToast(message),
  });

  // 课堂中老师切换白板/桌面时,把舞台模式同步给学生端
  useEffect(() => {
    if (!classActive || !socket || !roomCode) return;
    socket.emit('stage.set', {
      roomCode,
      stage: stageMode,
      board: { w: window.innerWidth, h: window.innerHeight },
    });
  }, [classActive, stageMode, socket, roomCode]);

  // 投屏时把老师光标也广播给学生(20Hz,叠加在 WebRTC 画面上)。
  // 光标坐标就是老师悬浮层窗口的逻辑坐标,和学生端 board 是同一套。
  useEffect(() => {
    if (!classActive || stageMode !== 'screen' || !socket || !roomCode) return;
    let last = 0;
    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      socket.emit('cursor.move', { x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [classActive, stageMode, socket, roomCode]);

  // 上课/下课:先本地乐观更新(计时立即开始/停止),再把状态发给内嵌课堂服务器;
  // 服务端统一广播给房间内所有端,学生端据此从「等待页」切到「跟随画面」或退回等待页。
  const toggleClass = useCallback(() => {
    const starting = classStartedAt == null;
    const startedAt = starting ? Date.now() : null;
    setClassStartedAt(startedAt);
    const s = socketRef.current;
    if (!s || !roomCode) return;
    if (starting) {
      s.emit('class.start', {
        roomCode,
        startedAt,
        stage: stageMode,
        board: { w: window.innerWidth, h: window.innerHeight },
      });
    } else {
      s.emit('class.end', { roomCode });
    }
  }, [classStartedAt, roomCode, stageMode]);

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
      {/* 白板全屏(唯一的功能界面) */}
      {active === 'whiteboard' && (
        <div data-interactive style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
          <Whiteboard
            ref={whiteboardRef}
            socket={socket}
            roomCode={roomCode}
            isTeacher
            activeTool={activeTool}
            penConfig={penConfig}
            eraserRadius={eraserRadius}
            onExit={() => setActive('')}
            interaction={interaction}
            onInteractionChange={updateInteraction}
          />
        </div>
      )}

      {/* 右侧竖条导航(组件内部 fixed,可左右贴边+上下拖动+折叠箭头) */}
      <FloatingDock
        role="TEACHER"
        active={active}
        onChange={(key) => setActive(key === 'desktop' ? '' : key)}
        classStartedAt={classStartedAt}
        onToggleClass={toggleClass}
        user={user}
        onLogout={onLogout}
        memberCount={studentCount}
        networkStatus="direct"
        settings={appSettings}
        onSettingsChange={updateSettings}
      />

      {/* 右上角信息面板(网络/班级/人数)。白板模式下隐藏,避免与右侧悬浮/成员角标重叠遮挡;
          设置项「展示教室信息」关闭时也隐藏 */}
      {active !== 'whiteboard' && appSettings.showClassInfo && (
        <div style={{ position: 'fixed', top: 12, right: 12, pointerEvents: 'auto' }}>
          <TopStatusBar networkStatus="direct" memberCount={studentCount} />
        </div>
      )}

      {/* 底部横条工具栏(组件内部 fixed 贴底边,可左右拖动+折叠;画笔模式浮出黑色画笔面板) */}
      <BottomToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        penConfig={penConfig}
        onPenConfigChange={setPenConfig}
        eraserRadius={eraserRadius}
        onEraserRadiusChange={setEraserRadius}
        onUndo={() =>
          active === 'whiteboard' ? whiteboardRef.current?.undo() : drawLayerRef.current?.undo()
        }
        onRedo={() =>
          active === 'whiteboard' ? whiteboardRef.current?.redo() : drawLayerRef.current?.redo()
        }
        onClear={() =>
          active === 'whiteboard' ? whiteboardRef.current?.clear() : drawLayerRef.current?.clear()
        }
        allowInteraction={appSettings.allowInteraction}
        members={members}
        studentCount={studentCount}
        interact={interact}
      />

      {/* 桌面批注层(常驻,切换工具不清空笔迹;由全局鼠标钩子驱动绘制/擦除)。
          白板模式下禁用(工具交给白板内部 pointer 事件,避免全局钩子与白板绘制冲突)。 */}
      <DesktopDrawLayer
        ref={drawLayerRef}
        config={penConfig}
        eraserRadius={eraserRadius}
        socket={socket}
        roomCode={roomCode}
        tool={active === 'whiteboard' ? null : activeTool === 'pen' ? 'pen' : activeTool === 'eraser' ? 'eraser' : null}
      />

      {/* 聚焦保存提示(底部居中,不拦截鼠标) */}
      {saveToast && (
        <div
          style={{
            position: 'fixed',
            bottom: scaled(110, uiScale),
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '70vw',
            padding: `${scaled(10, uiScale)}px ${scaled(18, uiScale)}px`,
            borderRadius: scaled(16, uiScale),
            background: 'rgba(27,27,31,0.95)',
            color: '#e5e7eb',
            fontSize: scaled(14, uiScale),
            lineHeight: 1.4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            zIndex: 95,
          }}
          title={saveToast}
        >
          {saveToast}
        </div>
      )}

      {/* 聚焦层(关灯遮罩 + 可调矩形框 + 放大/插入白板/保存) */}
      {activeTool === 'focus' && (
        <SpotlightLayer
          onClose={() => setActiveTool('select')}
          onCapture={(rect: Rect) =>
            (window as any).api?.spotlight?.capture(rect) ?? Promise.resolve(null)
          }
          onInsertToWhiteboard={async (rect: Rect) => {
            // 先退出聚焦层再截屏:聚焦层卸载后窗口上没有任何装饰,主进程无需隐藏/移动窗口
            // (隐藏或移出屏幕 + 真实点击的组合会让窗口丢失鼠标按下事件,浮层会点不动)。
            setActiveTool('select');
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
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
            // 关键:教师端是插入发起方,服务端只把 whiteboard.event 转发给「其他」客户端,
            // 所以这里必须自己本地插入一份,否则要等重新拉快照才能看到图片。
            setPendingImage(item);
            // 广播给接收端(学生端)
            if (socketRef.current && roomCode) {
              socketRef.current.emit('whiteboard.event', {
                roomCode,
                event: { type: 'image.append', payload: item },
              });
            }
          }}
          onSave={async (rect: Rect) => {
            const spotlightApi = (window as any).api?.spotlight;
            if (!spotlightApi) return;
            // 先退出聚焦层:卸载矩形选中框 + 恢复鼠标穿透,避免挡住后续操作
            setActiveTool('select');
            // 等两帧,确保聚焦层卸载、穿透状态同步到主进程后再截屏
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            // 注意:这里不用原生「另存为」对话框——Windows 上该原生模态窗口关闭后会让
            // 浮层丢失鼠标按下事件(整个浮层点不动,只能重启),故直接保存到固定目录。
            const res = await spotlightApi.saveQuick(rect);
            if (res?.ok) {
              setSaveToast(`已保存:${res.filePath}`);
            } else {
              setSaveToast(`保存失败:${res?.error ?? '未知错误'}`);
            }
          }}
        />
      )}
    </div>
  );
}

