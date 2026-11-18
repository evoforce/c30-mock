import { useState } from 'react';
import { Send } from 'lucide-react';

// 学生端弹幕输入框(底部左侧)
export default function DanmakuInput({ onSubmit }: { onSubmit: (content: string) => void }) {
  const [value, setValue] = useState('');

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
        left: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(255,255,255,0.92)',
        borderRadius: 22,
        padding: '4px 6px 4px 16px',
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
          width: 200,
          border: 'none',
          outline: 'none',
          fontSize: 13,
          background: 'transparent',
          color: '#1f2937',
        }}
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        style={{
          width: 30,
          height: 30,
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
        <Send size={15} />
      </button>
    </div>
  );
}
