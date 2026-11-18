// 教师端内嵌课堂服务器(局域网直连方案)
// 作用:教师端 Electron 主进程内起一个 socket.io server,
// 学生端通过 mDNS 发现后直连此端口,实现"课堂局域网自治"。
// 协议与中心 NestJS EventGateway 保持一致(复用 shared 类型),
// 但只做内存状态,不做 DB 持久化(中心服务器仍可用于云同步/回放)。
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer as createHttpServer } from 'http';
import type { SessionMember, WhiteboardEvent, Stroke, ImageItem, InteractionControl, WhiteboardTheme } from '@c30/shared';

interface RoomState {
  members: SessionMember[];
  strokes: Stroke[];
  images: ImageItem[];
  theme: WhiteboardTheme;
  nextSeq: number;
  interaction: InteractionControl;
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

  function genRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (rooms.has(code)) return genRoomCode();
    return code;
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
          client.join(existingCode);
          socketIndex.set(client.id, { roomCode: existingCode, userId: teacherId });
          client.emit('session.created', { roomCode: existingCode, sessionId: existingCode });
          client.emit('session.joined', { sessionId: existingCode, roomCode: existingCode, members: room.members });
          client.emit('whiteboard.state', { roomCode: existingCode, strokes: room.strokes, images: room.images, theme: room.theme, nextSeq: room.nextSeq });
          client.emit('interaction.control', { roomCode: existingCode, control: room.interaction });
          console.log('[server] session.create 复用已有课堂', existingCode);
          return;
        }
        const roomCode = genRoomCode();
        const member: SessionMember = { userId: teacherId, name: teacherName, role: 'TEACHER', joinedAt: Date.now() };
        client.join(roomCode);
        rooms.set(roomCode, { members: [member], strokes: [], images: [], theme: 'white', nextSeq: 0, interaction: { danmakuEnabled: true, quizEnabled: true } });
        socketIndex.set(client.id, { roomCode, userId: teacherId });
        teacherRooms.set(teacherId, roomCode);

        client.emit('session.created', { roomCode, sessionId: roomCode });
        client.emit('session.joined', { sessionId: roomCode, roomCode, members: [member] });
        client.emit('whiteboard.state', { roomCode, strokes: [], images: [], theme: 'white', nextSeq: 0 });
        client.emit('interaction.control', { roomCode, control: { danmakuEnabled: true, quizEnabled: true } });
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
        client.emit('whiteboard.state', { roomCode, strokes: room.strokes, images: room.images, theme: room.theme, nextSeq: room.nextSeq });
        client.emit('interaction.control', { roomCode, control: room.interaction });
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
          room.images.push(event.payload);
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
          console.log('[server] theme.change ->', event.payload.theme, 'room.theme =', room.theme);
        }
        client.to(roomCode).emit('whiteboard.event', event);
      });

      client.on('whiteboard.state', (body: { roomCode: string }) => {
        const room = rooms.get(body.roomCode);
        if (!room) {
          client.emit('whiteboard.state', { roomCode: body.roomCode, strokes: [], images: [], theme: 'white', nextSeq: 0 });
          return;
        }
        client.emit('whiteboard.state', { roomCode: body.roomCode, strokes: room.strokes, images: room.images, theme: room.theme, nextSeq: room.nextSeq });
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

      client.on('interaction.control', (body: { roomCode: string; control: InteractionControl }) => {
        const room = rooms.get(body.roomCode);
        if (!room) return;
        room.interaction = { ...room.interaction, ...body.control };
        io!.to(body.roomCode).emit('interaction.control', { roomCode: body.roomCode, control: room.interaction });
      });

      client.on('disconnect', () => {
        const idx = socketIndex.get(client.id);
        if (!idx) return;
        socketIndex.delete(client.id);
        const room = rooms.get(idx.roomCode);
        if (!room) return;
        room.members = room.members.filter((m) => m.userId !== idx.userId);
        if (room.members.length > 0) {
          io!.to(idx.roomCode).emit('session.memberLeave', { userId: idx.userId });
        }
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
      await new Promise<void>((resolve) => io!.close(() => resolve()));
      io = null;
      httpServer = null;
      port = 0;
    }
  }

  return { start, stop, getPort: () => port };
}
