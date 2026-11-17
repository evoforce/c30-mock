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
