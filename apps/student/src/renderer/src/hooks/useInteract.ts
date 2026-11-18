import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { InteractResponse, InteractSnapshot } from '@c30/shared';

// 学生端课堂互动:只订阅服务端快照 + 提交自己的响应。
// 服务端是唯一真源 —— 学生迟进课堂、断线重连后都会拿到完整快照,
// UI 上看到的投票结果 / 抢答名次 / 举手人数与老师面板完全一致。
export interface StudentInteractController {
  state: InteractSnapshot | null;
  /** 自己在当前互动里的响应(投票 / 观点云 / 点名确认),没参与时为 null */
  myResponse: InteractResponse | null;
  /** 自己是否举着手 */
  myHandRaised: boolean;
  respond: (payload: { optionIds?: string[]; text?: string }) => void;
  setHand: (raised: boolean) => void;
}

export default function useInteract(
  socket: Socket | null,
  roomCode: string,
  userId: string,
): StudentInteractController {
  const [state, setState] = useState<InteractSnapshot | null>(null);
  const socketRef = useRef<Socket | null>(socket);
  socketRef.current = socket;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (!socket) return;
    const onState = (snap: InteractSnapshot) => setState(snap);
    socket.on('interact.state', onState);
    // 挂载即补拉一次:学生可能在互动进行中才进入课堂 / 面板才挂载,
    // 服务端在 session.join 时推的那份快照当时还没有监听器。
    if (roomCodeRef.current) socket.emit('interact.sync', { roomCode: roomCodeRef.current });
    return () => {
      socket.off('interact.state', onState);
    };
  }, [socket]);

  const respond = useCallback((payload: { optionIds?: string[]; text?: string }) => {
    const s = socketRef.current;
    const code = roomCodeRef.current;
    const session = state?.session;
    if (!s || !code || !session || session.endedAt != null) return;
    s.emit('interact.respond', { roomCode: code, sessionId: session.id, ...payload });
  }, [state?.session]);

  const setHand = useCallback((raised: boolean) => {
    const s = socketRef.current;
    const code = roomCodeRef.current;
    if (!s || !code) return;
    s.emit('interact.hand', { roomCode: code, raised });
  }, []);

  const myResponse = state?.responses.find((r) => r.userId === userIdRef.current) ?? null;
  const myHandRaised = state?.hands.some((h) => h.userId === userIdRef.current) ?? false;

  return { state, myResponse, myHandRaised, respond, setHand };
}
