import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { StageMode } from '@c30/shared';

export type RtcPhase = 'idle' | 'waiting' | 'connecting' | 'live';

// 学生端屏幕共享接收:
//   上课 + 舞台为「投屏」时向老师发 rtc.request;老师回 offer → 学生 answer。
//   服务端只做信令转发,媒体走 WebRTC P2P(局域网 host candidate,无需 STUN)。
// 老师切白板时保持连接但隐藏视频;下课后关闭连接。
export default function useStudentRtc({
  socket,
  roomCode,
  classActive,
  stage,
}: {
  socket: Socket | null;
  roomCode: string;
  classActive: boolean;
  stage: StageMode;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<RtcPhase>('idle');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteSetRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = stream;

  const closePeer = () => {
    const pc = pcRef.current;
    pcRef.current = null;
    remoteSetRef.current = false;
    pendingIceRef.current = [];
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        /* ignore */
      }
    }
    setStream(null);
    setPhase('idle');
  };

  useEffect(() => {
    if (!socket || !roomCode || !classActive || stage !== 'screen') {
      closePeer();
      return;
    }

    const s = socket;
    let disposed = false;

    const request = () => {
      if (disposed) return;
      const pc = pcRef.current;
      const need =
        !pc || pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed';
      if (need) {
        if (!streamRef.current) setPhase('waiting');
        s.emit('rtc.request', { roomCode });
      }
    };

    const flushIce = async () => {
      const pc = pcRef.current;
      if (!pc || !remoteSetRef.current) return;
      const queued = pendingIceRef.current.splice(0);
      for (const candidate of queued) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* ignore */
        }
      }
    };

    const onOffer = async (body: { from?: string; sdp?: RTCSessionDescriptionInit }) => {
      const from = String(body?.from ?? '');
      if (!from || !body?.sdp) return;
      // 老师端可能先发 ICE 再发 offer:重建连接时保留已到达的候选,避免丢包
      const queued = pendingIceRef.current.slice();
      closePeer();
      pendingIceRef.current = queued;
      setPhase('connecting');
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      pc.ontrack = (e) => {
        const remote = e.streams[0] ?? new MediaStream([e.track]);
        setStream(remote);
        setPhase('live');
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          s.emit('rtc.ice', { roomCode, to: from, candidate: e.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setPhase('live');
        else if (pc.connectionState === 'failed') {
          closePeer();
          setPhase('waiting');
        }
      };
      try {
        await pc.setRemoteDescription(body.sdp);
        remoteSetRef.current = true;
        await flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        s.emit('rtc.answer', { roomCode, to: from, sdp: pc.localDescription ?? answer });
      } catch (err) {
        console.warn('[rtc] answer failed:', (err as Error)?.message ?? String(err));
        closePeer();
      }
    };

    const onIce = async (body: { from?: string; candidate?: RTCIceCandidateInit }) => {
      if (!body?.candidate) return;
      const pc = pcRef.current;
      if (!pc) {
        pendingIceRef.current.push(body.candidate);
        return;
      }
      if (!remoteSetRef.current) {
        pendingIceRef.current.push(body.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(body.candidate);
      } catch {
        /* ignore */
      }
    };

    const onStop = () => {
      closePeer();
    };

    s.on('rtc.offer', onOffer);
    s.on('rtc.ice', onIce);
    s.on('rtc.stop', onStop);

    // 首次请求 + 每 3s 兜底重试(老师还没开共享 / 信令丢失时不会一直黑屏)
    request();
    const retry = window.setInterval(request, 3000);

    return () => {
      disposed = true;
      window.clearInterval(retry);
      s.off('rtc.offer', onOffer);
      s.off('rtc.ice', onIce);
      s.off('rtc.stop', onStop);
      closePeer();
    };
  }, [socket, roomCode, classActive, stage]);

  return { stream, phase };
}
