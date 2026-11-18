// 课堂房间号的确定性派生:同一台教师机 + 同一网段 → 恒定不变。
//
// 背景:此前 roomCode 是每次 session.create 随机生成的 6 位码。教师端一重启(含 HMR、
// 崩溃重开、换端口)房间号就变,学生端「断线重连」实际连的是一个已经不存在的旧房间号,
// 承诺是空的。因此改为由「机器码 + 网络信息」哈希派生:
//   · 机器码:Windows MachineGuid(注册表,重装系统才会变)+ 主机名
//   · 网络信息:教师机所在网卡的 MAC + 网段(如 192.168.3.0/24)
// 刻意不掺端口/进程号/时间/随机数 —— 端口可能被占而顺延,进程每次都会变,
// 掺进去就等于又变回随机。三者一起哈希取 6 位(32 字母表,≈10 亿空间)。
//
// 语义:同一个教室里的同一台教师机,今天和明天房间号一致;换到另一个网段(另一个教室)
// 会得到不同房间号,避免两个教室的同一台笔记本互相串台。

import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { hostname, networkInterfaces } from 'os';

// 去掉 I/O/0/1 这些容易读错/写错的字符
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

let cachedMachineGuid: string | undefined;

function readMachineGuid(): string {
  if (cachedMachineGuid !== undefined) return cachedMachineGuid;
  cachedMachineGuid = '';
  if (process.platform !== 'win32') return cachedMachineGuid;
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
    });
    const match = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(out);
    if (match) cachedMachineGuid = match[1].trim().toLowerCase();
  } catch {
    // 注册表读不到(权限/精简系统)时退化为「主机名 + MAC」,依然稳定
  }
  return cachedMachineGuid;
}

function maskToPrefix(netmask: string): number {
  return netmask
    .split('.')
    .map((part) => Number(part) >>> 0)
    .reduce((acc, value) => acc + value.toString(2).split('1').length - 1, 0);
}

/** 由 IP + 子网掩码算出网段,如 192.168.3.121 + 255.255.255.0 → 192.168.3.0/24 */
export function cidrOf(address: string, netmask: string): string {
  const addr = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  const network = addr.map((value, index) => value & (mask[index] ?? 255));
  return `${network.join('.')}/${maskToPrefix(netmask)}`;
}

/** 网卡指纹:优先取「教师端实际广播用的那只网卡」的网段 + MAC */
function networkFingerprint(lanIp: string): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address !== lanIp) continue;
      return `${cidrOf(net.address, net.netmask)}|${(net.mac ?? '').toLowerCase()}`;
    }
  }
  // 找不到对应网卡(刚切网、网卡名对不上):退化成 /24 网段
  const parts = lanIp.split('.');
  return `${parts.slice(0, 3).join('.')}.0/24`;
}

/** 派生 6 位房间号(确定性,同一机器+网段恒定) */
export function deriveRoomCode(lanIp: string): string {
  const seed = [
    'c30-room-v1',
    `guid=${readMachineGuid()}`,
    `host=${hostname().toLowerCase()}`,
    `net=${networkFingerprint(lanIp)}`,
  ].join('|');
  const digest = createHash('sha256').update(seed).digest();
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[digest[i] % ALPHABET.length];
  return code;
}
