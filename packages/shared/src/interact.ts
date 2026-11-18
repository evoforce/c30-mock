// 课堂互动协议(教师端 / 学生端共用)
//
// 参照 C30 授课助手的互动板块:随机点名、抢答、举手、实时投票、观点云、计时。
// 设计原则:
//   · 服务端(教师端内嵌 localSessionServer)是唯一真源,所有互动状态都存在房间里;
//   · 客户端只发「意图」(start / respond / hand / end),收到的永远是完整快照
//     `InteractSnapshot` —— 学生中途重连 / 迟进课堂也能立刻看到进行中的互动;
//   · 教师端与学生端共用同一份统计函数(tallyPoll / tallyCloud),两边的票数、词频不会打架。

/** 互动类型 */
export type InteractKind =
  | 'rollcall' // 随机点名
  | 'buzz' // 抢答
  | 'poll' // 实时投票
  | 'cloud' // 观点云
  | 'timer'; // 课堂计时

/** 投票选项(服务端生成稳定 id,学生按 id 投票) */
export interface InteractOption {
  id: string;
  label: string;
}

/** 一次互动(进行中或已结束) */
export interface InteractSession {
  id: string;
  kind: InteractKind;
  /** 题目 / 话题 / 计时说明 */
  question: string;
  /** 投票选项(其余互动为空数组) */
  options: InteractOption[];
  startedAt: number;
  /** 截止时间戳(ms);null = 不限时,由老师手动结束 */
  endsAt: number | null;
  /** 老师结束互动的时间;null = 进行中 */
  endedAt: number | null;
}

/** 学生的一次响应(投票选票 / 观点云文本 / 点名确认) */
export interface InteractResponse {
  userId: string;
  name: string;
  /** 投票选中的选项 id(单选用一个元素) */
  optionIds: string[];
  /** 观点云文本;随机点名的确认标记固定为 'ack' */
  text: string;
  ts: number;
}

/** 举手的同学 */
export interface RaisedHand {
  userId: string;
  name: string;
  ts: number;
}

/** 随机点名点到的同学 */
export interface PickedStudent {
  userId: string;
  name: string;
  ts: number;
}

/**
 * 互动完整快照(服务端 → 全员)。
 * 学生端用 userId 匹配自己的响应,教师端直接按快照渲染结果。
 */
export interface InteractSnapshot {
  roomCode: string;
  /** 教师端「允许互动」总开关;关闭时学生端不显示任何互动入口 */
  enabled: boolean;
  session: InteractSession | null;
  responses: InteractResponse[];
  /** 举手名单(按举手时间升序) */
  hands: RaisedHand[];
  /** 随机点名结果 */
  picked: PickedStudent | null;
  /** 抢答顺序(userId 数组,第 1 个 = 抢到的人) */
  buzzOrder: string[];
}

/** 老师发起互动的请求(服务端补 id / 时间戳 / 点名结果) */
export interface InteractStartRequest {
  kind: InteractKind;
  question?: string;
  /** 选项文案;服务端生成 id */
  options?: string[];
  /** 限时秒数;null/缺省 = 不限时 */
  durationSec?: number | null;
}

// ---- 客户端 → 服务端(socket.io 事件名即 type,便于排查) ----
export type InteractClientEvent =
  | { type: 'interact.start'; payload: { roomCode: string; request: InteractStartRequest } }
  | {
      type: 'interact.respond';
      payload: { roomCode: string; sessionId: string; optionIds?: string[]; text?: string };
    }
  | { type: 'interact.end'; payload: { roomCode: string } }
  | { type: 'interact.reset'; payload: { roomCode: string } }
  | { type: 'interact.pick'; payload: { roomCode: string } }
  | { type: 'interact.hand'; payload: { roomCode: string; raised: boolean } }
  | { type: 'interact.hands.clear'; payload: { roomCode: string } };

// ---- 服务端 → 客户端 ----
export type InteractServerEvent =
  | { type: 'interact.state'; payload: InteractSnapshot }
  | { type: 'interact.error'; payload: { message: string } };

// ---- 两端口径一致的统计 ----

export interface PollTally {
  option: InteractOption;
  count: number;
  /** 占已投票人数的比例(0~1) */
  ratio: number;
  voters: string[];
}

/** 统计投票结果:每个选项的票数、占比与投票人 */
export function tallyPoll(session: InteractSession | null, responses: InteractResponse[]): PollTally[] {
  if (!session) return [];
  const votes = responses.filter((r) => r.optionIds.length > 0);
  return session.options.map((option) => {
    const voters = votes.filter((r) => r.optionIds.includes(option.id)).map((r) => r.name);
    return {
      option,
      count: voters.length,
      ratio: votes.length > 0 ? voters.length / votes.length : 0,
      voters,
    };
  });
}

export interface CloudWord {
  text: string;
  count: number;
}

/** 汇总观点云:相同文本合并计数,按出现次数降序(次数相同按首次提交时间) */
export function tallyCloud(responses: InteractResponse[]): CloudWord[] {
  const order = new Map<string, { count: number; first: number }>();
  for (const r of responses) {
    const text = r.text.trim();
    if (!text) continue;
    const hit = order.get(text);
    if (hit) hit.count += 1;
    else order.set(text, { count: 1, first: r.ts });
  }
  return [...order.entries()]
    .map(([text, v]) => ({ text, count: v.count, first: v.first }))
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .map(({ text, count }) => ({ text, count }));
}
