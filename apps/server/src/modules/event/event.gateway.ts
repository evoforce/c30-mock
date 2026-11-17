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
} from '@c30/shared';

/**
 * 课堂 + 白板实时网关。
 * - 课堂房间:每个 roomCode 一个房间,教师创建、学生加入。
 * - 白板事件:教师端广播到房间内所有学生端(学生端只读)。
 * 成员与会话热数据存内存 + 可选 Redis(后续 M4 强化),Demo 用内存保证可测。
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class EventGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // roomCode -> 成员列表
  private rooms = new Map<string, SessionMember[]>();
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
    const members = this.rooms.get(roomCode);
    if (!members) return;

    const remaining = members.filter((m) => m.userId !== userId);
    if (remaining.length === 0) {
      this.rooms.delete(roomCode);
    } else {
      this.rooms.set(roomCode, remaining);
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
    this.rooms.set(roomCode, [member]);
    this.socketIndex.set(client.id, { roomCode, userId: teacherId });

    client.emit('session.created', { roomCode, sessionId: roomCode });
    client.emit('session.joined', { sessionId: roomCode, roomCode, members: [member] });
    return { ok: true, roomCode };
  }

  @SubscribeMessage('session.join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SessionClientEvent & { payload: { roomCode: string; userId: string; name: string } },
  ) {
    const { roomCode, userId, name } = body.payload;
    const members = this.rooms.get(roomCode);

    if (!members) {
      client.emit('session.error', { message: '课堂不存在或已结束' });
      return;
    }
    if (members.some((m) => m.userId === userId)) {
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
    members.push(member);
    this.rooms.set(roomCode, members);
    this.socketIndex.set(client.id, { roomCode, userId });

    // 告知新加入者当前成员列表
    client.emit('session.joined', { sessionId: roomCode, roomCode, members });
    // 广播给其他成员(含教师)
    client.to(roomCode).emit('session.memberJoin', { member });
    return { ok: true, roomCode, members };
  }

  // ---- 白板:教师端广播,转发给房间内其他端(学生) ----

  @SubscribeMessage('whiteboard.event')
  handleWhiteboard(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomCode: string; event: WhiteboardEvent },
  ) {
    const { roomCode, event } = body;
    // 转发给房间内除发送者外的所有端(学生端)
    client.to(roomCode).emit('whiteboard.event', event);
    return { ok: true };
  }

  // 拉取课堂当前成员列表(学生端进入白板前补状态)
  @SubscribeMessage('session.members')
  handleMembers(@ConnectedSocket() client: Socket, @MessageBody() body: { roomCode: string }) {
    const members = this.rooms.get(body.roomCode) ?? [];
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
