import { useState } from 'react';
import StudentWorkspace from './components/StudentWorkspace';

// 学生端:无登录,启动即从局域网发现教师端并自动接入
export default function App() {
  return <StudentWorkspace />;
}
