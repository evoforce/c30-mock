import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { InteractionControl, StageMode } from '@c30/shared';
import Whiteboard from './Whiteboard';
import StudentInteract from './StudentInteract';
import type { RtcPhase } from '../hooks/useStudentRtc';

// 学生端舞台:
//   · 老师投屏 → 底层 <video> 播 WebRTC 画面,上层透明 Whiteboard 只叠笔迹/图片;
//   · 老师白板 → 白底 Whiteboard,不显示视频;
//   · 所有坐标以老师虚拟画布 board 为准,等比缩放 + 居中,窗口大小不同也不偏。
export default function ClassStage({
  socket,
  roomCode,
  userId,
  interaction,
  mode,
  board,
  stream,
  phase,
  cursor,
}: {
  socket: Socket | null;
  roomCode: string;
  userId?: string;
  interaction: InteractionControl;
  mode: StageMode;
  board: { w: number; h: number } | null;
  stream: MediaStream | null;
  phase: RtcPhase;
  cursor: { x: number; y: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 把远端流挂到 video 上
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().catch(() => {});
    return () => {
      if (v.srcObject === stream) v.srcObject = null;
    };
  }, [stream]);

  const bw = board?.w && board.w > 0 ? board.w : 1920;
  const bh = board?.h && board.h > 0 ? board.h : 1080;
  const scale = size.w > 0 && size.h > 0 ? Math.min(size.w / bw, size.h / bh) : 0;
  const offX = (size.w - bw * scale) / 2;
  const offY = (size.h - bh * scale) / 2;

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        background: '#05070a',
      }}
    >
      {scale > 0 && (
        <div
          style={{
            position: 'absolute',
            left: offX,
            top: offY,
            width: bw,
            height: bh,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: '#000',
          }}
        >
          {mode === 'screen' && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover', // 采集是整屏(含任务栏),board 是老师可书写区;裁掉底部而不是拉伸
                background: '#000',
              }}
            />
          )}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <Whiteboard
              socket={socket}
              roomCode={roomCode}
              isTeacher={false}
              userId={userId}
              interaction={interaction}
              variant={mode === 'screen' ? 'screen' : 'board'}
              showChrome={false}
              showInteract={false}
            />
          </div>
        </div>
      )}

      {/* 等待画面:老师还没开始共享 / WebRTC 正在连 */}
      {mode === 'screen' && !stream && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#9ca3af',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: '3px solid rgba(96,165,250,0.25)',
              borderTopColor: '#60a5fa',
              animation: 'c30-stage-spin 0.9s linear infinite',
            }}
          />
          <div style={{ fontSize: 14 }}>
            {phase === 'connecting' ? '正在连接老师画面…' : '等待老师共享屏幕…'}
          </div>
          <style>{`@keyframes c30-stage-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* 老师光标:单独按频发送,叠在低帧率画面之上仍然跟手 */}
      {mode === 'screen' && cursor && scale > 0 && (
        <div
          style={{
            position: 'absolute',
            left: offX + cursor.x * scale,
            top: offY + cursor.y * scale,
            width: 12,
            height: 12,
            marginLeft: -1,
            marginTop: -1,
            borderRadius: '50%',
            border: '2px solid #f97316',
            background: 'rgba(249,115,22,0.35)',
            boxShadow: '0 0 0 2px rgba(255,255,255,0.55)',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        />
      )}

      {/* 课堂互动(举手/抢答/投票/点名)按窗口尺寸渲染,不跟随画布缩放变小 */}
      {userId && (
        <StudentInteract
          socket={socket}
          roomCode={roomCode}
          userId={userId}
          enabled={interaction.interactEnabled}
        />
      )}

      {/* 左上角模式提示 */}
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: 14,
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(17,24,39,0.72)',
          color: '#d1d5db',
          fontSize: 12,
          pointerEvents: 'none',
          backdropFilter: 'blur(6px)',
          zIndex: 15,
        }}
      >
        {mode === 'screen' ? '老师共享屏幕' : '老师白板'}
      </div>
    </div>
  );
}
