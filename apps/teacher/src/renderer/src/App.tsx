import { useState } from 'react';
import type { LoginResponse } from '@c30/shared';
import LoginPage from './components/LoginPage';
import TeacherWorkspace from './components/TeacherWorkspace';
import TitleBar from './components/TitleBar';
import DesktopAnnotate from './components/DesktopAnnotate';

export default function App() {
  const [user, setUser] = useState<LoginResponse | null>(null);

  // 桌面批注窗口:通过 hash 路由(主进程 loadFile 时带 hash '/annotate')
  const isAnnotate = window.location.hash.startsWith('#/annotate');
  if (isAnnotate) {
    return <DesktopAnnotate />;
  }

  return (
    <div>
      <TitleBar />
      {!user ? (
        <LoginPage role="TEACHER" onLogin={setUser} />
      ) : (
        <TeacherWorkspace user={user.user} onLogout={() => setUser(null)} />
      )}
    </div>
  );
}
