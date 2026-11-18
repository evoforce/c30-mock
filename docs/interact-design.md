# 课堂互动设计(随机点名 / 抢答 / 举手 / 投票 / 观点云 / 计时)

> 结论:底部工具条的「互动」从「点了没反应的按钮」升级为**一块真实的课堂互动面板**。
> 老师在教师端点一下,学生端立刻出现对应入口;学生的作答 / 抢答 / 举手会实时回到教师端。
> 状态由教师端内嵌课堂服务器统一维护,**所有数字都来自服务端快照**,不是前端演示数据。

## 一、C30 的互动板块长什么样(调研)

C30(沐坤科技 C30 教育云 / 授课助手)的「互动」是一组课堂工具,公开资料里反复出现的是:

| 能力 | 公开资料中的描述 | 本版是否实现 |
|---|---|---|
| 随机点名 | 「观点云、实时投票、随机点名、抢答等互动功能」;学生端介绍里的「随机抢答」 | ✅ |
| 抢答 | 学生点「抢答」,按先后排序;老师据此点名回答 | ✅ |
| 举手 | 学生端常驻「举手」,老师端查看名单 | ✅ |
| 实时投票 | 选项投票,教师端实时看到票数/占比 | ✅ |
| 观点云 | 学生提交一句话观点,教师端聚合成词云 | ✅ |
| 计时 | 限时练 / 小组讨论的课堂计时 | ✅ |
| 互动答题 / 限时练 | 题库选题、限时作答、正确率统计 | ⏳ 需要题库与题型,后续做 |
| 扫码传图 | 学生扫码把作业/草稿照片传到教师端 | ⏳ 需要二维码与上传通道 |
| 投屏讲解 / 小组投屏 | 学生端投屏到大屏 | ⏳ 依赖屏幕采集(见 student-client-redesign) |
| 锁屏 / 设备管控 | 上课期间管控学生机 | ⏳ 属于主进程能力 |

参考:

- [C30 教育云赋能教学(公众号文章)](http://mp.weixin.qq.com/s?__biz=MzAxOTA4OTM4Ng==&mid=2658938018&idx=2&sn=1b609bac1481057f716af0a0c5101dae):
  提到「观点云、实时投票、随机点名、抢答」「限时训、不同层级的互动题型」「计时、扫码传图」。
- [C30 学生端 App Store 页面](https://apps.apple.com/cn/app/c30%E5%AD%A6%E7%94%9F%E7%AB%AF/id1469687292):
  「互动答题 / 动态交互 / 投屏讲解 / 广播分享 / 随机抢答」。
- [C30 智能教学操作系统使用手册(PDF)](https://file.icve.com.cn/ssykt/362/322/5AB50A569F93573CEB0A81356E554628.pdf):
  「互动」支持网络互动与局域网互动、学生作答一键投屏。

本版先把**不依赖题库/文件/屏幕采集**的六种互动做完整,每一种都在学生端有真实入口与回执。

## 二、功能与两端的交互

| 互动 | 教师端 | 学生端 |
|---|---|---|
| 随机点名 | 点一下立即从在线学生里抽人;显示姓名、是否已确认;可「换一个」 | 被点到的学生弹卡片「老师点到你啦」+「我知道了」;其他学生顶部提示「老师正在点名:XXX」 |
| 抢答 | 选 15/30/60 秒或不限时 → 发起;实时名次(第 1 名高亮) | 大号「抢答」按钮 + 倒计时;点完立刻显示「第 N 名」;其他人看到谁先抢到 |
| 举手 | 互动按钮上的红点数字 = 举手人数;标题栏「✋ n」展开名单,可一键全部放下 | 右下角常驻「举手 / 已举手」按钮,随时举起/放下,课上不受当前互动影响 |
| 投票 | 填题目 + 2~6 个选项 + 限时 → 发起;实时柱状图(票数/占比/已投/未投) | 屏幕中间卡片显示题目与选项,点选即投票(可改票),实时看到票数 |
| 观点云 | 填话题 → 发起;实时词云(同观点合并、按热度放大)+ 条数 | 输入一句话(≤30 字)提交,可修改后重新提交 |
| 计时 | 1/3/5/10 分钟 → 开始;面板大号倒计时 | 屏幕顶部倒计时胶囊,与教师端同步 |

公共约定:

- 互动进行中时,教师端面板自动从「功能菜单」切到「结果页」;结束后保留结果供讲评,点「关闭结果」才清空。
- 限时互动到点由服务端自动结束(`endedAt` 落章),两端同时变「已结束」,不依赖某个页面还开着。
- 下课后服务端清空互动与举手;学生端回到等待页,不会残留上一节课的投票。

## 三、协议(`packages/shared/src/interact.ts`)

服务端是唯一真源。客户端只发「意图」,收到的永远是**完整快照**,因此学生迟进课堂、
断线重连、教师端 HMR 重载都不会出现「两端状态对不上」。

```ts
// 服务端 → 全员
interact.state : InteractSnapshot {
  roomCode, enabled,
  session: { id, kind, question, options, startedAt, endsAt, endedAt } | null,
  responses: [{ userId, name, optionIds, text, ts }],
  hands: [{ userId, name, ts }],
  picked: { userId, name, ts } | null,
  buzzOrder: string[],
}
interact.error : { message }          // 老师端的操作错误(未上课/没有学生/选项不够…)

// 教师端 → 服务端
interact.start   { roomCode, request: { kind, question?, options?, durationSec? } }
interact.end     { roomCode }          // 结束当前互动,保留结果
interact.reset   { roomCode }          // 关闭结果(举手名单保留)
interact.pick    { roomCode }          // 随机点名换一个
interact.hands.clear { roomCode }

// 学生端 → 服务端
interact.respond { roomCode, sessionId, optionIds?, text? }
interact.hand    { roomCode, raised }
interact.sync    { roomCode }          // 面板挂载时补拉一次快照
```

服务端规则:

1. 只有教师 socket 能 `start / end / reset / pick / hands.clear`;学生发起会被直接忽略。
2. 必须 `class.active === true` 才能发起互动(课前/课后学生还在等待页)。
3. `interactEnabled === false` 时拒绝发起,并清空进行中的互动与举手(设置里的「允许互动」总开关)。
4. 投票只接受本场 `session.options` 里的选项 id,单选、可改票;观点云 30 字截断;重复提交按覆盖处理。
5. 抢答只认第一次点击,后续点击不改变名次。
6. 随机点名只会抽 `role === 'STUDENT'` 的在线成员;多人时尽量避开上一次点到的人。
7. 学生掉线时同步移出举手名单;`class.end` 清空全部互动状态。

统计函数放在 shared(`tallyPoll` / `tallyCloud`),教师端与学生端用同一份实现,
票数、百分比、词频不会两边算出不同结果。

## 四、实现位置

| 文件 | 作用 |
|---|---|
| `packages/shared/src/interact.ts` | 协议类型、快照结构、投票/词云统计 |
| `packages/shared/src/whiteboard.ts` | `InteractionControl` 增加 `interactEnabled`(原 `quizEnabled` 收敛为课堂互动总开关) |
| `apps/teacher/src/main/localSessionServer.ts` | 房间级互动状态机、权限校验、限时自动结束、迟到补拉 |
| `apps/teacher/src/renderer/src/hooks/useInteract.ts` | 教师端互动控制器(发意图 + 收快照) |
| `apps/teacher/src/renderer/src/components/InteractPanel.tsx` | 互动面板:功能菜单 / 配置页 / 结果页 |
| `apps/teacher/src/renderer/src/components/FloatingDock.tsx` | 「互动」按钮改为展开面板 + 举手/进行中角标 |
| `apps/student/src/renderer/src/hooks/useInteract.ts` | 学生端快照订阅与作答 |
| `apps/student/src/renderer/src/components/StudentInteract.tsx` | 举手按钮 + 点名/抢答/投票/观点云卡片 + 计时胶囊 |

## 五、验证(2026-11-19 真机)

- `pnpm --filter @c30/shared lint`、`@c30/teacher lint`、`@c30/student lint`:0 错;
- `pnpm --filter @c30/teacher build`、`@c30/student build`:electron-vite 三端产物构建通过;
- 两台客户端同机联调(教师端 + 学生端,mDNS 发现后直连):

| 场景 | 结果 |
|---|---|
| 投票 | 老师发起 → 学生端立刻出现题目 → 学生投「岩浆岩」→ 教师端 `1 票 · 100%`、已投 1 未投 0 → 结束投票两端同步「已结束」 |
| 抢答 | 学生点击 → 学生端「第 1 名」,教师端名次表出现「学生 · 抢到」;15 秒到点自动结束 |
| 随机点名 | 学生端弹「老师点到你啦」→ 点「我知道了」→ 教师端变「学生已确认,请起立回答」 |
| 观点云 | 学生提交「按需调整」→ 教师端词云出现该词、`共 1 条观点` |
| 计时 | 两端同步 `03:00` 倒计时,可提前结束 |
| 举手 | 学生举手 → 教师端互动按钮红点 `1` + 举手名单出现姓名;放下后归零 |
| 迟到学生 | 投票进行中才启动学生端并进课堂 → 立刻看到当前题目(靠 `interact.sync` 补拉) |
| 关闭「允许互动」 | 服务端清空互动,学生端举手/互动入口消失;重新打开后恢复;设置持久化到 `settings.json` |
| 假学生(直连 socket) | 学生无权 `interact.start`(被忽略);投票可被服务端统计;掉线后举手/成员同步清理 |

## 六、后续

1. **互动答题 / 限时练**:在 poll 上增加 `correctOptionId` 与题库来源,结果页给正确率与逐题分布(需要题库)。
2. **扫码传图**:教师端出二维码 → 学生端上传图片 → 教师端审阅后一键插入白板。
3. **分组讨论 / 小组投屏**:依赖成员分组与屏幕采集管线。
4. **结果留存**:把互动结果写入课后报告(当前只存在内存,`class.end` 即清空)。
