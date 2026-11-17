import { useState } from 'react';
import type { LoginResponse } from '@c30/shared';
import LoginPage from './components/LoginPage';
import TeacherWorkspace from './components/TeacherWorkspace';
import TitleBar from './components/TitleBar';

export default function App() {
  const [user, setUser] = useState<LoginResponse | null>(null);

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
