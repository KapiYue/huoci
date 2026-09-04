// 阅读器 R1–R4。还原对象：`docs/prototype/src/components/ReaderModal.tsx`；规格 `design.md` §5.7。
//
// 四条实现约束（都踩过坑，别改）：
//   1. `textarea` 的 maxlength 默认是 **140**，必须显式写 maxlength="-1"（在 wxml 里）
//   2. 切词一次写进 data，点词只改 `pickedIndex`，**不重建数组**（§14.3）
//   3. 每个 token 记住自己属于第几句 —— 释义接口的入参是 {word, sentence}
//   4. **正文不上传**；云端只写「词 + 原句 + 来源 + 时间」（走 save_word 的 context/source_*）

import * as reader from '../../services/reader';
import * as lookup from '../../services/lookup';
import * as theme from '../../services/theme';
import * as tracker from '../../services/tracker';
import * as wordsSvc from '../../services/words';
import { EV } from '../../shared/events';
import type { Token } from '../../services/reader';

interface TokenVM extends Token { hit: boolean }
interface Picked {
  term: string;
  phonetic: string;
  meaning: string;
  sentence: string;
  loading: boolean;
  saving: boolean;
  saved: boolean;
  error: string;
}

const EMPTY_PICKED: Picked = {
  term: '', phonetic: '', meaning: '', sentence: '',
  loading: false, saving: false, saved: false, error: '',
};

function ago(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

Page({
  data: {
    themeClass: '',
    stage: 'paste' as 'paste' | 'read' | 'done',
    max: reader.MAX_CHARS,
    text: '',
    title: '',
    overflow: false,
    last: null as { title: string; capturedCount: number; ago: string } | null,

    tokens: [] as TokenVM[],
    capturedCount: 0,
    captured: [] as { term: string; meaning: string }[],
    showOnceTip: false,

    popup: false,
    picked: EMPTY_PICKED,
  },

  _sentences: [] as string[],
  _pickedIndex: -1,
  /** 已经在活词库里的词（小写）。进阅读器时拉一次，用来画高亮 */
  _known: {} as Record<string, boolean>,
  /** 上一次查词的完整结果。收词直接用它，**不再查第二次** ——
   *  lookup-word 未命中词典时要过一次 AI，第二次往返是实打实的钱和 3 秒 */
  _lastResult: null as lookup.LookupResult | null,

  onLoad() {
    const last = reader.lastReading();
    if (last) {
      this.setData({ last: { title: last.title || '未命名来源', capturedCount: last.capturedCount, ago: ago(last.at) } });
    }
    void this.loadKnown();
  },

  onShow() {
    theme.apply(this);
  },

  async loadKnown() {
    const res = await wordsSvc.fetchWords('recent').catch(() => ({ data: [], stale: true }));
    const map: Record<string, boolean> = {};
    res.data.forEach((w) => {
      map[w.term.toLowerCase()] = true;
    });
    this._known = map;
  },

  // ---------------- R1 ----------------

  onText(e: WechatMiniprogram.Input) {
    const v = e.detail.value;
    this.setData({ text: v, overflow: v.length > reader.MAX_CHARS });
  },

  onTitle(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value });
  },

  resumeLast() {
    const last = reader.lastReading();
    if (!last) return;
    this.setData({ text: last.text, title: last.title });
    this.start();
  },

  start() {
    const raw = this.data.text;
    if (!raw) return;
    // 超长提示截断，**不静默丢**：上面的计数条已经说了，这里照做
    const text = raw.slice(0, reader.MAX_CHARS);
    const { tokens, sentences } = reader.tokenize(text);
    this._sentences = sentences;

    this.setData({
      stage: 'read',
      text,
      tokens: tokens.map((t) => ({ ...t, hit: t.w && !!this._known[t.k] })),
      capturedCount: 0,
      captured: [],
      showOnceTip: true,
    });
    tracker.track(EV.READING_STARTED, { chars: text.length, source: this.data.title || 'untitled' });
    setTimeout(() => this.setData({ showOnceTip: false }), 2600);
  },

  // ---------------- R2 / R3 ----------------

  tapToken(e: WechatMiniprogram.BaseEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const tok = this.data.tokens[i];
    if (!tok || !tok.w) return; // 标点与空格不可点

    this._pickedIndex = i;
    const sentence = this._sentences[tok.s] || '';
    tracker.track(EV.READING_WORD_TAPPED, { term: tok.k });

    this.setData({
      popup: true,
      picked: { ...EMPTY_PICKED, term: tok.t, sentence, loading: true, saved: !!this._known[tok.k] },
    });
    this._lastResult = null;
    void this.runLookup(tok.k, sentence);
  },

  async runLookup(term: string, sentence: string) {
    try {
      const r = await lookup.lookup(term);
      this._lastResult = r;
      this.setData({
        picked: {
          ...this.data.picked,
          term: r.term || term,
          phonetic: r.phonetic || '',
          // 有语境释义就用语境释义 —— 这一层正是阅读器比查词多出来的东西
          meaning: r.contextualMeaning || r.primaryMeaning || '待补充',
          sentence,
          loading: false,
        },
      });
    } catch (e) {
      this.setData({
        picked: { ...this.data.picked, loading: false, error: '网络不太好，再点一次' },
      });
    }
  },

  retryLookup() {
    const p = this.data.picked;
    this.setData({ picked: { ...p, loading: true, error: '' } });
    void this.runLookup(p.term.toLowerCase(), p.sentence);
  },

  closePopup() {
    this.setData({ popup: false });
  },

  /**
   * 加入时**不让用户选任何东西** —— 不选词书、不选分类、不打标签。
   * 系统自动带上 词 + 原句 + 来源 + 时间。加完弹层立刻收起，**不弹「已加入」的模态框**。
   */
  async capture() {
    const p = this.data.picked;
    if (p.saving || p.saved) return;
    this.setData({ picked: { ...p, saving: true } });
    try {
      // 弹层里那次查词的结果就在手里，直接用
      const r = this._lastResult || (await lookup.lookup(p.term.toLowerCase()));
      await lookup.addWord(r, {
        sourceTitle: this.data.title || '阅读器',
        context: p.sentence,
      });
      tracker.track(EV.CAPTURE_CREATED, { source: 'reading', term: p.term });

      const key = p.term.toLowerCase();
      this._known[key] = true;
      const i = this._pickedIndex;

      // 只改这一个下标，不重建整个 tokens 数组
      const patch: Record<string, unknown> = {};
      patch[`tokens[${i}].hit`] = true;
      this.setData({
        ...patch,
        popup: false,
        capturedCount: this.data.capturedCount + 1,
        captured: this.data.captured.concat({ term: p.term, meaning: p.meaning }),
      });
    } catch (e) {
      this.setData({ picked: { ...this.data.picked, saving: false, error: '没能收进来，再点一次' } });
    }
  },

  // ---------------- R4 ----------------

  finish() {
    reader.saveReading({
      title: this.data.title || '未命名来源',
      text: this.data.text,
      capturedCount: this.data.capturedCount,
      at: Date.now(),
    });
    tracker.track(EV.READING_FINISHED, { captured: this.data.capturedCount });
    wordsSvc.clearCache(); // 收了词，S6 与今日页的缓存都过期了
    this.setData({ stage: 'done' });
  },

  again() {
    this.setData({ stage: 'paste', text: '', title: '', tokens: [], capturedCount: 0, captured: [] });
  },

  close() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/today/today' }) });
  },

  noop() { /* 挡住蒙层后面的滚动 */ },
});
