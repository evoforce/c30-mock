import { useState } from 'react';
import type { User } from '@c30/shared';
import DockNav from './DockNav';

// 学生端主界面:类 Dock 左侧导航 + 右侧内容区
export default function StudentWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('session');

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <DockNav active={active} onChange={setActive} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            borderBottom: '1px solid #eef0f3',
            background: '#ffffff',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>
            {active === 'session' && '课堂'}
            {active === 'courseware' && '课件'}
            {active === 'whiteboard' && '白板'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 13, color: '#7c8494' }}>{user.name} · 学生</span>
            <button
              onClick={onLogout}
              style={{
                padding: '6px 14px',
                border: '1px solid #e2e5ea',
                borderRadius: 8,
                background: '#fff',
                color: '#4b5563',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              退出
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f7f8fa',
            color: '#9aa1ac',
            fontSize: 15,
          }}
        >
          {active === 'session' && '课堂发现与加入即将上线(M4)'}
          {active === 'courseware' && '课件跟随即将上线(M2)'}
          {active === 'whiteboard' && '白板同步即将上线(M3)'}
        </div>
      </div>
    </div>
  );
}
