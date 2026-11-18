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

/**
 * 课堂「人数」的统一口径:**在线学生数(不含教师)**。
 *
 * 教师端右上角「班级 N 人」与学生端顶栏/等待页必须用同一个数,否则会出现
 * 教师端 1、学生端 2 的错位(2 = 学生 + 老师)。教师本人不占班级人数,
 * 成员列表(MemberOverlay)仍然显示全部成员,两者语义不同。
 */
export function countStudents(members: SessionMember[]): number {
  return members.filter((m) => m.role === 'STUDENT').length;
}

// 课堂直播状态。
// 「房间」与「上课」是两个生命周期:房间建好学生就能进,但只有老师点「上课」后
// 才进入 active(学生端开始跟随教师画面);下课回到 inactive,学生留在房间等待。
export interface ClassState {
  active: boolean;
  /** 本节课开始时间戳(ms);未上课时为 null */
  startedAt: number | null;
}

// 舞台模式:
//   · screen     —— 老师共享屏幕(PPT/桌面),学生端主舞台;
//   · whiteboard —— 老师白板(白底 + 笔迹),不传屏幕帧。
export type StageMode = 'screen' | 'whiteboard';

// 舞台状态。board 是老师的「虚拟画布」逻辑尺寸(主显示器逻辑像素),
// 学生端所有笔迹/图片/光标都按它做等比缩放,窗口大小不同也不会错位。
export interface StageState {
  roomCode: string;
  mode: StageMode;
  board: { w: number; h: number } | null;
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
