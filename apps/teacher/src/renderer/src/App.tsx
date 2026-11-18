import { useState } from 'react';
import type { User } from '@c30/shared';
import TeacherWorkspace from './components/TeacherWorkspace';

// 发送端(教师端):免登录,启动即创建课堂并广播。
// 使用本地匿名教师身份(无需后端鉴权)。
export default function App() {
  const [user] = useState<User>(() => ({
    id: `teacher-${Math.random().toString(36).slice(2, 10)}`,
    username: 'teacher',
    name: '王老师',
    role: 'TEACHER',
  }));

  return <TeacherWorkspace user={user} onLogout={() => {}} />;
}
