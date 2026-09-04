// 词包（tabbar 第 5 项，W1–W3）。还原对象：`docs/prototype/src/components/WordPacksTab.tsx`。
//
// 🔴 **目前是本地词包目录 + 本地订阅状态，没有服务端。** P4 才做后端（`design.md` §3.1）。
// 现在这份 catalog 与原型 `data/initialData.ts` 的 INITIAL_WORDPACKS 一一对应，
// 订阅状态存本地。TODO(P4)：catalog 走 `hc_list_packs`，订阅走 `hc_subscribe_pack`。
//
// 三条硬约束（§5.10，原型也是这么画的）：
//   · **不做词包商城、不做付费词包** —— 付费只买 Credits
//   · 应试包**只给词表**，不做题库 / 模考 / 考纲进度
//   · 用户自建词包**不做公开广场**，只能点对点转发

import * as store from './storage';

export type PackCategory = 'recommended' | 'exam' | 'custom';
export type PackWordStatus = 'activated' | 'learning' | 'unlearned';

export interface PackWord {
  spelling: string;
  meaning: string;
  status: PackWordStatus;
}

export interface WordPack {
  id: string;
  title: string;
  description: string;
  category: PackCategory;
  totalWords: number;
  activatedWords: number;
  unlearnedWords: number;
  /** 「推荐给你」按首启 S1 勾的场景出，不是随机推。空数组 = 不参与场景推荐 */
  scenes: string[];
  words: PackWord[];
}

/** TODO(P4)：换成服务端目录 */
const CATALOG: WordPack[] = [
  {
    id: 'pack_saas',
    title: '产品 SaaS 常用词',
    description: 'B2B/B2C SaaS 产研日常高频业务术语与指标词',
    category: 'recommended',
    totalWords: 312,
    activatedWords: 87,
    unlearnedWords: 180,
    scenes: ['产品SaaS'],
    words: [
      { spelling: 'churn', meaning: '流失；客户流失率', status: 'activated' },
      { spelling: 'retention', meaning: '留存；用户留存', status: 'learning' },
      { spelling: 'onboarding', meaning: '新手引导；入职流程', status: 'unlearned' },
      { spelling: 'conversion', meaning: '转化；转化率', status: 'learning' },
      { spelling: 'funnel', meaning: '漏斗；转化漏斗', status: 'activated' },
      { spelling: 'cohort', meaning: '同质群；分群分析', status: 'unlearned' },
      { spelling: 'monetization', meaning: '变现；商业化', status: 'unlearned' },
      { spelling: 'runway', meaning: '现金流跑道；运营储备期', status: 'unlearned' },
    ],
  },
  {
    id: 'pack_tech_docs',
    title: '技术文档核心词',
    description: '涵盖架构、网络、API、DevOps 与高可用设计',
    category: 'recommended',
    totalWords: 480,
    activatedWords: 42,
    unlearnedWords: 360,
    scenes: ['技术文档', 'GitHub'],
    words: [
      { spelling: 'mitigate', meaning: '缓解；减轻（风险/故障）', status: 'learning' },
      { spelling: 'deploy', meaning: '部署；配置服务', status: 'activated' },
      { spelling: 'latency', meaning: '延迟；往返响应耗时', status: 'learning' },
      { spelling: 'idempotent', meaning: '幂等的；多次执行结果相同', status: 'unlearned' },
      { spelling: 'throughput', meaning: '吞吐量；单位时间处理能力', status: 'unlearned' },
    ],
  },
  {
    id: 'pack_meeting_email',
    title: '邮件与会议',
    description: '跨国团队异步协作、站会汇报与邮件往来必备',
    category: 'recommended',
    totalWords: 260,
    activatedWords: 19,
    unlearnedWords: 210,
    scenes: ['邮件', '会议'],
    words: [
      { spelling: 'align', meaning: '对齐；达成共识', status: 'activated' },
      { spelling: 'sync', meaning: '同步；开会同步进度', status: 'activated' },
      { spelling: 'blocker', meaning: '阻碍项；导致卡点的问题', status: 'learning' },
      { spelling: 'actionable', meaning: '可执行的；具备可落地方案的', status: 'unlearned' },
    ],
  },
  {
    id: 'pack_cet4',
    title: '大学英语四级（CET-4）',
    description: '核心词表清单（纯生词表，不含题目模考）',
    category: 'exam',
    totalWords: 2400,
    activatedWords: 68,
    unlearnedWords: 2150,
    scenes: [],
    words: [
      { spelling: 'acquire', meaning: '获得；习得', status: 'activated' },
      { spelling: 'crucial', meaning: '关键的；至关重要的', status: 'learning' },
      { spelling: 'persist', meaning: '坚持；持续存在', status: 'unlearned' },
    ],
  },
  {
    id: 'pack_cet6',
    title: '大学英语六级（CET-6）',
    description: '高频学术与思辨词汇清单',
    category: 'exam',
    totalWords: 2100,
    activatedWords: 35,
    unlearnedWords: 1980,
    scenes: [],
    words: [
      { spelling: 'ambiguous', meaning: '模棱两可的；含糊不清的', status: 'learning' },
      { spelling: 'scrutinize', meaning: '仔细审查；彻底核实', status: 'unlearned' },
    ],
  },
  {
    id: 'pack_custom_github',
    title: '从 GitHub 收的词',
    description: '平时在 PR / Issue / Release Notes 撞见标记的生词',
    category: 'custom',
    totalWords: 23,
    activatedWords: 9,
    unlearnedWords: 11,
    scenes: [],
    words: [
      { spelling: 'implement', meaning: '实施；实现功能', status: 'activated' },
      { spelling: 'deprecated', meaning: '已废弃的；不赞成使用的', status: 'learning' },
      { spelling: 'workaround', meaning: '变通方案；临时替代办法', status: 'learning' },
    ],
  },
];

interface PackState {
  /** 已加入的包 id */
  subscribed: string[];
  /** 用户自建的包（点对点转发，不进广场） */
  custom: WordPack[];
}

const DEFAULT_STATE: PackState = { subscribed: ['pack_saas', 'pack_custom_github'], custom: [] };

function state(): PackState {
  return { ...DEFAULT_STATE, ...store.read<Partial<PackState>>(store.SK.WORDPACKS, {}) };
}

function saveState(s: PackState): void {
  store.write(store.SK.WORDPACKS, s);
}

export function all(): WordPack[] {
  return CATALOG.concat(state().custom);
}

export function find(id: string): WordPack | undefined {
  return all().find((p) => p.id === id);
}

export function isSubscribed(id: string): boolean {
  return state().subscribed.indexOf(id) >= 0;
}

export function subscribed(): WordPack[] {
  const s = state();
  return all().filter((p) => s.subscribed.indexOf(p.id) >= 0);
}

/**
 * 「推荐给你」按首启 S1 勾的场景出 —— S1 那一屏此前只用于埋点，词包上线后它第一次真正影响界面。
 * 一个场景都没勾中时**不返回空**，退回全部未订阅的推荐包，否则新用户看到的是一片空白。
 */
export function recommended(scenes: string[]): WordPack[] {
  const s = state();
  const pool = CATALOG.filter((p) => p.category === 'recommended' && s.subscribed.indexOf(p.id) < 0);
  const hit = pool.filter((p) => p.scenes.some((x) => scenes.indexOf(x) >= 0));
  return hit.length > 0 ? hit : pool;
}

export function exams(): WordPack[] {
  return CATALOG.filter((p) => p.category === 'exam');
}

export function customs(): WordPack[] {
  const s = state();
  return all().filter((p) => p.category === 'custom' && s.subscribed.indexOf(p.id) >= 0);
}

export function subscribe(id: string): void {
  const s = state();
  if (s.subscribed.indexOf(id) < 0) saveState({ ...s, subscribed: s.subscribed.concat(id) });
}

/** 移除只解订阅，**已经学过的词留在生词本里不动** —— 二次确认文案里写死了这句 */
export function unsubscribe(id: string): void {
  const s = state();
  saveState({ ...s, subscribed: s.subscribed.filter((x) => x !== id) });
}

export function createCustom(title: string): WordPack {
  const s = state();
  const pack: WordPack = {
    id: `pack_custom_${Date.now()}`,
    title,
    description: '你自己建的词包',
    category: 'custom',
    totalWords: 0,
    activatedWords: 0,
    unlearnedWords: 0,
    scenes: [],
    words: [],
  };
  saveState({ ...s, custom: s.custom.concat(pack), subscribed: s.subscribed.concat(pack.id) });
  return pack;
}
