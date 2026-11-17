import { useState } from 'react';
import type { User } from '@c30/shared';
import DockNav from './DockNav';
import ResourceLibrary from './ResourceLibrary';

// 教师端主界面:类 Dock 左侧导航 + 右侧内容区
export default function TeacherWorkspace({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [active, setActive] = useState('resource');

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <DockNav active={active} onChange={setActive} user={user} onLogout={onLogout} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 顶部标题条 */}
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            borderBottom: '1px solid #eef0f3',
            background: '#ffffff',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>
            {active === 'resource' && '资源库'}
            {active === 'whiteboard' && '白板'}
            {active === 'session' && '课堂'}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {active === 'resource' && <ResourceLibrary userId={user.id} />}
          {active === 'whiteboard' && (
            <Placeholder text="白板功能区即将上线(M3)" />
          )}
          {active === 'session' && (
            <Placeholder text="课堂功能区即将上线(M4)" />
          )}
        </div>
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f7f8fa',
        color: '#9aa1ac',
        fontSize: 15,
      }}
    >
      {text}
    </div>
  );
}
