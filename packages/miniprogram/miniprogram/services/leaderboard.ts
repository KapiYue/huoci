// 排行榜与好友 PK（L1–L4）。还原对象：`docs/prototype/src/components/LeaderboardModal.tsx`。
//
// 🔴 **目前是本地假榜 + 本地对战，没有服务端。** P4 才做（`design.md` §3.1）。
// TODO(P4)：`hc_weekly_leaderboard(p_period)` 出榜、`hc_create_pk` / `hc_answer_pk` 走对战，
// 出题改为「优先取双方都学过的词」——现在只能取自己的词，因为对手是假的。
//
// 三条口径（§5.9，原型同）：
//   · 度量单位是**本周新激活的活词数**（= 北极星），不是打卡天数 / 做题量 / 学习时长
//   · 「好友」= **所有用过这个小程序的人**，不依赖微信关系链 ⇒ 实现上就是全站榜，新用户不是空榜
//   · **不显示**段位 / 头衔 / 连胜火苗 / 学习时长

import * as store from './storage';

export interface LeaderRow {
  rank: number;
  id: string;
  displayName: string;
  /** 头像用首字，不拉外部图片：榜单是给陌生人看的，少一个可被追踪的资源 */
  initial: string;
  activatedThisWeek: number;
  isMe?: boolean;
}

/** TODO(P4)：换成 hc_weekly_leaderboard。这里的名字与原型 INITIAL_LEADERBOARD 对齐 */
const MOCK_THIS_WEEK: Omit<LeaderRow, 'rank' | 'initial'>[] = [
  { id: 'u_1', displayName: 'Kap', activatedThisWeek: 12 },
  { id: 'u_2', displayName: '小林', activatedThisWeek: 9 },
  { id: 'u_3', displayName: 'Yue', activatedThisWeek: 7 },
  { id: 'u_5', displayName: 'Alex Chen', activatedThisWeek: 6 },
  { id: 'u_6', displayName: '张架构', activatedThisWeek: 5 },
  { id: 'u_7', displayName: 'Sophie', activatedThisWeek: 4 },
];

const MOCK_LAST_WEEK: Omit<LeaderRow, 'rank' | 'initial'>[] = [
  { id: 'u_2', displayName: '小林', activatedThisWeek: 14 },
  { id: 'u_1', displayName: 'Kap', activatedThisWeek: 11 },
  { id: 'u_5', displayName: 'Alex Chen', activatedThisWeek: 8 },
  { id: 'u_3', displayName: 'Yue', activatedThisWeek: 5 },
];

export type Period = 'thisWeek' | 'lastWeek';

const SK_NOTICE = store.SK.LEADERBOARD_NOTICE;

/** 首次进入排行榜要做一次性告知（说明展示什么、可以关）。这是隐私要求，不是可选交互。 */
export function noticeShown(): boolean {
  return store.read<boolean>(SK_NOTICE, false);
}

export function markNoticeShown(): void {
  store.write(SK_NOTICE, true);
}

function initialOf(name: string): string {
  return name ? name.slice(0, 1).toUpperCase() : '?';
}

/** 把我插进榜里排好序。我自己那一行同时固定在底部（页面负责），即使已经在榜内。 */
export function board(period: Period, me: { name: string; activatedThisWeek: number }): {
  rows: LeaderRow[];
  mine: LeaderRow;
} {
  const base = period === 'thisWeek' ? MOCK_THIS_WEEK : MOCK_LAST_WEEK;
  const merged = base
    .concat([{ id: 'me', displayName: me.name, activatedThisWeek: me.activatedThisWeek }])
    .sort((a, b) => b.activatedThisWeek - a.activatedThisWeek);

  const rows = merged.map((r, i) => ({
    ...r,
    rank: i + 1,
    initial: initialOf(r.displayName),
    isMe: r.id === 'me',
  }));

  return { rows, mine: rows.find((r) => r.isMe) as LeaderRow };
}

// ---------------- PK 出题 ----------------

export interface Question {
  term: string;
  /** 正确释义在 options 里的下标 */
  answer: number;
  options: string[];
}

export const PK_QUESTIONS = 10;
export const PK_SECONDS = 10;

/** 兜底题库：用户词不足 4 个时用它，否则凑不出四选一 */
const FALLBACK: { term: string; meaning: string }[] = [
  { term: 'mitigate', meaning: '缓解；减轻' },
  { term: 'deploy', meaning: '部署；发布' },
  { term: 'latency', meaning: '延迟；响应耗时' },
  { term: 'retention', meaning: '留存；用户留存' },
  { term: 'churn', meaning: '流失；客户流失' },
  { term: 'align', meaning: '对齐；达成共识' },
  { term: 'blocker', meaning: '阻碍项；卡点' },
  { term: 'throughput', meaning: '吞吐量' },
  { term: 'ambiguous', meaning: '模棱两可的' },
  { term: 'persist', meaning: '坚持；持续存在' },
  { term: 'crucial', meaning: '关键的' },
  { term: 'workaround', meaning: '变通方案' },
];

function shuffle<T>(a: T[]): T[] {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

/**
 * 出 10 道「看词选释义，四选一」。
 * ⚠️ **四选一只出现在 PK 里**：日常学习流是三档自评，不许把选择题混进去（§5.5）。
 */
export function buildQuestions(pool: { term: string; meaning: string }[]): Question[] {
  const clean = pool.filter((w) => w.term && w.meaning);
  const source = clean.length >= 4 ? clean : clean.concat(FALLBACK);
  const picked = shuffle(source).slice(0, PK_QUESTIONS);

  return picked.map((w) => {
    const distractors = shuffle(source.filter((x) => x.meaning !== w.meaning))
      .slice(0, 3)
      .map((x) => x.meaning);
    const options = shuffle([w.meaning].concat(distractors));
    return { term: w.term, answer: options.indexOf(w.meaning), options };
  });
}
