import { useState } from 'react';
import type { LoginResponse } from '@c30/shared';

const API_BASE = 'http://localhost:3000';

interface LoginPageProps {
  role: 'TEACHER' | 'STUDENT';
  onLogin: (res: LoginResponse) => void;
}

export default function LoginPage({ role, onLogin }: LoginPageProps) {
  const [username, setUsername] = useState(role === 'TEACHER' ? 'teacher' : 'student');
  const [password, setPassword] = useState('123456');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.message ?? '登录失败');
        return;
      }
      onLogin(data as LoginResponse);
    } catch (err) {
      setError('无法连接服务器,请确认后端已启动');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        paddingTop: 36, // 避开自绘标题栏
        boxSizing: 'border-box',
        background: '#f5f6f8',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 360,
          background: '#fff',
          borderRadius: 12,
          padding: 32,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>
          C30 {role === 'TEACHER' ? '教师端' : '学生端'}
        </h1>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 24px' }}>登录以继续</p>

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#555' }}>
          用户名
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={inputStyle}
          placeholder="请输入用户名"
        />

        <label
          style={{
            display: 'block',
            fontSize: 13,
            marginBottom: 6,
            color: '#555',
            marginTop: 16,
          }}
        >
          密码
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
          placeholder="请输入密码"
        />

        {error && (
          <p style={{ color: '#e53e3e', fontSize: 13, margin: '12px 0 0' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            marginTop: 24,
            padding: '10px 0',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '登录中…' : '登录'}
        </button>

        <p style={{ color: '#aaa', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
          演示账号:teacher / student,密码 123456
        </p>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
  outline: 'none',
};
