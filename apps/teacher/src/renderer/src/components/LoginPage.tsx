import { useState } from 'react';
import type { LoginResponse } from '@c30/shared';

const API_BASE = 'http://localhost:3000';

interface LoginPageProps {
  role: 'TEACHER' | 'STUDENT';
  onLogin: (res: LoginResponse) => void;
}

const ROLE_CONFIG = {
  TEACHER: {
    title: '教师端',
    subtitle: '备课 · 授课 · 板书,一站完成',
    brand: 'C30 教师工作台',
    placeholder: '请输入教师账号',
    hint: '演示账号 teacher,密码 123456',
    accent: '#2563eb',
  },
  STUDENT: {
    title: '学生端',
    subtitle: '跟随课堂,专注学习每一步',
    brand: 'C30 学生课堂',
    placeholder: '请输入学生账号',
    hint: '演示账号 student,密码 123456',
    accent: '#2563eb',
  },
} as const;

export default function LoginPage({ role, onLogin }: LoginPageProps) {
  const cfg = ROLE_CONFIG[role];
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
    } catch {
      setError('无法连接服务器,请确认后端已启动');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 居中悬浮登录卡片 */}
      <div
        style={{
          width: 400,
          background: 'rgba(255,255,255,0.96)',
          borderRadius: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.28)',
          padding: '40px 36px',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #1e40af, #2563eb)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            C
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>{cfg.brand}</div>
            <div style={{ fontSize: 12, color: '#9aa1ac' }}>{cfg.subtitle}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: '#4b5563' }}>
            账号
          </label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            placeholder={cfg.placeholder}
          />

          <label
            style={{
              display: 'block',
              fontSize: 13,
              marginBottom: 6,
              color: '#4b5563',
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
              marginTop: 28,
              padding: '13px 0',
              background: cfg.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(37,99,235,0.3)',
            }}
          >
            {loading ? '登录中…' : '登 录'}
          </button>

          <p style={{ color: '#b0b4bb', fontSize: 12, marginTop: 20, textAlign: 'center' }}>
            {cfg.hint}
          </p>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  border: '1px solid #e2e5ea',
  borderRadius: 10,
  fontSize: 15,
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color .2s',
  background: '#fff',
};
