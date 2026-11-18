import { useState } from 'react';
import type { User } from '@c30/shared';
import TeacherWorkspace from './components/TeacherWorkspace';

// 教师端匿名身份需要**跨刷新稳定**:
// 服务端按 teacherId 复用课堂(session.create 幂等),身份一变就会新建一间教室 ——
// 旧教室还留在内存里,学生端 mDNS 列表就会越积越多(出现过一次 4 个「王老师的课堂」)。
// 因此把 id 持久化到 localStorage,只有第一次启动才生成。
const IDENTITY_KEY = 'c30.teacher.identity';

function loadTeacherIdentity(): User {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { id?: unknown; name?: unknown };
      if (typeof saved?.id === 'string' && saved.id) {
        return {
          id: saved.id,
          username: 'teacher',
          name: typeof saved.name === 'string' && saved.name ? saved.name : '王老师',
          role: 'TEACHER',
        };
      }
    }
  } catch {
    // localStorage 不可用(隐私模式/损坏)时退回内存身份,不阻塞启动
  }
  const fresh: User = {
    id: `teacher-${Math.random().toString(36).slice(2, 10)}`,
    username: 'teacher',
    name: '王老师',
    role: 'TEACHER',
  };
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify({ id: fresh.id, name: fresh.name }));
  } catch {
    /* 忽略写入失败 */
  }
  return fresh;
}

// 发送端(教师端):免登录,启动即创建课堂并广播。
// 使用本地匿名教师身份(无需后端鉴权)。
export default function App() {
  const [user] = useState<User>(loadTeacherIdentity);

  return <TeacherWorkspace user={user} onLogout={() => {}} />;
}
