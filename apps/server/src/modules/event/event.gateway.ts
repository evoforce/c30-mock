import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type {
  SessionMember,
  SessionClientEvent,
  WhiteboardEvent,
  Stroke,
} from '@c30/shared';

// 房间的完整状态
interface RoomState {
  members: SessionMember[];
  strokes: Stroke[];   // 白板笔画(全量,持久到课堂结束)
  nextSeq: number;     // 全局递增序列号
}

/**
 * 课堂 + 白板实时网关。
 * - 课堂房间:每个 roomCode 一个房间,教师创建、学生加入。
 * - 白板事件:教师端广播,服务端同时持久化笔画状态,
 *   保证"切回课堂"或"后加入的学生"能拉到全量历史。
 * 成员与会话热数据存内存(后续 M4 强化为 Redis),Demo 用内存保证可测。
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class EventGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // roomCode -> 房间完整状态
  private rooms = new Map<string, RoomState>();
  // socketId -> { roomCode, userId }
  private socketIndex = new Map<string, { roomCode: string; userId: string }>();

  handleConnection() {
    // 连接时不做鉴权(Demo),房间级隔离已足够
  }

  handleDisconnect(client: Socket) {
    const idx = this.socketIndex.get(client.id);
    if (!idx) return;
    this.socketIndex.delete(client.id);

    const { roomCode, userId } = idx;
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.members = room.members.filter((m) => m.userId !== userId);
    if (room.members.length === 0) {
      // 房间无人:保留房间状态一段时间,避免课堂"短暂全员断开"丢笔画。
      // Demo 简化:仅当是唯一教师离开时才清理;这里保留房间(不删除),
      // 由房间创建者显式结束课堂时清理。
      this.rooms.set(roomCode, room);
    } else {
      this.server.to(roomCode).emit('session.memberLeave', { userId });
    }
  }

  // ---- 课堂 ----

  @SubscribeMessage('session.create')
  handleCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SessionClientEvent & { payload: { teacherId: string; teacherName: string } },
  ) {
    const { teacherId, teacherName } = body.payload;
    const roomCode = this.genRoomCode();
    const member: SessionMember = {
      userId: teacherId,
      name: teacherName,
      role: 'TEACHER',
      joinedAt: Date.now(),
    };

    client.join(roomCode);
    this.rooms.set(roomCode, {
      members: [member],
      strokes: [],
      nextSeq: 0,
    });
    this.socketIndex.set(client.id, { roomCode, userId: teacherId });

    client.emit('session.created', { roomCode, sessionId: roomCode });
    client.emit('session.joined', { sessionId: roomCode, roomCode, members: [member] });
    // 返回初始空快照
    client.emit('whiteboard.state', { roomCode, strokes: [], nextSeq: 0 });
    return { ok: true, roomCode };
  }

  @SubscribeMessage('session.join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SessionClientEvent & { payload: { roomCode: string; userId: string; name: string } },
  ) {
    const { roomCode, userId, name } = body.payload;
    const room = this.rooms.get(roomCode);

    if (!room) {
      client.emit('session.error', { message: '课堂不存在或已结束' });
      return;
    }
    if (room.members.some((m) => m.userId === userId)) {
      client.emit('session.error', { message: '你已在该课堂中' });
      return;
    }

    const member: SessionMember = {
      userId,
      name,
      role: 'STUDENT',
      joinedAt: Date.now(),
    };

    client.join(roomCode);
    room.members.push(member);
    this.socketIndex.set(client.id, { roomCode, userId });

    // 告知新加入者当前成员列表
    client.emit('session.joined', { sessionId: roomCode, roomCode, members: room.members });
    // 后加入的学生先拉全量笔画快照,再订阅增量(修复"看不到历史笔迹")
    client.emit('whiteboard.state', {
      roomCode,
      strokes: room.strokes,
      nextSeq: room.nextSeq,
    });
    // 广播给其他成员(含教师)
    client.to(roomCode).emit('session.memberJoin', { member });
    return { ok: true, roomCode, members: room.members };
  }

  // ---- 白板:教师端广播,服务端持久化状态后转发 ----

  @SubscribeMessage('whiteboard.event')
  handleWhiteboard(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomCode: string; event: WhiteboardEvent },
  ) {
    const { roomCode, event } = body;
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false };

    // 服务端同步维护笔画状态(权威状态源)
    if (event.type === 'stroke.append') {
      const stroke = event.payload;
      // 服务端重分配 seq,保证全局有序且不重复
      stroke.seq = ++room.nextSeq;
      room.strokes.push(stroke);
    } else if (event.type === 'stroke.remove') {
      const ids = new Set(event.payload.strokeIds);
      room.strokes = room.strokes.filter((s) => !ids.has(s.id));
    } else if (event.type === 'stroke.clear') {
      room.strokes = [];
    }

    // 转发给房间内除发送者外的所有端(学生端)
    client.to(roomCode).emit('whiteboard.event', event);
    return { ok: true };
  }

  // 拉取白板全量快照(切回课堂 / 重连时补状态)
  @SubscribeMessage('whiteboard.state')
  handleWhiteboardState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomCode: string },
  ) {
    const room = this.rooms.get(body.roomCode);
    if (!room) {
      client.emit('whiteboard.state', { roomCode: body.roomCode, strokes: [], nextSeq: 0 });
      return;
    }
    client.emit('whiteboard.state', {
      roomCode: body.roomCode,
      strokes: room.strokes,
      nextSeq: room.nextSeq,
    });
    return { ok: true };
  }

  // 拉取课堂当前成员列表(学生端进入白板前补状态)
  @SubscribeMessage('session.members')
  handleMembers(@ConnectedSocket() client: Socket, @MessageBody() body: { roomCode: string }) {
    const room = this.rooms.get(body.roomCode);
    const members = room?.members ?? [];
    client.emit('session.members', { roomCode: body.roomCode, members });
    return { ok: true, members };
  }

  private genRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    // 避免撞码
    if (this.rooms.has(code)) return this.genRoomCode();
    return code;
  }
}
