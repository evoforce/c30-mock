// mDNS 局域网发现封装(基于 bonjour-service)
// 用于"双轨自动降级"连接:学生端优先直连教师端 IP,mDNS 发现失败时回退中心服务器。

import { Bonjour, type Service, type Browser } from 'bonjour-service';

export interface DiscoveryInfo {
  roomCode: string;
  teacherName: string;
  host: string; // 教师端局域网 IP
  port: number; // 教师端内嵌 socket.io 端口
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

const SERVICE_TYPE = 'c30-whiteboard';

// 单例实现
class BonjourMdsd implements MdsdService {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;
  private browser: Browser | null = null;

  private ensure(): Bonjour {
    if (!this.bonjour) {
      this.bonjour = new Bonjour();
    }
    return this.bonjour;
  }

  async publish(info: DiscoveryInfo): Promise<void> {
    const bonjour = this.ensure();
    // 先停止旧的广播,避免重复
    await this.unpublish();

    this.service = bonjour.publish({
      name: `c30-${info.roomCode}`,
      type: SERVICE_TYPE,
      port: info.port,
      txt: {
        roomCode: info.roomCode,
        teacherName: info.teacherName,
        host: info.host,
      },
    });

    console.log(`[mdsd] 已广播课堂: ${info.roomCode} @ ${info.host}:${info.port}`);
  }

  async unpublish(): Promise<void> {
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
  }

  async subscribe(onFound: (info: DiscoveryInfo) => void): Promise<void> {
    const bonjour = this.ensure();
    if (this.browser) return; // 已在订阅

    this.browser = bonjour.find({ type: SERVICE_TYPE }, (service) => {
      const txt = service.txt ?? {};
      const roomCode = txt.roomCode ?? '';
      const teacherName = txt.teacherName ?? '';
      // host 优先取 txt 里的,否则取 service.host / addresses
      const host = txt.host ?? service.host ?? service.addresses?.[0] ?? '';
      const port = service.port ?? 0;

      if (!roomCode || !host || !port) return;
      onFound({ roomCode, teacherName, host, port });
    });
  }

  async unsubscribe(): Promise<void> {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
  }
}

export const mdsd: MdsdService = new BonjourMdsd();
