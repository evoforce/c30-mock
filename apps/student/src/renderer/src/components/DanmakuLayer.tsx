import { useEffect, useRef, useState } from 'react';
import type { Danmaku } from '@c30/shared';

// 弹幕层:从右向左滚动,参考主流直播弹幕
export default function DanmakuLayer({ danmakuList }: { danmakuList: Danmaku[] }) {
  const [lanes, setLanes] = useState<{ id: string; danmaku: Danmaku }[]>([]);
  const laneCounter = useRef(0);

  useEffect(() => {
    if (danmakuList.length === 0) return;
    // 只处理最新一条(由列表尾部驱动)
    const latest = danmakuList[danmakuList.length - 1];
    const lane = laneCounter.current % 6;
    laneCounter.current += 1;
    const item = { id: `${latest.id}-${lane}`, danmaku: latest };
    setLanes((prev) => [...prev.slice(-29), item]);
    // 动画结束后移除
    setTimeout(() => {
      setLanes((prev) => prev.filter((l) => l.id !== item.id));
    }, 9000);
  }, [danmakuList]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      {lanes.map((l, i) => {
        const laneTop = 60 + (l.id.charCodeAt(l.id.length - 1) % 6) * 34;
        return (
          <div
            key={l.id}
            style={{
              position: 'absolute',
              top: laneTop,
              right: 0,
              whiteSpace: 'nowrap',
              fontSize: 15,
              color: '#fff',
              background: 'rgba(17,24,39,0.55)',
              padding: '4px 12px',
              borderRadius: 16,
              animation: 'c30-danmaku 9s linear forwards',
              display: 'inline-block',
              maxWidth: '60vw',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{ color: '#93c5fd', marginRight: 6 }}>{l.danmaku.name}:</span>
            {l.danmaku.content}
          </div>
        );
      })}
      <style>{`
        @keyframes c30-danmaku {
          from { transform: translateX(0); }
          to { transform: translateX(calc(-100vw - 100%)); }
        }
      `}</style>
    </div>
  );
}
