// AI 场景练习（A1–A3）。还原对象：`docs/prototype/src/components/AiSceneModal.tsx`。
//
// 🔴 **AI 后端还没接。** 网关的 `/functions/v1/*` 过检代理白名单里现在只有
// `lookup-word` / `explain-reading-word`，没有对话函数（`packages/gateway/functions_blueprint.py`）。
// 所以 `reply()` 现在返回**脚本化的演示回复**，界面必须把这件事说出来（A1 顶部那行提示）。
//
// TODO(P4) 接真模型时要一起做的四件事（都是硬约束，别只换 URL）：
//   1. AI 返回的文本**一律过 msgSecCheck**，在网关做，不在 Edge Function 做
//   2. 限流放 Postgres 不放网关；`cache_key` 必须**去用户化**，否则预生成命中不了
//   3. 对话记录**不写词鲸的 reading_sessions**（那张表是给分级双语短文的，且 RLS 是 owner-all，
//      绑过账号的用户会在 iOS 的「最近的短文」里看到它）。走 hc_ 侧自己的表
//   4. 先加耗时日志测 p95，**>10s 才上任务表 + 轮询**，别一上来就做异步架构

export interface Scenario {
  id: string;
  title: string;
  description: string;
  /** 与首启 S1 的场景标签对齐，用来排序 */
  scene: string;
}

/** 场景选项按首启 S1 勾的场景排序（和词包同一个依据） */
export const SCENARIOS: Scenario[] = [
  { id: 'standup', title: '站会同步进度', description: '昨日产出、今日目标、阻碍卡点', scene: '技术文档' },
  { id: 'email_urgency', title: '邮件催进度', description: '礼貌而坚定地催关键交付节点', scene: '邮件' },
  { id: 'prd_review', title: '需求评审', description: '功能边界、边缘情况与技术可行性', scene: '产品SaaS' },
  { id: 'interview_intro', title: '面试自我介绍', description: '介绍技术栈与关键成就', scene: '通用职场' },
  { id: 'custom', title: '自定义场景…', description: '写下你明天真要开的那个会', scene: '' },
];

/** 单轮对话消耗多少 Credit。明码标价，每一处消耗动作旁边都要标价 */
export const COST_PER_ROUND = 1;

export function sortedScenarios(userScenes: string[]): Scenario[] {
  return SCENARIOS.slice().sort((a, b) => {
    const ai = userScenes.indexOf(a.scene);
    const bi = userScenes.indexOf(b.scene);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

export interface Turn {
  role: 'bot' | 'me';
  text: string;
  /** 反馈句里点评到的目标词 */
  hitWords?: string[];
}

/** 开场白。TODO(P4)：换成模型生成 */
export function opening(scenario: Scenario): string {
  switch (scenario.id) {
    case 'standup':
      return 'Morning. What did you get done yesterday, and what is blocking you today?';
    case 'email_urgency':
      return 'Thanks for the update. Could you tell me where the milestone stands right now?';
    case 'prd_review':
      return "Let's walk through the spec. Which edge cases worry you most?";
    case 'interview_intro':
      return 'Tell me about yourself and the systems you have shipped recently.';
    default:
      return 'Sure, set the scene for me — where are we and who am I?';
  }
}

/**
 * 生成一句回复。**只针对目标词给反馈，不做全句语法批改** ——
 * 那会把练习变成改作业，而且模型也做不准。
 *
 * TODO(P4)：换成 `gw.fn('scene-chat', {...})`，走网关过检。
 */
export function reply(userText: string, targets: string[]): Turn {
  const lower = userText.toLowerCase();
  const hit = targets.filter((w) => lower.indexOf(w.toLowerCase()) >= 0);

  if (hit.length > 0) {
    return {
      role: 'bot',
      text: `Good — 「${hit.join('」「')}」用对了。更自然的说法是 “we managed to ${hit[0]} it before the release”。接着说：接下来你打算怎么推进？`,
      hitWords: hit,
    };
  }
  const suggest = targets[0];
  return {
    role: 'bot',
    text: suggest
      ? `听懂了。这一轮还没用上目标词，试着把「${suggest}」放进去再说一遍？`
      : 'Got it. 再多讲一句细节？',
  };
}

/** 对话里出现、用户没收过的词。TODO(P4)：改成模型标注 + 服务端查词 */
export function suggestNewWords(known: string[]): { term: string; meaning: string; sentence: string }[] {
  const pool = [
    { term: 'backlog', meaning: '积压；待办清单', sentence: 'We still have a backlog from last sprint.' },
    { term: 'milestone', meaning: '里程碑；关键节点', sentence: 'Could you tell me where the milestone stands?' },
    { term: 'edge case', meaning: '边缘情况', sentence: 'Which edge cases worry you most?' },
  ];
  const lower = known.map((w) => w.toLowerCase());
  return pool.filter((w) => lower.indexOf(w.term.toLowerCase()) < 0);
}
