// mDNS 局域网发现封装(基于 bonjour-service)
// 用于"双轨自动降级"连接:学生端优先直连教师端 IP,mDNS 发现失败时回退中心服务器。

import { Bonjour, type Service, type Browser } from 'bonjour-service';
import { createSocket } from 'dgram';
import { networkInterfaces } from 'os';

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
  /** 当前 mDNS 实际绑定的网卡地址(诊断用;未初始化/自动时为 undefined) */
  getInterface(): string | undefined;
}

const SERVICE_TYPE = 'c30-whiteboard';

// —— 多播出口网卡选择 ——
// 背景:multicast-dns 的 defaultInterface() 在非 macOS 上一律返回 '0.0.0.0',
// 于是 IP_MULTICAST_IF 交给系统路由表决定。装了 Hyper-V / VMware / Clash TUN 的
// Windows 机器上,224.0.0.251 常被路由进虚拟网卡(实测:Hyper-V Default Switch),
// 广播/应答全发进了虚拟交换机,真实局域网上一个包都收不到 —— 现象就是学生端
// 「永远扫不到课堂」,而教师端自己用 loopback 探测却是正常的。
// 实测对照:绑 0.0.0.0 时 30 个多播包全落在 vEthernet;绑 192.168.x 时 30 个全落在以太网。
// 因此这里显式挑一张「真实局域网网卡」并把 bonjour 绑上去(bind/join/egress 一起生效)。

function isUsableIPv4(addr: string): boolean {
  if (!addr || addr.startsWith('127.')) return false;
  if (addr.startsWith('169.254.')) return false; // APIPA:没拿到 DHCP
  if (/^198\.(18|19)\./.test(addr)) return false; // Clash/Meta TUN 常用段
  return true;
}

/**
 * 一次「不发送任何包」的 UDP connect,让内核告诉我们默认路由用的是哪张网卡。
 * 比按网段猜更可靠:虚拟网卡/未连接的网卡没有默认路由,自然被排除。
 */
function probeDefaultRouteAddress(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const done = (addr?: string) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* 已关闭 */
      }
      resolve(addr);
    };
    // 无默认路由时 connect 可能迟迟不回调,300ms 足够,兜底走网段打分
    const timer = setTimeout(() => done(undefined), 300);
    socket.once('error', () => {
      clearTimeout(timer);
      done(undefined);
    });
    socket.connect(53, '223.5.5.5', () => {
      clearTimeout(timer);
      done(socket.address()?.address);
    });
  });
}

/** 兜底:按真实局域网常见网段打分(与教师端 main 里的 getLanIP 口径一致) */
function scoredLanAddress(): string | undefined {
  const nets = networkInterfaces();
  let best: string | undefined;
  let bestScore = -1;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const addr = net.address;
      if (!isUsableIPv4(addr)) continue;
      let score = 1;
      if (addr.startsWith('192.168.')) score = 3;
      else if (addr.startsWith('10.')) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) score = 2;
      if (score > bestScore) {
        bestScore = score;
        best = addr;
      }
    }
  }
  return best;
}

async function resolveLanAddress(): Promise<string | undefined> {
  // 允许现场强制指定(排查时很有用):C30_MDNS_INTERFACE=192.168.3.121
  const forced = process.env['C30_MDNS_INTERFACE'];
  if (forced && isUsableIPv4(forced)) return forced;
  const probed = await probeDefaultRouteAddress();
  if (probed && isUsableIPv4(probed)) return probed;
  return scoredLanAddress();
}

// 单例实现
class BonjourMdsd implements MdsdService {
  private bonjour: Bonjour | null = null;
  private iface: string | undefined;
  private service: Service | null = null;
  private browser: DownBrowser | null = null;
  /** 当前注册的 down 监听(unsubscribe 时要精确摘掉) */
  private downHandler: ((service: Service) => void) | null = null;

  getInterface(): string | undefined {
    return this.iface;
  }

  private async ensure(): Promise<Bonjour> {
    if (!this.bonjour) {
      this.iface = await resolveLanAddress();
      // bonjour-service 的 ServiceConfig 类型没声明 interface,但底层 multicast-dns 支持:
      // 传了它之后 bind / addMembership / IP_MULTICAST_IF 全部锁定到这块网卡。
      const opts = this.iface
        ? ({ interface: this.iface } as unknown as ConstructorParameters<typeof Bonjour>[0])
        : undefined;
      this.bonjour = new Bonjour(opts);
    }
    return this.bonjour;
  }

  async publish(info: DiscoveryInfo): Promise<void> {
    const bonjour = await this.ensure();
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
    const bonjour = await this.ensure();
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
