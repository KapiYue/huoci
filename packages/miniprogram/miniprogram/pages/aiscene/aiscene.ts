// AI 场景练习 A1–A3。还原对象：`docs/prototype/src/components/AiSceneModal.tsx`。
//
// 🔴 AI 后端未接（见 services/aiscene.ts 抬头的四条 TODO）。这一页把三屏的交互、
//    计费口径与取词链路都跑通了，接真模型时只换 services 里的 reply()。
//
// A3 是 **capture 的第三个来源**（前两个是 Chrome 扩展、阅读器）：
// 收进来的词原句 = 对话里那句，来源写「AI 场景 · <场景名>」，与扩展 / 阅读器的结构同构。

import * as ai from '../../services/aiscene';
import * as membership from '../../services/membership';
import * as wordsSvc from '../../services/words';
import * as lookup from '../../services/lookup';
import * as onboarding from '../../services/onboarding';
import * as learning from '../../services/learning';
import * as theme from '../../services/theme';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import type { Scenario, Turn } from '../../services/aiscene';

interface TurnVM extends Turn { key: string }
interface PoolItem { term: string; on: boolean }
interface UsageRow { term: string; times: number }
interface NewWordVM { term: string; meaning: string; sentence: string; added: boolean }

const EMPTY_SCENARIO: Scenario = { id: '', title: '', description: '', scene: '' };

Page({
  data: {
    themeClass: '',
    stage: 'setup' as 'setup' | 'generating' | 'chat' | 'summary',
    credits: 0,
    cost: ai.COST_PER_ROUND,

    // A1
    wordSource: 'review' as 'review' | 'custom',
    reviewCount: 0,
    pool: [] as PoolItem[],
    scenarios: [] as Scenario[],
    scenarioId: '',
    scenario: EMPTY_SCENARIO,
    customText: '',

    // A2
    targets: [] as string[],
    targetLine: '',
    folded: false,
    turns: [] as TurnVM[],
    draft: '',
    anchor: 'bottom',
    usedCount: 0,

    // A3
    usage: [] as UsageRow[],
    newWords: [] as NewWordVM[],

    exitConfirm: false,
  },

  _used: {} as Record<string, number>,
  _genTimer: 0 as number,

  onShow() {
    theme.apply(this);
    this.setData({ credits: membership.get().credits });
  },

  onLoad() {
    const scenes = onboarding.selectedScenes();
    const scenarios = ai.sortedScenarios(scenes);
    this.setData({
      scenarios,
      scenarioId: scenarios[0] ? scenarios[0].id : '',
      scenario: scenarios[0] || EMPTY_SCENARIO,
    });
    void this.loadPool();
  },

  onUnload() {
    if (this._genTimer) clearTimeout(this._genTimer);
    // 还在「生成中」就被退出：那 1 Credit 得退回去，用户没拿到任何东西
    if (this.data.stage === 'generating') membership.addCredits(this.data.cost);
  },

  /** 默认词源是复习队列，不是空白多选框 */
  async loadPool() {
    const [queue, recent] = await Promise.all([
      learning.fetchStudyQueue(20).catch(() => ({ data: [], stale: true })),
      wordsSvc.fetchWords('recent').catch(() => ({ data: [], stale: true })),
    ]);
    const due = queue.data.map((c) => c.term);
    const all = recent.data.map((c) => c.term);
    const merged = due.concat(all.filter((t) => due.indexOf(t) < 0));
    this.setData({
      reviewCount: due.length,
      pool: merged.slice(0, 20).map((term) => ({ term, on: due.indexOf(term) >= 0 })),
    });
  },

  // ---------------- A1 ----------------

  pickSource(e: WechatMiniprogram.BaseEvent) {
    this.setData({ wordSource: e.currentTarget.dataset.v as 'review' | 'custom' });
  },

  toggleWord(e: WechatMiniprogram.BaseEvent) {
    const t = e.currentTarget.dataset.t as string;
    this.setData({ pool: this.data.pool.map((p) => (p.term === t ? { ...p, on: !p.on } : p)) });
  },

  pickScenario(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    const scenario = this.data.scenarios.find((s) => s.id === id);
    if (scenario) this.setData({ scenarioId: id, scenario });
  },

  onCustom(e: WechatMiniprogram.Input) {
    this.setData({ customText: e.detail.value });
  },

  openVip() {
    wx.navigateTo({ url: '/pages/vip/vip' });
  },

  generate() {
    const targets = this.data.pool.filter((p) => p.on).map((p) => p.term).slice(0, 5);
    if (targets.length === 0) {
      wx.showToast({ title: '先挑几个词，或者切回「本周待复习」', icon: 'none' });
      return;
    }
    // 明码标价：这里就是那 1 Credit 扣掉的地方
    const after = membership.spend(this.data.cost);
    if (!after) {
      this.openVip();
      return;
    }

    const scenario = this.data.scenario;
    this._used = {};
    this.setData({ stage: 'generating', credits: after.credits, targets, targetLine: targets.join(' · ') });
    tracker.track(EV.AI_SCENE_STARTED, { scenario: scenario.id, words: targets.length });

    this._genTimer = setTimeout(() => {
      this.setData({
        stage: 'chat',
        turns: [{ key: 't0', role: 'bot', text: ai.opening(scenario) }],
        usedCount: 0,
      });
    }, 1200) as unknown as number;
  },

  cancelGenerate() {
    if (this._genTimer) clearTimeout(this._genTimer);
    // 取消发生在扣费之后：把这一次退回去，别让用户为一个没开始的场景付钱
    const m = membership.addCredits(this.data.cost);
    this.setData({ stage: 'setup', credits: m.credits });
  },

  // ---------------- A2 ----------------

  toggleFold() {
    this.setData({ folded: !this.data.folded });
  },

  onDraft(e: WechatMiniprogram.Input) {
    this.setData({ draft: e.detail.value });
  },

  send() {
    const text = this.data.draft.trim();
    if (!text) return;
    const turns = this.data.turns.slice();
    turns.push({ key: `u${turns.length}`, role: 'me', text });

    const bot = ai.reply(text, this.data.targets);
    turns.push({ key: `b${turns.length}`, role: 'bot', text: bot.text, hitWords: bot.hitWords });

    (bot.hitWords || []).forEach((w) => {
      this._used[w] = (this._used[w] || 0) + 1;
    });

    tracker.track(EV.AI_SCENE_TURN, { scenario: this.data.scenarioId, hit: (bot.hitWords || []).length });
    this.setData({
      turns,
      draft: '',
      usedCount: Object.keys(this._used).length,
      anchor: 'bottom',
    });
  },

  tryFinish() {
    this.setData({ exitConfirm: true });
  },

  cancelExit() {
    this.setData({ exitConfirm: false });
  },

  confirmExit() {
    const known = this.data.pool.map((p) => p.term);
    this.setData({
      exitConfirm: false,
      stage: 'summary',
      usage: this.data.targets.map((term) => ({ term, times: this._used[term] || 0 })),
      newWords: ai.suggestNewWords(known).map((w) => ({ ...w, added: false })),
    });
    tracker.track(EV.AI_SCENE_FINISHED, {
      scenario: this.data.scenarioId,
      used: this.data.usedCount,
      turns: this.data.turns.length,
    });
  },

  // ---------------- A3 ----------------

  /**
   * capture 的第三个来源。**必须带 source_title**，否则 S6 会把它推导成「首启添加」
   * （判据是「无 first_context 且无 first_source_*」）。
   */
  async capture(e: WechatMiniprogram.BaseEvent) {
    const term = e.currentTarget.dataset.t as string;
    const item = this.data.newWords.find((w) => w.term === term);
    if (!item || item.added) return;
    try {
      // 先查词拿释义与音标，再带着「原句 + 来源」入库 —— 与查词页、阅读器同一条链路
      const r = await lookup.lookup(item.term);
      await lookup.addWord(r, {
        sourceTitle: `AI 场景 · ${this.data.scenario.title}`,
        context: item.sentence,
      });
      tracker.track(EV.CAPTURE_CREATED, { source: 'ai_scene', term });
      this.setData({ newWords: this.data.newWords.map((w) => (w.term === term ? { ...w, added: true } : w)) });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '没能收进来', icon: 'none' });
    }
  },

  again() {
    if (membership.get().credits < this.data.cost) {
      this.openVip();
      return;
    }
    this.setData({ stage: 'setup' });
  },

  done() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/today/today' }) });
  },

  noop() { /* 挡住蒙层后面的滚动 */ },
});
