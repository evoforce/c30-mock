import { useState } from 'react';
import type { LoginResponse } from '@c30/shared';
import LoginPage from './components/LoginPage';
import TitleBar from './components/TitleBar';

export default function App() {
  const [user, setUser] = useState<LoginResponse | null>(null);

  return (
    <div>
      <TitleBar />
      {!user ? (
        <LoginPage role="TEACHER" onLogin={setUser} />
      ) : (
        <div style={{ padding: '48px 24px 24px' }}>
          <h1>C30 教师端</h1>
          <p>
            已登录:<strong>{user.user.name}</strong>({user.user.username})
          </p>
          <p style={{ color: '#888' }}>登录链路已跑通,下一步接入课件与白板。</p>
          <button
            onClick={() => setUser(null)}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
