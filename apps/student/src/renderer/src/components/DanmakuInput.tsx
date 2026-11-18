import { useState } from 'react';
import { Send } from 'lucide-react';
import useOverlayScale, { scaled } from '../hooks/useOverlayScale';

// 学生端弹幕输入框(底部左侧)。尺寸随浮层缩放,大屏上也好点。
export default function DanmakuInput({ onSubmit }: { onSubmit: (content: string) => void }) {
  const [value, setValue] = useState('');
  const s = useOverlayScale();
  const px = (n: number) => scaled(n, s);

  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue('');
  };

  return (
    <div
      data-interactive
      style={{
        position: 'absolute',
        left: px(16),
        bottom: px(16),
        display: 'flex',
        alignItems: 'center',
        gap: px(6),
        background: 'rgba(255,255,255,0.92)',
        borderRadius: px(24),
        padding: `${px(5)}px ${px(6)}px ${px(5)}px ${px(18)}px`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        zIndex: 25,
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="发条弹幕…"
        maxLength={50}
        style={{
          width: px(220),
          border: 'none',
          outline: 'none',
          fontSize: px(14),
          background: 'transparent',
          color: '#1f2937',
        }}
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        title="发送"
        style={{
          width: px(36),
          height: px(36),
          borderRadius: '50%',
          border: 'none',
          background: value.trim() ? '#2563eb' : '#d5d9e0',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: value.trim() ? 'pointer' : 'not-allowed',
        }}
      >
        <Send size={px(18)} />
      </button>
    </div>
  );
}
