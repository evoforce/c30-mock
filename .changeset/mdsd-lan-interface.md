---
'@c30/mdsd': patch
'@c30/teacher': patch
'@c30/student': patch
---

修复局域网发现:mDNS 多播显式绑定真实局域网网卡

- 装了 Hyper-V / VMware / Clash 的 Windows 机器上,多播 224.0.0.251 会被路由进虚拟网卡:
  教师端的课堂广播与应答全发进虚拟交换机,学生端一直扫不到课堂,而教师端本机自测却正常
- 现在先用一次不发包的 UDP connect 问内核「默认路由是哪张网卡」,兜底再按 192.168 / 10 / 172.16 打分,
  把 bonjour 的 bind / addMembership / IP_MULTICAST_IF 全部锁定到这张网卡
- 可用 `C30_MDNS_INTERFACE` 环境变量现场强制指定网卡;教师端发布日志会打印实际使用的网卡地址
