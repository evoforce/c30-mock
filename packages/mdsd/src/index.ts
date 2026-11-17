// mDNS 局域网发现封装

export interface DiscoveryInfo {
  roomCode: string;
  teacherName: string;
  host: string;
  port: number;
}

export interface MdsdService {
  /** 教师端广播自身信息 */
  publish(info: DiscoveryInfo): Promise<void>;
  /** 停止广播 */
  unpublish(): Promise<void>;
  /** 学生端订阅发现(回调收到教师端) */
  subscribe(onFound: (info: DiscoveryInfo) => void): Promise<void>;
  /** 停止订阅 */
  unsubscribe(): Promise<void>;
}

/**
 * 占位实现。
 * 完整版基于 bonjour/multicast-dns 实现真实 mDNS;
 * Demo 阶段可提供手动 IP 直连兜底。
 */
export const mdsd: MdsdService = {
  async publish(_info: DiscoveryInfo) {
    throw new Error('mdsd.publish not implemented');
  },
  async unpublish() {
    throw new Error('mdsd.unpublish not implemented');
  },
  async subscribe(_onFound: (info: DiscoveryInfo) => void) {
    throw new Error('mdsd.subscribe not implemented');
  },
  async unsubscribe() {
    throw new Error('mdsd.unsubscribe not implemented');
  },
};
