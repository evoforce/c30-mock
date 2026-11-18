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
// 画质梯子:maxHeight 是编码后画面高度的上限,scaleResolutionDownBy 按实际采集高度折算。
// 屏幕内容(PPT / 代码 / 文字)非常吃码率,所以最高档直接给到 8 Mbps;
// 清晰度优先级靠采集轨的 contentHint='detail' 表达,让编码器别一紧张就降分辨率。
const QUALITY_PROFILES = [
  { name: 'minimal', maxHeight: 480, maxBitrate: 700_000, maxFramerate: 15 },
  { name: 'low', maxHeight: 720, maxBitrate: 1_800_000, maxFramerate: 24 },
  { name: 'medium', maxHeight: 1080, maxBitrate: 4_000_000, maxFramerate: 30 },
  { name: 'high', maxHeight: 1440, maxBitrate: 8_000_000, maxFramerate: 30 },
] as const;

// 起始档位:局域网一般撑得住 1080p;更差会在第一个采样周期(2s)内降档。
const START_PROFILE = 2;
// 学生数超过这个值就不再往上升档:P2P 每人一份上行,人多时高码率会打满老师出口。
const HIGH_PROFILE_MAX_PEERS = 6;

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

  // 当前画质档位下标(0 最省 … 3 最高)与采集高度(用来换算 scaleResolutionDownBy)
  const profileRef = useRef(START_PROFILE);
  const captureHeightRef = useRef(1080);
  const upgradeStreakRef = useRef(0);

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

  /** 把某一档画质写到这条连接的所有视频 sender 上(协商完成后调用才生效) */
  const applyProfile = useCallback(async (pc: RTCPeerConnection, index: number) => {
    const profile = QUALITY_PROFILES[Math.max(0, Math.min(QUALITY_PROFILES.length - 1, index))];
    const captureHeight = captureHeightRef.current || 1080;
    // scaleResolutionDownBy 只能缩小:采集 1080p 时「1440p 档」实际就是原分辨率
    const scale = Math.max(1, captureHeight / profile.maxHeight);
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0].maxBitrate = profile.maxBitrate;
        params.encodings[0].maxFramerate = profile.maxFramerate;
        params.encodings[0].scaleResolutionDownBy = scale;
        // balanced:带宽紧张时分辨率与帧率各让一步;纯保分辨率会让画面直接卡住
        params.degradationPreference = 'balanced';
        await sender.setParameters(params);
      } catch {
        /* 某些平台不支持 setParameters,忽略 */
      }
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
        // 采集按物理像素要满:学生端窗口普遍比 1080p 宽,采集小了再放大一定糊。
        // 上限 2560x1600 —— 4K 整屏采集的清晰度收益很小,编码/CPU 成本却翻倍。
        const dpr = window.devicePixelRatio || 1;
        const captureWidth = Math.min(2560, Math.round((window.screen.width || 1920) * dpr));
        const captureHeight = Math.min(1600, Math.round((window.screen.height || 1080) * dpr));
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 30 },
            width: { ideal: captureWidth, max: captureWidth },
            height: { ideal: captureHeight, max: captureHeight },
          },
          audio: false,
        });
        // 共享期间排除悬浮层(Windows: WDA_EXCLUDEFROMCAPTURE)
        (window as any).api?.screen?.protect?.(true);
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        captureHeightRef.current = videoTrack?.getSettings().height || captureHeight;
        stream.getVideoTracks().forEach((t) => {
          // "detail":屏幕内容优先保清晰度,别在带宽紧张时优先丢分辨率
          t.contentHint = 'detail';
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
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // 协商完成后再写编码参数:此时 encodings 已存在,setParameters 才真正生效
        await applyProfile(pc, profileRef.current);
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
  }, [socket, roomCode, classActive, stage, ensureStream, closePeer, applyProfile]);

  // 白板模式只暂停视频轨(不关 PeerConnection),切回投屏立刻恢复,不用重新协商
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const enabled = classActive && stage === 'screen';
    stream.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }, [classActive, stage]);

  // 网络自适应:每 2s 读一次发送端统计,按可用上行 / 丢包 / 编码受限原因升降档。
  //   · qualityLimitationReason = 'bandwidth'|'cpu':编码器已经在为带宽/CPU 让步 → 降档
  //   · availableOutgoingBitrate 低于当前档码率的 1.3 倍 → 提前降档,别等画面先糊
  //   · 连续两次采样都「带宽富余 + 无受限」才升档,避免在临界点来回抖
  // 网络好时最终会爬到 high(1440p 上限 / 8 Mbps),差的时候退到 minimal(480p)。
  useEffect(() => {
    if (!socket || !classActive || stage !== 'screen') return;

    const sample = async () => {
      const pcs = [...pcsRef.current.values()].filter((pc) => pc.connectionState === 'connected');
      if (pcs.length === 0) return;

      let available: number | undefined;
      let lossRate: number | undefined;
      let reason = 'none';
      for (const pc of pcs) {
        let stats: RTCStatsReport;
        try {
          stats = await pc.getStats();
        } catch {
          continue;
        }
        stats.forEach((report) => {
          const r = report as {
            type?: string;
            state?: string;
            kind?: string;
            availableOutgoingBitrate?: number;
            fractionLost?: number;
            qualityLimitationReason?: string;
          };
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.availableOutgoingBitrate === 'number') {
            available = available === undefined ? r.availableOutgoingBitrate : Math.min(available, r.availableOutgoingBitrate);
          }
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video' && typeof r.fractionLost === 'number') {
            lossRate = lossRate === undefined ? r.fractionLost : Math.max(lossRate, r.fractionLost);
          }
          if (r.type === 'outbound-rtp' && r.kind === 'video' && r.qualityLimitationReason && r.qualityLimitationReason !== 'none') {
            reason = r.qualityLimitationReason;
          }
        });
      }

      const index = profileRef.current;
      const profile = QUALITY_PROFILES[index];
      const constrained =
        reason !== 'none' ||
        (available !== undefined && available < profile.maxBitrate * 1.3) ||
        (lossRate ?? 0) > 0.05;

      if (constrained) {
        upgradeStreakRef.current = 0;
        if (index > 0) {
          profileRef.current = index - 1;
          await Promise.all(pcs.map((pc) => applyProfile(pc, profileRef.current)));
        }
        return;
      }

      const headroom = available === undefined || available > profile.maxBitrate * 1.8;
      if (!headroom) {
        upgradeStreakRef.current = 0;
        return;
      }

      upgradeStreakRef.current += 1;
      const ceiling = pcs.length > HIGH_PROFILE_MAX_PEERS ? QUALITY_PROFILES.length - 2 : QUALITY_PROFILES.length - 1;
      if (upgradeStreakRef.current >= 2 && index < ceiling) {
        profileRef.current = index + 1;
        upgradeStreakRef.current = 0;
        await Promise.all(pcs.map((pc) => applyProfile(pc, profileRef.current)));
      }
    };

    const timer = window.setInterval(() => {
      void sample();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [socket, classActive, stage, applyProfile]);

  // 下课 / 卸载:关闭所有连接与采集
  useEffect(() => {
    if (classActive) return;
    stopAll();
  }, [classActive, stopAll]);

  useEffect(() => stopAll, [stopAll]);
}
