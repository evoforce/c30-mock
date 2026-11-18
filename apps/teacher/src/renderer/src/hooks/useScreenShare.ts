import { useCallback, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { StageMode } from '@c30/shared';

// 教师端屏幕共享:每个学生一路 RTCPeerConnection(小班 Demo 足够;
// 大班后续要换 SFU,但 UI 与信令协议不用动)。
//
// 采集:渲染层 getDisplayMedia() + 主进程 setDisplayMediaRequestHandler 自动选主屏。
// 悬浮层通过 screen:protect 开启内容保护,避免把侧边栏/工具栏采进画面。
//
// 信令(服务端只转发):
//   学生 rtc.request → 老师
//   老师 rtc.offer   → 学生
//   学生 rtc.answer  → 老师
//   双向 rtc.ice
export default function useScreenShare({
  socket,
  roomCode,
  classActive,
  stage,
  onError,
}: {
  socket: Socket | null;
  roomCode: string;
  classActive: boolean;
  stage: StageMode;
  onError?: (message: string) => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // answer 到达前先到的 ICE(按学生 socket.id 暂存,setRemoteDescription 后再补)
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const startingRef = useRef<Promise<MediaStream | null> | null>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const closePeer = useCallback((peerId: string) => {
    const pc = pcsRef.current.get(peerId);
    if (!pc) return;
    pcsRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    try {
      pc.close();
    } catch {
      /* ignore */
    }
  }, []);

  const stopAll = useCallback(() => {
    for (const id of [...pcsRef.current.keys()]) closePeer(id);
    pendingIceRef.current.clear();
    const stream = streamRef.current;
    streamRef.current = null;
    startingRef.current = null;
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    // 共享结束,恢复窗口可被普通截图/录屏捕获
    (window as any).api?.screen?.protect?.(false);
  }, [closePeer]);

  // 采集屏幕(只采一次,多个学生复用同一 MediaStream)
  const ensureStream = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;
    if (startingRef.current) return startingRef.current;
    const starting = (async () => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 15, max: 20 },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        // 共享期间排除悬浮层(Windows: WDA_EXCLUDEFROMCAPTURE)
        (window as any).api?.screen?.protect?.(true);
        streamRef.current = stream;
        stream.getVideoTracks().forEach((t) => {
          t.enabled = stageRef.current === 'screen';
          // 用户从系统栏点「停止共享」时,把整个共享状态收掉
          t.onended = () => stopAll();
        });
        return stream;
      } catch (err) {
        console.warn('[screen-share] getDisplayMedia failed:', (err as Error)?.message ?? String(err));
        onErrorRef.current?.('屏幕共享启动失败,请检查系统录屏权限后重试');
        (window as any).api?.screen?.protect?.(false);
        return null;
      } finally {
        startingRef.current = null;
      }
    })();
    startingRef.current = starting;
    return starting;
  }, [stopAll]);

  // 上课期间:接信令 + 按舞台模式启停采集
  useEffect(() => {
    if (!socket || !roomCode || !classActive) return;
    const s = socket;

    const onRequest = async (body: { from?: string }) => {
      const peerId = String(body?.from ?? '');
      if (!peerId) return;
      const stream = await ensureStream();
      if (!stream) return;
      // 同一个学生重复请求:先关旧连接
      closePeer(peerId);
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcsRef.current.set(peerId, pc);
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          s.emit('rtc.ice', { roomCode: roomCodeRef.current, to: peerId, candidate: e.candidate.toJSON() });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(peerId);
      };
      try {
        const senders = stream.getTracks().map((t) => pc.addTrack(t, stream));
        // 控制单路码率,避免 30 人时老师上行打满(后续大班换 SFU)
        for (const sender of senders) {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
            params.encodings[0].maxBitrate = 4_000_000;
            await sender.setParameters(params);
          } catch {
            /* 某些平台不支持 setParameters,忽略 */
          }
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        s.emit('rtc.offer', {
          roomCode: roomCodeRef.current,
          to: peerId,
          sdp: pc.localDescription ?? offer,
        });
      } catch (err) {
        console.warn('[screen-share] createOffer failed:', (err as Error)?.message ?? String(err));
        closePeer(peerId);
      }
    };

    const onAnswer = async (body: { from?: string; sdp?: RTCSessionDescriptionInit }) => {
      const peerId = String(body?.from ?? '');
      const pc = pcsRef.current.get(peerId);
      if (!pc || !body?.sdp) return;
      try {
        await pc.setRemoteDescription(body.sdp);
        const queued = pendingIceRef.current.get(peerId) ?? [];
        pendingIceRef.current.delete(peerId);
        for (const candidate of queued) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.warn('[screen-share] setRemoteDescription(answer) failed:', (err as Error)?.message ?? String(err));
      }
    };

    const onIce = async (body: { from?: string; candidate?: RTCIceCandidateInit }) => {
      const peerId = String(body?.from ?? '');
      const pc = pcsRef.current.get(peerId);
      if (!pc || !body?.candidate) return;
      try {
        if (!pc.remoteDescription) {
          const queued = pendingIceRef.current.get(peerId) ?? [];
          queued.push(body.candidate);
          pendingIceRef.current.set(peerId, queued);
          return;
        }
        await pc.addIceCandidate(body.candidate);
      } catch {
        /* 候选到达早于 remoteDescription 时可能失败,WebRTC 会继续重试 */
      }
    };

    const onPeerLeft = (body: { peerId?: string }) => {
      if (body?.peerId) closePeer(body.peerId);
    };

    s.on('rtc.request', onRequest);
    s.on('rtc.answer', onAnswer);
    s.on('rtc.ice', onIce);
    s.on('rtc.peer-left', onPeerLeft);

    if (stage === 'screen') void ensureStream();

    return () => {
      s.off('rtc.request', onRequest);
      s.off('rtc.answer', onAnswer);
      s.off('rtc.ice', onIce);
      s.off('rtc.peer-left', onPeerLeft);
    };
  }, [socket, roomCode, classActive, stage, ensureStream, closePeer]);

  // 白板模式只暂停视频轨(不关 PeerConnection),切回投屏立刻恢复,不用重新协商
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const enabled = classActive && stage === 'screen';
    stream.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }, [classActive, stage]);

  // 下课 / 卸载:关闭所有连接与采集
  useEffect(() => {
    if (classActive) return;
    stopAll();
  }, [classActive, stopAll]);

  useEffect(() => stopAll, [stopAll]);
}
