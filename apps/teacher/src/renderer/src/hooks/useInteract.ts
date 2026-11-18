import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { InteractSnapshot, InteractStartRequest } from '@c30/shared';

// 教师端「互动」的控制接口。
// 服务端(内嵌 classroom server)是唯一真源:这里只负责发意图 + 收快照,
// 面板上显示的所有数字都来自 `state`,不在本地另算一份。
export interface InteractController {
  state: InteractSnapshot | null;
  error: string | null;
  start: (request: InteractStartRequest) => void;
  end: () => void;
  reset: () => void;
  pickAgain: () => void;
  clearHands: () => void;
}

export default function useInteract(socket: Socket | null, roomCode: string): InteractController {
  const [state, setState] = useState<InteractSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // socket / roomCode 会被 effect 闭包捕获,用 ref 保证回调里拿到的永远是最新值
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;

  // 错误提示 3.5s 自动消失(避免面板里留一条陈旧的报错)
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!socket) return;
    const onState = (snap: InteractSnapshot) => setState(snap);
    const onError = (d: { message: string }) => setError(d.message);
    socket.on('interact.state', onState);
    socket.on('interact.error', onError);
    // 课堂创建完成后补拉一次(连接建立时 roomCode 还是空,服务端那份推送可能早于本 hook 挂载)
    if (roomCodeRef.current) socket.emit('interact.sync', { roomCode: roomCodeRef.current });
    return () => {
      socket.off('interact.state', onState);
      socket.off('interact.error', onError);
    };
  }, [socket, roomCode]);

  const emit = useCallback((event: string, payload: Record<string, unknown>) => {
    const s = socketRef.current;
    const code = roomCodeRef.current;
    if (!s || !code) return;
    s.emit(event, { roomCode: code, ...payload });
  }, []);

  const start = useCallback(
    (request: InteractStartRequest) => emit('interact.start', { request }),
    [emit],
  );
  const end = useCallback(() => emit('interact.end', {}), [emit]);
  const reset = useCallback(() => emit('interact.reset', {}), [emit]);
  const pickAgain = useCallback(() => emit('interact.pick', {}), [emit]);
  const clearHands = useCallback(() => emit('interact.hands.clear', {}), [emit]);

  return { state, error, start, end, reset, pickAgain, clearHands };
}
