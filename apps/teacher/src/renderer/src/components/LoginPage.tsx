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
        display: 'flex',
        height: '100vh',
        background: '#f7f8fa',
      }}
    >
      {/* 左侧品牌区 */}
      <div
        style={{
          flex: '1 1 52%',
          background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 55%, #3b82f6 100%)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 64px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 装饰性教学元素 */}
        <div
          style={{
            position: 'absolute',
            top: -60,
            right: -40,
            width: 260,
            height: 260,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -80,
            left: -60,
            width: 320,
            height: 320,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 28,
            }}
          >
            <LogoMark />
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>
              {cfg.brand}
            </span>
          </div>

          <h1 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 16px', lineHeight: 1.2 }}>
            {cfg.title}
          </h1>
          <p style={{ fontSize: 17, margin: 0, opacity: 0.9, lineHeight: 1.6 }}>
            {cfg.subtitle}
          </p>

          <div style={{ marginTop: 40, display: 'flex', gap: 24, opacity: 0.85 }}>
            {['课件同步', '白板互动', '局域网连接'].map((f) => (
              <div key={f} style={{ fontSize: 14 }}>
                <span style={{ marginRight: 6 }}>·</span>
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div
        style={{
          flex: '1 1 48%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <form onSubmit={handleSubmit} style={{ width: 360 }}>
          <h2 style={{ fontSize: 26, margin: '0 0 8px', color: '#1f2937' }}>
            欢迎回来
          </h2>
          <p style={{ color: '#8a8f98', fontSize: 14, margin: '0 0 36px' }}>
            登录{cfg.title}开始
          </p>

          <label style={{ display: 'block', fontSize: 14, marginBottom: 8, color: '#4b5563' }}>
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
              fontSize: 14,
              marginBottom: 8,
              color: '#4b5563',
              marginTop: 20,
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
              marginTop: 32,
              padding: '13px 0',
              background: cfg.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 16,
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              boxShadow: '0 4px 14px rgba(37,99,235,0.3)',
            }}
          >
            {loading ? '登录中…' : '登 录'}
          </button>

          <p style={{ color: '#b0b4bb', fontSize: 12, marginTop: 24, textAlign: 'center' }}>
            {cfg.hint}
          </p>
        </form>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
      <rect x="1" y="1" width="32" height="32" rx="8" fill="rgba(255,255,255,0.15)" />
      <path
        d="M10 22 L17 10 L24 22"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 18 L21 18"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  border: '1px solid #e2e5ea',
  borderRadius: 10,
  fontSize: 15,
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color .2s',
  background: '#fff',
};
