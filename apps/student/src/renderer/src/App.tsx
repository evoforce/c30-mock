import { useState } from 'react';
import type { LoginResponse } from '@c30/shared';
import LoginPage from './components/LoginPage';
import StudentWorkspace from './components/StudentWorkspace';
import TitleBar from './components/TitleBar';

export default function App() {
  const [user, setUser] = useState<LoginResponse | null>(null);

  return (
    <div>
      <TitleBar />
      {!user ? (
        <LoginPage role="STUDENT" onLogin={setUser} />
      ) : (
        <StudentWorkspace user={user.user} onLogout={() => setUser(null)} />
      )}
    </div>
  );
}
