// mDNS 局域网发现封装(基于 bonjour-service)
// 用于"双轨自动降级"连接:学生端优先直连教师端 IP,mDNS 发现失败时回退中心服务器。

import { Bonjour, type Service, type Browser } from 'bonjour-service';

// bonjour-service 的 Browser 运行时是 EventEmitter(会发 up/down),但 d.ts 里
// 没有把 EventEmitter 的 on/off 暴露出来,这里补一个最小类型,只声明我们要用的 down。
type DownBrowser = Browser & {
  on(event: 'down', listener: (service: Service) => void): void;
  off(event: 'down', listener: (service: Service) => void): void;
};

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
  /**
   * 学生端订阅发现(回调收到教师端)。
   * onLost 在教师端停播/记录过期时触发,调用方应把该房间从列表移除,
   * 否则学生端会一直保留已关闭课堂的卡片。
   */
  subscribe(onFound: (info: DiscoveryInfo) => void, onLost?: (roomCode: string) => void): Promise<void>;
  /** 停止订阅 */
  unsubscribe(): Promise<void>;
}

const SERVICE_TYPE = 'c30-whiteboard';

// 单例实现
class BonjourMdsd implements MdsdService {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;
  private browser: DownBrowser | null = null;
  /** 当前注册的 down 监听(unsubscribe 时要精确摘掉) */
  private downHandler: ((service: Service) => void) | null = null;

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
    // 不在库内打日志:调用方(main 进程)统一打印一行 ASCII 日志,避免中文在 GBK 控制台乱码
  }

  async unpublish(): Promise<void> {
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
  }

  async subscribe(
    onFound: (info: DiscoveryInfo) => void,
    onLost?: (roomCode: string) => void,
  ): Promise<void> {
    const bonjour = this.ensure();
    if (this.browser) return; // 已在订阅

    const browser = bonjour.find({ type: SERVICE_TYPE }, (service) => {
      const txt = service.txt ?? {};
      const roomCode = String(txt.roomCode ?? '');
      const teacherName = String(txt.teacherName ?? '');
      // host 优先取 txt 里的,否则取 service.host / addresses
      const host = String(txt.host ?? service.host ?? service.addresses?.[0] ?? '');
      const port = service.port ?? 0;

      if (!roomCode || !host || !port) return;
      onFound({ roomCode, teacherName, host, port });
    }) as DownBrowser;

    // 教师端停播(goodbye)/ 记录过期:把房间从学生端列表里摘掉
    if (onLost) {
      this.downHandler = (service: Service) => {
        const txt = service.txt ?? {};
        const roomCode = String(txt.roomCode ?? '') || service.name.replace(/^c30-/, '');
        if (roomCode) onLost(roomCode);
      };
      browser.on('down', this.downHandler);
    }

    this.browser = browser;
  }

  async unsubscribe(): Promise<void> {
    if (this.browser) {
      if (this.downHandler) this.browser.off('down', this.downHandler);
      this.downHandler = null;
      this.browser.stop();
      this.browser = null;
    }
  }
}

export const mdsd: MdsdService = new BonjourMdsd();
