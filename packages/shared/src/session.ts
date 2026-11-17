// 课堂会话

export interface Session {
  id: string;
  teacherId: string;
  roomCode: string;
  status: 'ACTIVE' | 'ENDED';
  createdAt: string;
}

export interface SessionStudent {
  sessionId: string;
  studentId: string;
  joinedAt: string;
}

// 课堂内学生信息(用于成员列表展示)
export interface SessionMember {
  userId: string;
  name: string;
  role: 'TEACHER' | 'STUDENT';
  joinedAt: number;
}

// ---- WebSocket 课堂事件(客户端 → 服务端) ----
export type SessionClientEvent =
  | { type: 'session.create'; payload: { teacherId: string; teacherName: string } }
  | { type: 'session.join'; payload: { roomCode: string; userId: string; name: string } }
  | { type: 'session.leave'; payload: {} };

// ---- WebSocket 课堂事件(服务端 → 客户端) ----
export type SessionServerEvent =
  | { type: 'session.created'; payload: { roomCode: string; sessionId: string } }
  | { type: 'session.joined'; payload: { sessionId: string; roomCode: string; members: SessionMember[] } }
  | { type: 'session.memberJoin'; payload: { member: SessionMember } }
  | { type: 'session.memberLeave'; payload: { userId: string } }
  | { type: 'session.error'; payload: { message: string } };
