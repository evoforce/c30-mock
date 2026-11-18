# @c30/mdsd

## 0.1.3

### Patch Changes

- f917807: 修复局域网发现:mDNS 多播显式绑定真实局域网网卡

  - 装了 Hyper-V / VMware / Clash 的 Windows 机器上,多播 224.0.0.251 会被路由进虚拟网卡:
    教师端的课堂广播与应答全发进虚拟交换机,学生端一直扫不到课堂,而教师端本机自测却正常
  - 现在先用一次不发包的 UDP connect 问内核「默认路由是哪张网卡」,兜底再按 192.168 / 10 / 172.16 打分,
    把 bonjour 的 bind / addMembership / IP_MULTICAST_IF 全部锁定到这张网卡
  - 可用 `C30_MDNS_INTERFACE` 环境变量现场强制指定网卡;教师端发布日志会打印实际使用的网卡地址

## 0.1.2

### Patch Changes

- 2d50cbd: 修复学生端房间列表堆出「好多个王老师的课堂」

  - 教师端匿名身份改为 localStorage 持久化:渲染层刷新 / HMR 不再生成新的 teacherId,
    服务端因此复用同一间课堂,而不是每刷一次就新建一间
  - 教师端内嵌服务器只服务一间课堂:新建或复用课堂时关闭同进程里的遗留房间,
    房间里的学生收到 session.error 后回到房间列表
  - 学生端新增房间探活:拿到 mDNS 列表后按 host:port 问服务端「这些 roomCode 里哪些还有老师在线」,
    只保留在线的;端点连不上的整段剔除。老师刚断线的 10s 宽限期内不会被误删
  - mDNS 新增 down 事件:教师端停播 / 记录过期时,房间从学生端列表实时移除
  - 学生端点进「课堂不存在 / 已重建」的房间时,该卡片自动从列表摘掉

## 0.1.1

### Patch Changes

- 8aa06e3: 初始化 C30 monorepo 骨架:根配置(pnpm + turbo + changesets)、共享包、NestJS 后端、Electron 双端(vite-electron)、C++ 白板核心、docker-compose 与数据模型。
