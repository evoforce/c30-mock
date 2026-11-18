// 教师端内嵌课堂服务器(局域网直连方案)
// 作用:教师端 Electron 主进程内起一个 socket.io server,
// 学生端通过 mDNS 发现后直连此端口,实现"课堂局域网自治"。
// 协议与中心 NestJS EventGateway 保持一致(复用 shared 类型),
// 但只做内存状态,不做 DB 持久化(中心服务器仍可用于云同步/回放)。
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer as createHttpServer } from 'http';
import type {
  SessionMember,
  WhiteboardEvent,
  Stroke,
  ImageItem,
  InteractionControl,
  WhiteboardTheme,
  ClassState,
  StageMode,
  InteractKind,
  InteractResponse,
  InteractSession,
  InteractSnapshot,
  InteractStartRequest,
  PickedStudent,
  RaisedHand,
} from '@c30/shared';

// 课堂互动的房间级状态(服务端是唯一真源)。
// 含义与协议见 packages/shared/src/interact.ts:
//   · session  = 当前(或刚结束)的一次互动,endedAt 非空表示已结束但结果仍留给老师讲评;
//   · responses= 本次互动的学生响应(投票/观点云/点名确认);
//   · hands    = 举手名单,独立于 session(随手举手,不受互动开始/结束影响);
//   · picked   = 随机点名结果;buzzOrder = 抢答顺序。
interface RoomInteract {
  session: InteractSession | null;
  responses: Map<string, InteractResponse>;
  hands: Map<string, RaisedHand>;
  picked: PickedStudent | null;
  buzzOrder: string[];
  /** 上一次点到的学生:再次点名时尽量换人 */
  lastPickedUserId: string | null;
  /** 限时互动的自动结束定时器 */
  endTimer: ReturnType<typeof setTimeout> | null;
}

interface RoomState {
  members: SessionMember[];
  strokes: Stroke[];
  images: ImageItem[];
  theme: WhiteboardTheme;
  nextSeq: number;
  interaction: InteractionControl;
  interact: RoomInteract;
  // 课堂直播状态:房间可以先建好(学生可提前进入),但只有老师「上课」后才 active。
  // 未上课时 whiteboard 事件只写内存、不广播;上课时先给学生补一份完整快照。
  class: ClassState;
  // 舞台:老师当前共享的是屏幕还是白板;board 是老师主显示器的逻辑尺寸,
  // 学生端按它做等比缩放(窗口大小不同也不会让笔迹错位)。
  stage: StageMode;
  board: { w: number; h: number } | null;
  /** 教师最后一次在线的时间(连接/断开都刷新):用于房间探活与遗留房间判定 */
  teacherLastSeenAt: number;
}

export interface LocalSessionServer {
  start(): Promise<number>; // 返回监听端口
  stop(): Promise<void>;
  getPort(): number;
}

export function createLocalSessionServer(): LocalSessionServer {
  let io: SocketIOServer | null = null;
  let httpServer: ReturnType<typeof createHttpServer> | null = null;
  let port = 0;

  const rooms = new Map<string, RoomState>();
  const socketIndex = new Map<string, { roomCode: string; userId: string }>();
  // teacherId → roomCode:让同一教师端重复 session.create(如 React StrictMode 双重挂载、
  // socket 重连)复用同一课堂,避免打印多次 mDNS 广播、创建多个空课堂。
  const teacherRooms = new Map<string, string>();
  // roomCode → 当前教师 socket.id:WebRTC 信令要把学生的 request 转发给老师,
  // 老师的 offer/answer/ICE 要按目标学生 socket.id 精确投递。
  const roomTeacherSocket = new Map<string, string>();

  function genRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (rooms.has(code)) return genRoomCode();
    return code;
  }

  // 教师成员常驻课堂。
  // 教师的 socket 断开/重连(React StrictMode 双挂载、热更新、网络抖动)只代表「连接」变化,
  // 不代表老师离开了课堂。若在 disconnect 里把教师从 members 删掉,重连走 session.create
  // 复用课堂时就会返回一份没有教师的成员列表,右上角人数会在 0/1 之间跳动。
  // 这里保证每个课堂始终有且仅有一条「当前教师」的成员记录,并在重连时刷新名字。
  function ensureTeacherMember(room: RoomState, teacherId: string, teacherName: string): void {
    const existing = room.members.find((m) => m.role === 'TEACHER' && m.userId === teacherId);
    if (existing) {
      existing.name = teacherName;
      return;
    }
    // 清理同名教师的旧条目(理论上不会出现),再补一条
    room.members = room.members.filter((m) => !(m.role === 'TEACHER' && m.userId === teacherId));
    room.members.unshift({ userId: teacherId, name: teacherName, role: 'TEACHER', joinedAt: Date.now() });
  }

  // 老师断线后的宽限期:热更新/重连通常 1s 内回来,这段时间内房间仍算「在线」,
  // 避免学生端探活把正在重连的课堂误判成死房间。
  const TEACHER_GRACE_MS = 10_000;

  // 老师是否在线:以当前教师 socket 为准,宽限期内也算在线。
  function teacherOnline(roomCode: string, room: RoomState): boolean {
    const sid = roomTeacherSocket.get(roomCode);
    if (sid && io?.sockets.sockets.get(sid)) return true;
    return Date.now() - room.teacherLastSeenAt < TEACHER_GRACE_MS;
  }

  // 同一台教师端(一个内嵌服务器)只服务一间课堂。
  // 教师端刷新/HMR 如果拿到新的 teacherId 会新建房间;旧房间必须收掉:
  // 否则它们既留在内存里、又能被学生从 mDNS 列表误点进来,表现为「列表里有 4 个王老师的课堂」。
  // 房间里如果还有学生,先发 session.error 让他们回到房间列表,再删房间。
  function closeOtherRooms(keepCode: string, reason: string): void {
    for (const code of [...rooms.keys()]) {
      if (code === keepCode) continue;
      const room = rooms.get(code);
      if (!room) continue;
      stopInteractTimer(room);
      io?.to(code).emit('session.error', { message: reason });
      io?.in(code).socketsLeave(code);
      rooms.delete(code);
      for (const [sid, idx] of socketIndex) if (idx.roomCode === code) socketIndex.delete(sid);
      for (const [tid, c] of teacherRooms) if (c === code) teacherRooms.delete(tid);
      roomTeacherSocket.delete(code);
    }
  }

  // 课堂直播状态载荷(教师端 / 学生端共用同一份,避免两端口径不一致)
  function classStateOf(roomCode: string, room: RoomState) {
    return { roomCode, active: room.class.active, startedAt: room.class.startedAt };
  }

  // 白板完整快照(上课时补发给学生,或学生进入正在上课的课堂时拉取)
  function whiteboardStateOf(roomCode: string, room: RoomState) {
    return { roomCode, strokes: room.strokes, images: room.images, theme: room.theme, nextSeq: room.nextSeq };
  }

  // 舞台状态(屏幕/白板 + 虚拟画布尺寸)
  function stageStateOf(roomCode: string, room: RoomState) {
    return { roomCode, mode: room.stage, board: room.board };
  }

  // 学生端 RTC 信令的目标必须是同一房间里的 socket(避免信令被转发到别的课堂)
  function sameRoomSocket(targetId: string, roomCode: string): boolean {
    const target = io?.sockets.sockets.get(targetId);
    return !!target && target.rooms.has(roomCode);
  }

  // 判定某个 socket 是否是本课堂的教师(只有教师能上课/下课)
  function isRoomTeacher(client: Socket, room: RoomState): boolean {
    const idx = socketIndex.get(client.id);
    if (!idx) return false;
    return room.members.some((m) => m.role === 'TEACHER' && m.userId === idx.userId);
  }

  // ---- 课堂互动(随机点名 / 抢答 / 举手 / 投票 / 观点云 / 计时) ----

  const INTERACT_KINDS: InteractKind[] = ['rollcall', 'buzz', 'poll', 'cloud', 'timer'];

  function newInteractState(): RoomInteract {
    return {
      session: null,
      responses: new Map(),
      hands: new Map(),
      picked: null,
      buzzOrder: [],
      lastPickedUserId: null,
      endTimer: null,
    };
  }

  // 互动快照:每次变化都整份广播,学生迟进 / 重连都能一次对齐(无增量状态机)
  function interactStateOf(roomCode: string, room: RoomState): InteractSnapshot {
    return {
      roomCode,
      enabled: room.interaction.interactEnabled,
      session: room.interact.session,
      responses: [...room.interact.responses.values()],
      hands: [...room.interact.hands.values()].sort((a, b) => a.ts - b.ts),
      picked: room.interact.picked,
      buzzOrder: [...room.interact.buzzOrder],
    };
  }

  function emitInteract(roomCode: string, room: RoomState): void {
    io?.to(roomCode).emit('interact.state', interactStateOf(roomCode, room));
  }

  function stopInteractTimer(room: RoomState): void {
    if (room.interact.endTimer) {
      clearTimeout(room.interact.endTimer);
      room.interact.endTimer = null;
    }
  }

  // 清空互动(下课 / 关闭总开关 / 老师点「关闭」用)。
  // keepHands=true 时保留举手名单(老师只是结束一次投票,不该顺手把举手也清掉)。
  function clearInteract(room: RoomState, keepHands = false): void {
    stopInteractTimer(room);
    room.interact.session = null;
    room.interact.responses.clear();
    room.interact.picked = null;
    room.interact.buzzOrder = [];
    room.interact.lastPickedUserId = null;
    if (!keepHands) room.interact.hands.clear();
  }

  // 限时互动到点自动结束:广播一次 endedAt,双方 UI 统一显示「已结束」。
  // 定时器回调里校验 session 是否还是同一个,避免被下一次互动顶掉后误伤。
  function scheduleInteractEnd(roomCode: string, room: RoomState): void {
    stopInteractTimer(room);
    const session = room.interact.session;
    if (!session || session.endsAt == null) return;
    const sessionId = session.id;
    const endsAt = session.endsAt;
    const delay = Math.max(0, endsAt - Date.now());
    room.interact.endTimer = setTimeout(() => {
      const current = room.interact.session;
      if (!current || current.id !== sessionId || current.endedAt != null) return;
      current.endedAt = endsAt;
      room.interact.endTimer = null;
      emitInteract(roomCode, room);
    }, delay);
  }

  // 从在线学生里随机抽一个;有多人时尽量避开上一次点到的人
  function pickRandomStudent(room: RoomState): PickedStudent | null {
    const students = room.members.filter((m) => m.role === 'STUDENT');
    if (students.length === 0) return null;
    const exclude = room.interact.lastPickedUserId;
    const pool =
      students.length > 1 && exclude ? students.filter((s) => s.userId !== exclude) : students;
    const target = pool[Math.floor(Math.random() * pool.length)] ?? students[0];
    return { userId: target.userId, name: target.name, ts: Date.now() };
  }

  function interactError(client: Socket, message: string): void {
    client.emit('interact.error', { message });
  }

  // 学生 socket 对应的课堂成员(教师返回 null:教师不能以学生身份响应互动)
  function studentOf(client: Socket, room: RoomState): SessionMember | null {
    const idx = socketIndex.get(client.id);
    if (!idx) return null;
    const member = room.members.find((m) => m.userId === idx.userId);
    return member?.role === 'STUDENT' ? member : null;
  }

  async function start(): Promise<number> {
    if (io) return port;

    httpServer = createHttpServer();
    io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

    io.on('connection', (client: Socket) => {
      client.on('session.create', (body: { payload: { teacherId: string; teacherName: string } }) => {
        const { teacherId, teacherName } = body.payload;
        // 幂等:同一教师端重复 create(StrictMode/重连)时复用已有课堂
        const existingCode = teacherRooms.get(teacherId);
        if (existingCode && rooms.has(existingCode)) {
          const room = rooms.get(existingCode)!;
          // 重连/重复 create 时补齐教师成员(旧逻辑在 disconnect 里删掉过,必须补回)
          ensureTeacherMember(room, teacherId, teacherName);
          room.teacherLastSeenAt = Date.now();
          client.join(existingCode);
          socketIndex.set(client.id, { roomCode: existingCode, userId: teacherId });
          roomTeacherSocket.set(existingCode, client.id);
          // 同进程里如果还堆着旧 teacherId 创建的遗留房间,趁这次重连一并收掉
          closeOtherRooms(existingCode, '课堂已重建,请重新加入');
          client.emit('session.created', { roomCode: existingCode, sessionId: existingCode });
          client.emit('session.joined', { sessionId: existingCode, roomCode: existingCode, members: room.members });
          // 教师端重连 / HMR 后恢复「正在上课」状态,避免计时和课堂状态归零
          client.emit('class.state', classStateOf(existingCode, room));
          client.emit('stage.state', stageStateOf(existingCode, room));
          client.emit('whiteboard.state', whiteboardStateOf(existingCode, room));
          client.emit('interaction.control', { roomCode: existingCode, control: room.interaction });
          client.emit('interact.state', interactStateOf(existingCode, room));
          // 老师重连后,让学生端重新发起 WebRTC 请求(旧 PeerConnection 已随老师进程消失)
          io?.to(existingCode).emit('stage.state', stageStateOf(existingCode, room));
          return;
        }
        const roomCode = genRoomCode();
        client.join(roomCode);
        rooms.set(roomCode, {
          members: [],
          strokes: [],
          images: [],
          theme: 'white',
          nextSeq: 0,
          interaction: { danmakuEnabled: true, interactEnabled: true },
          interact: newInteractState(),
          // 新建课堂默认「未上课」:学生可以先进教室等待,老师点「上课」后才开始推送画面
          class: { active: false, startedAt: null },
          stage: 'screen',
          board: null,
          teacherLastSeenAt: Date.now(),
        });
        const room = rooms.get(roomCode)!;
        ensureTeacherMember(room, teacherId, teacherName);
        socketIndex.set(client.id, { roomCode, userId: teacherId });
        teacherRooms.set(teacherId, roomCode);
        roomTeacherSocket.set(roomCode, client.id);
        // 新课堂建立后,旧课堂(同一教师端上一次运行的遗留)直接关闭
        closeOtherRooms(roomCode, '课堂已重建,请重新加入');

        client.emit('session.created', { roomCode, sessionId: roomCode });
        client.emit('session.joined', { sessionId: roomCode, roomCode, members: room.members });
        client.emit('class.state', classStateOf(roomCode, room));
        client.emit('stage.state', stageStateOf(roomCode, room));
        client.emit('whiteboard.state', whiteboardStateOf(roomCode, room));
        client.emit('interaction.control', { roomCode, control: room.interaction });
        client.emit('interact.state', interactStateOf(roomCode, room));
      });

      // 房间探活:学生端 mDNS 列表可能留着已关闭/已重建的旧房间。
      // 学生端拿到列表后连一次服务端,问「这些 roomCode 里哪些还有老师在线」,
      // 服务端按 teacherLastSeenAt 判定,只回 live 的;不在 live 里的从列表剔除。
      client.on('discovery.probe', (body: { roomCodes?: string[] }) => {
        const codes = Array.isArray(body?.roomCodes) ? body.roomCodes.slice(0, 50) : [];
        const live = codes.filter((code) => {
          const room = rooms.get(code);
          return !!room && teacherOnline(code, room);
        });
        client.emit('discovery.probe.result', { live });
      });

      client.on('session.join', (body: { payload: { roomCode: string; userId: string; name: string } }) => {
        const { roomCode, userId, name } = body.payload;
        const room = rooms.get(roomCode);
        if (!room) {
          client.emit('session.error', { message: '课堂不存在或已结束' });
          return;
        }
        if (room.members.some((m) => m.userId === userId)) {
          client.emit('session.error', { message: '你已在该课堂中' });
          return;
        }
        const member: SessionMember = { userId, name, role: 'STUDENT', joinedAt: Date.now() };
        client.join(roomCode);
        room.members.push(member);
        socketIndex.set(client.id, { roomCode, userId });

        client.emit('session.joined', { sessionId: roomCode, roomCode, members: room.members });
        // 先告诉学生「现在有没有在上课」:未上课 → 学生端停在等待页;上课中 → 立刻给完整画面快照
        client.emit('class.state', classStateOf(roomCode, room));
        client.emit('stage.state', stageStateOf(roomCode, room));
        if (room.class.active) {
          client.emit('whiteboard.state', whiteboardStateOf(roomCode, room));
        }
        client.emit('interaction.control', { roomCode, control: room.interaction });
        // 迟进课堂的学生立刻拿到当前互动快照(正在投票/抢答时不会「错过」)
        client.emit('interact.state', interactStateOf(roomCode, room));
        client.to(roomCode).emit('session.memberJoin', { member });
      });

      client.on('whiteboard.event', (body: { roomCode: string; event: WhiteboardEvent }) => {
        const { roomCode, event } = body;
        const room = rooms.get(roomCode);
        if (!room) return;
        if (event.type === 'stroke.append') {
          event.payload.seq = ++room.nextSeq;
          room.strokes.push(event.payload);
        } else if (event.type === 'stroke.remove') {
          const ids = new Set(event.payload.strokeIds);
          room.strokes = room.strokes.filter((s) => !ids.has(s.id));
        } else if (event.type === 'image.append') {
          event.payload.seq = ++room.nextSeq;
          // 幂等:同一 id 重复 append(例如「置顶」= remove + append)时原位覆盖,避免出现重复图片
          const idx = room.images.findIndex((im) => im.id === event.payload.id);
          if (idx >= 0) room.images[idx] = event.payload;
          else room.images.push(event.payload);
        } else if (event.type === 'image.update') {
          // 移动 / 缩放:按 id 覆盖,不改变叠放次序
          const idx = room.images.findIndex((im) => im.id === event.payload.id);
          if (idx >= 0) room.images[idx] = { ...event.payload, seq: room.images[idx].seq };
        } else if (event.type === 'image.remove') {
          const ids = new Set(event.payload.imageIds);
          room.images = room.images.filter((im) => !ids.has(im.id));
        } else if (event.type === 'undo') {
          const { removedStrokeIds, restoredStrokes } = event.payload;
          if (removedStrokeIds.length > 0) {
            const ids = new Set(removedStrokeIds);
            room.strokes = room.strokes.filter((s) => !ids.has(s.id));
          }
          if (restoredStrokes.length > 0) {
            const existing = new Set(room.strokes.map((s) => s.id));
            for (const s of restoredStrokes) if (!existing.has(s.id)) room.strokes.push(s);
          }
        } else if (event.type === 'stroke.clear') {
          room.strokes = [];
        } else if (event.type === 'theme.change') {
          room.theme = event.payload.theme;
        }
        // 未上课:事件只落到服务端内存(老师课前准备的板书不会提前投给学生),
        // 上课时再用完整快照一次性补发;上课中:照常实时广播。
        if (room.class.active) {
          client.to(roomCode).emit('whiteboard.event', event);
        }
      });

      // 上课:进入直播状态 → 通知房间 + 给学生补发当前白板完整快照(含课前准备的板书)
      client.on(
        'class.start',
        (body: {
          roomCode: string;
          startedAt?: number;
          board?: { w: number; h: number };
          stage?: StageMode;
        }) => {
          const room = rooms.get(body.roomCode);
          if (!room || !isRoomTeacher(client, room)) return;
          if (!room.class.active) {
            room.class.active = true;
            room.class.startedAt =
              typeof body.startedAt === 'number' && body.startedAt > 0 ? body.startedAt : Date.now();
          }
          if (body.board && body.board.w > 0 && body.board.h > 0) room.board = body.board;
          if (body.stage === 'screen' || body.stage === 'whiteboard') room.stage = body.stage;
          io!.to(body.roomCode).emit('class.state', classStateOf(body.roomCode, room));
          io!.to(body.roomCode).emit('stage.state', stageStateOf(body.roomCode, room));
          client.to(body.roomCode).emit('whiteboard.state', whiteboardStateOf(body.roomCode, room));
        },
      );

      // 老师切换「投屏 / 白板」:只广播舞台模式,不改变上课状态
      client.on('stage.set', (body: { roomCode: string; stage: StageMode; board?: { w: number; h: number } }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !isRoomTeacher(client, room)) return;
        if (body.stage !== 'screen' && body.stage !== 'whiteboard') return;
        room.stage = body.stage;
        if (body.board && body.board.w > 0 && body.board.h > 0) room.board = body.board;
        io!.to(body.roomCode).emit('stage.state', stageStateOf(body.roomCode, room));
      });

      // 老师光标(屏幕共享时):20Hz 左右,学生端叠在视频上,不烧进低帧率画面
      client.on('cursor.move', (body: { x: number; y: number }) => {
        const idx = socketIndex.get(client.id);
        if (!idx) return;
        const room = rooms.get(idx.roomCode);
        if (!room?.class.active || room.stage !== 'screen') return;
        if (!isRoomTeacher(client, room)) return;
        if (typeof body?.x !== 'number' || typeof body?.y !== 'number') return;
        client.to(idx.roomCode).emit('cursor.move', { x: body.x, y: body.y });
      });

      // 下课:停止推送 → 学生端退回等待页;白板内容保留,再次上课可直接继续
      client.on('class.end', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !isRoomTeacher(client, room)) return;
        room.class.active = false;
        room.class.startedAt = null;
        // 下课后互动与举手一并收走:学生端着陆在等待页,不该还挂着上课时的投票/举手
        clearInteract(room);
        io!.to(body.roomCode).emit('class.state', classStateOf(body.roomCode, room));
        // 同时通知两端关闭 WebRTC(老师端也会主动关,双保险)
        io!.to(body.roomCode).emit('rtc.stop');
        emitInteract(body.roomCode, room);
      });

      client.on('whiteboard.state', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        // 未上课且不是教师本人:不回白板内容(学生端此时停在等待页,不该看到课前板书)
        if (!room || (!room.class.active && !isRoomTeacher(client, room))) {
          client.emit('whiteboard.state', { roomCode: body.roomCode, strokes: [], images: [], theme: 'white', nextSeq: 0 });
          return;
        }
        client.emit('whiteboard.state', whiteboardStateOf(body.roomCode, room));
      });

      // ---- WebRTC 信令 ----
      // 服务端不解析 SDP/ICE,只按 socket.id 精确转发;所有信令都要求课堂处于上课状态。
      // 学生 → 老师:请求一路屏幕流
      client.on('rtc.request', () => {
        const idx = socketIndex.get(client.id);
        if (!idx) return;
        const room = rooms.get(idx.roomCode);
        if (!room?.class.active || !studentOf(client, room)) return;
        const teacherSocket = roomTeacherSocket.get(idx.roomCode);
        if (!teacherSocket) return;
        io!.to(teacherSocket).emit('rtc.request', { roomCode: idx.roomCode, from: client.id });
      });

      // 老师 → 学生:offer
      client.on('rtc.offer', (body: { to: string; sdp: unknown }) => {
        const idx = socketIndex.get(client.id);
        if (!idx) return;
        const room = rooms.get(idx.roomCode);
        if (!room?.class.active || !isRoomTeacher(client, room)) return;
        const to = String(body?.to ?? '');
        if (!to || !sameRoomSocket(to, idx.roomCode)) return;
        io!.to(to).emit('rtc.offer', { roomCode: idx.roomCode, from: client.id, sdp: body.sdp });
      });

      // 学生 → 老师:answer
      client.on('rtc.answer', (body: { to: string; sdp: unknown }) => {
        const idx = socketIndex.get(client.id);
        if (!idx) return;
        const room = rooms.get(idx.roomCode);
        if (!room?.class.active) return;
        const to = String(body?.to ?? '');
        if (!to || !sameRoomSocket(to, idx.roomCode)) return;
        io!.to(to).emit('rtc.answer', { roomCode: idx.roomCode, from: client.id, sdp: body.sdp });
      });

      // 双向 ICE
      client.on('rtc.ice', (body: { to: string; candidate: unknown }) => {
        const idx = socketIndex.get(client.id);
        if (!idx) return;
        const room = rooms.get(idx.roomCode);
        if (!room?.class.active) return;
        const to = String(body?.to ?? '');
        if (!to || !sameRoomSocket(to, idx.roomCode)) return;
        io!.to(to).emit('rtc.ice', { roomCode: idx.roomCode, from: client.id, candidate: body.candidate });
      });

      client.on('session.members', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        client.emit('session.members', { roomCode: body.roomCode, members: room?.members ?? [] });
      });

      client.on('danmaku.send', (body: { roomCode: string; content: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !room.interaction.danmakuEnabled) return;
        const idx = socketIndex.get(client.id);
        const member = room.members.find((m) => m.userId === idx?.userId);
        io!.to(body.roomCode).emit('danmaku.push', {
          id: crypto.randomUUID(),
          userId: idx?.userId ?? 'unknown',
          name: member?.name ?? '匿名',
          content: body.content,
          ts: Date.now(),
        });
      });

      // ---- 课堂互动 ----
      // 老师发起互动:教师端只说「想做什么」,由服务端补 id、时间戳、随机点名结果,
      // 保证每个学生看到的 session / 倒计时完全一致。
      client.on('interact.start', (body: { roomCode: string; request: InteractStartRequest }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !isRoomTeacher(client, room)) return;
        if (!room.interaction.interactEnabled) {
          interactError(client, '「允许互动」已关闭,请先在设置里打开');
          return;
        }
        if (!room.class.active) {
          interactError(client, '请先点「上课」再发起互动');
          return;
        }
        const req = body.request ?? ({} as InteractStartRequest);
        const kind = INTERACT_KINDS.find((k) => k === req.kind) ?? null;
        if (!kind) return;

        const now = Date.now();
        const durationSec =
          typeof req.durationSec === 'number' && req.durationSec > 0
            ? Math.min(3600, Math.round(req.durationSec))
            : null;
        const question = (req.question ?? '').trim().slice(0, 120);
        const rawOptions = (req.options ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 6);

        if (kind === 'poll' && (!question || rawOptions.length < 2)) {
          interactError(client, '投票至少需要 1 道题和 2 个选项');
          return;
        }
        if (kind === 'cloud' && !question) {
          interactError(client, '请先填写观点云的话题');
          return;
        }

        const pick = kind === 'rollcall' ? pickRandomStudent(room) : null;
        if (kind === 'rollcall' && !pick) {
          interactError(client, '当前没有在线学生,无法随机点名');
          return;
        }

        const session: InteractSession = {
          id: crypto.randomUUID(),
          kind,
          question:
            question || (kind === 'buzz' ? '抢答' : kind === 'timer' ? '课堂计时' : ''),
          options:
            kind === 'poll'
              ? rawOptions.map((label, i) => ({ id: `o${i + 1}`, label: label.slice(0, 40) }))
              : [],
          startedAt: now,
          endsAt: durationSec ? now + durationSec * 1000 : null,
          endedAt: null,
        };

        stopInteractTimer(room);
        room.interact.session = session;
        room.interact.responses.clear();
        room.interact.buzzOrder = [];
        // 举手名单独立保留;只有点名会把「上一次点到的人」换成新抽中的人
        if (pick) {
          room.interact.picked = pick;
          room.interact.lastPickedUserId = pick.userId;
        } else {
          room.interact.picked = null;
        }
        scheduleInteractEnd(body.roomCode, room);
        emitInteract(body.roomCode, room);
      });

      // 学生响应(投票 / 观点云文本 / 点名确认 / 抢答)
      client.on(
        'interact.respond',
        (body: { roomCode: string; sessionId: string; optionIds?: string[]; text?: string }) => {
          const room = rooms.get(body.roomCode);
          if (!room) return;
          const member = studentOf(client, room);
          if (!member) return;
          const session = room.interact.session;
          if (!session || session.id !== body.sessionId || session.endedAt != null) return;
          const now = Date.now();
          if (session.endsAt != null && now >= session.endsAt) return;

          const base: InteractResponse = {
            userId: member.userId,
            name: member.name,
            optionIds: [],
            text: '',
            ts: now,
          };

          if (session.kind === 'poll') {
            // 单选:只接受 session 里存在的选项 id;重复提交 = 改票
            const optionIds = (body.optionIds ?? [])
              .filter((id) => session.options.some((o) => o.id === id))
              .slice(0, 1);
            if (optionIds.length === 0) return;
            room.interact.responses.set(member.userId, { ...base, optionIds });
          } else if (session.kind === 'cloud') {
            const text = (body.text ?? '').trim().slice(0, 30);
            if (!text) return;
            room.interact.responses.set(member.userId, { ...base, text });
          } else if (session.kind === 'rollcall') {
            if (room.interact.picked?.userId !== member.userId) return;
            room.interact.responses.set(member.userId, { ...base, text: 'ack' });
          } else if (session.kind === 'buzz') {
            // 抢答只认第一次:之后重复点击不改名次
            if (room.interact.buzzOrder.includes(member.userId)) return;
            room.interact.buzzOrder.push(member.userId);
            room.interact.responses.set(member.userId, base);
          } else {
            return;
          }
          emitInteract(body.roomCode, room);
        },
      );

      // 举手 / 放下手(课上随时可用,不受当前互动影响)
      client.on('interact.hand', (body: { roomCode: string; raised: boolean }) => {
        const room = rooms.get(body.roomCode);
        if (!room) return;
        const member = studentOf(client, room);
        if (!member || !room.class.active || !room.interaction.interactEnabled) return;
        if (body.raised) {
          room.interact.hands.set(member.userId, { userId: member.userId, name: member.name, ts: Date.now() });
        } else {
          room.interact.hands.delete(member.userId);
        }
        emitInteract(body.roomCode, room);
      });

      // 学生端互动面板挂载时主动拉一次:学生可能在互动进行中才进入课堂
      // (session.join 时服务端推过快照,但那时 React 还没挂载监听器,必须补一次)。
      client.on('interact.sync', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room) return;
        client.emit('interact.state', interactStateOf(body.roomCode, room));
      });

      // 老师结束互动:session 保留(endedAt 落章),结果留给课堂讲评
      client.on('interact.end', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !isRoomTeacher(client, room)) return;
        const session = room.interact.session;
        if (!session || session.endedAt != null) return;
        session.endedAt = Date.now();
        stopInteractTimer(room);
        emitInteract(body.roomCode, room);
      });

      // 老师关闭互动结果(清空 session;举手名单保留)
      client.on('interact.reset', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !isRoomTeacher(client, room)) return;
        clearInteract(room, true);
        emitInteract(body.roomCode, room);
      });

      // 随机点名「换一个」
      client.on('interact.pick', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !isRoomTeacher(client, room)) return;
        const session = room.interact.session;
        if (!session || session.kind !== 'rollcall' || session.endedAt != null) return;
        const pick = pickRandomStudent(room);
        if (!pick) {
          interactError(client, '当前没有在线学生');
          return;
        }
        room.interact.picked = pick;
        room.interact.lastPickedUserId = pick.userId;
        room.interact.responses.clear();
        emitInteract(body.roomCode, room);
      });

      // 老师一键放下所有举手
      client.on('interact.hands.clear', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room || !isRoomTeacher(client, room)) return;
        room.interact.hands.clear();
        emitInteract(body.roomCode, room);
      });

      client.on('interaction.control', (body: { roomCode: string; control: InteractionControl }) => {
        const room = rooms.get(body.roomCode);
        if (!room) return;
        room.interaction = { ...room.interaction, ...body.control };
        // 关掉「允许互动」= 立刻收回进行中的互动与举手,学生端入口同步消失
        if (!room.interaction.interactEnabled) clearInteract(room);
        io!.to(body.roomCode).emit('interaction.control', { roomCode: body.roomCode, control: room.interaction });
        emitInteract(body.roomCode, room);
      });

      client.on('disconnect', () => {
        const idx = socketIndex.get(client.id);
        if (!idx) return;
        socketIndex.delete(client.id);
        const room = rooms.get(idx.roomCode);
        if (!room) return;
        const member = room.members.find((m) => m.userId === idx.userId);
        // 教师断开连接 ≠ 下课:保留 TEACHER 成员,等它重连复用课堂。
        // (只有学生断开才从成员列表移除并广播 memberLeave)
        if (member?.role === 'TEACHER') {
          room.teacherLastSeenAt = Date.now();
          if (roomTeacherSocket.get(idx.roomCode) === client.id) roomTeacherSocket.delete(idx.roomCode);
          // 老师进程退出:让学生收起视频,避免停在最后一帧
          io!.to(idx.roomCode).emit('rtc.stop');
          return;
        }
        room.members = room.members.filter((m) => m.userId !== idx.userId);
        // 学生掉线:举手名单里也不该继续挂着
        room.interact.hands.delete(idx.userId);
        // 告诉老师关掉这个学生的 PeerConnection
        const teacherSocket = roomTeacherSocket.get(idx.roomCode);
        if (teacherSocket) io!.to(teacherSocket).emit('rtc.peer-left', { peerId: client.id });
        io!.to(idx.roomCode).emit('session.memberLeave', { userId: idx.userId });
        emitInteract(idx.roomCode, room);
      });
    });

    // 监听 0 号端口,由 OS 分配可用端口(绑定所有网卡,供局域网直连)
    await new Promise<void>((resolve) => {
      httpServer!.listen(0, '0.0.0.0', () => {
        const addr = httpServer!.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    return port;
  }

  async function stop(): Promise<void> {
    if (io) {
      // 停服时清掉所有房间的限时互动定时器,避免进程退出后回调还挂着
      for (const room of rooms.values()) stopInteractTimer(room);
      await new Promise<void>((resolve) => io!.close(() => resolve()));
      io = null;
      httpServer = null;
      port = 0;
    }
  }

  return { start, stop, getPort: () => port };
}
