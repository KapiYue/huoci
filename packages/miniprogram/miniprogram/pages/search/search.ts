// ④ 查词（tab 3）。`design.md` §5.4 S7。
//
//   🔍 输入单词
//   implement  /ˈɪmplɪment/ 🔊
//   vt. 实施；执行；贯彻
//   例：We need to implement this feature.
//   [ ＋ 加入我的活词 ]
//
// 两条硬约束：
//   1. 输入防抖 300ms，查词走服务端，**本地没有全量词典**（§13.2）
//   2. 加入后按钮变已加入态，**不要弹「加入成功」的模态框**

import * as lookup from '../../services/lookup';
import * as onboarding from '../../services/onboarding';
import * as tracker from '../../services/tracker';
import * as words from '../../services/words';
import { EV } from '../../shared/events';
import { ApiError } from '../../services/types';
import type { LookupResult } from '../../services/lookup';
import * as theme from '../../services/theme';

const DEBOUNCE_MS = 300;

type Phase = 'idle' | 'loading' | 'hit' | 'miss' | 'error';

Page({
  data: {
    themeClass: '',
    /** 空态里的高频场景词（原型 SearchTab 的 sampleKeywords） */
    samples: ['paradigm', 'synthesize', 'benchmark', 'anomaly', 'protocol', 'serialize'],
    input: '',
    phase: 'idle' as Phase,
    error: '',
    result: null as LookupResult | null,
    /** 第一条释义，界面上只显示它；parts 的其余项折在下面 */
    saved: false,
    saving: false,
    playing: false,
  },

  /** setTimeout 句柄。放实例上不放 data，它不参与渲染 */
  timer: 0 as number,
  /** 当前请求的序号：慢的旧响应回来时直接丢弃，否则会盖掉新结果 */
  seq: 0,

  onShow() {
    theme.apply(this);
    if (onboarding.guard()) return;
    this.getTabBar?.()?.setData({ active: 3 }); // `[09-03]` 词包插进来后「查词」是第 4 项
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
  },

  onInput(e: WechatMiniprogram.Input) {
    const input = e.detail.value;
    this.setData({ input });
    if (this.timer) clearTimeout(this.timer);
    const term = lookup.normalize(input);
    if (!term) {
      this.setData({ phase: 'idle', result: null, error: '' });
      return;
    }
    this.timer = setTimeout(() => this.run(term), DEBOUNCE_MS) as unknown as number;
  },

  /** 回车立刻查，不等防抖 */
  onConfirm() {
    if (this.timer) clearTimeout(this.timer);
    const term = lookup.normalize(this.data.input);
    if (term) void this.run(term);
  },

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.setData({ input: '', phase: 'idle', result: null, error: '', saved: false });
  },

  /** 点空态里的示例词，等于替用户把它敲进去 */
  useSample(e: WechatMiniprogram.BaseEvent) {
    const w = e.currentTarget.dataset.w as string;
    if (this.timer) clearTimeout(this.timer);
    this.setData({ input: w });
    void this.run(w);
  },

  async run(term: string) {
    if (!lookup.WORD_RE.test(term)) {
      this.setData({ phase: 'error', error: '只能查一个英文单词', result: null });
      return;
    }
    const mine = ++this.seq;
    this.setData({ phase: 'loading', error: '', result: null, saved: false });
    try {
      const [result, saved] = await Promise.all([
        lookup.lookup(term),
        lookup.isSaved(term).catch(() => false),
      ]);
      if (mine !== this.seq) return; // 有更新的请求在跑，这条作废
      tracker.track(EV.LOOKUP_QUERY, { hit: true });
      this.setData({ phase: 'hit', result, saved });
    } catch (e) {
      if (mine !== this.seq) return;
      const err = e as ApiError;
      tracker.track(EV.LOOKUP_QUERY, { hit: false });
      // 400/404 = 词典里没有这个词，与「网络挂了」是两种态，文案不能混
      if (err.status === 400 || err.status === 404) {
        this.setData({ phase: 'miss', result: null });
      } else {
        this.setData({
          phase: 'error',
          result: null,
          error: err.kind === 'network' ? '网络不给力，再试一次' : err.message || '查词失败',
        });
      }
    }
  },

  async addWord() {
    const r = this.data.result;
    if (!r || this.data.saved || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await lookup.addWord(r);
      // 加入后按钮变已加入态，**不弹模态框**（§5.4 S7）
      this.setData({ saved: true });
      tracker.track(EV.CAPTURE_CREATED, {
        source: 'lookup',
        source_domain: null,
        has_context: false,
      });
      words.clearCache(); // 「我的生词」下次进去要能看见它
      void tracker.flush();
    } catch (e) {
      wx.showToast({ title: (e as ApiError).message || '加入失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  play() {
    const url = this.data.result?.audioUrl;
    if (!url || this.data.playing) return;
    this.setData({ playing: true });
    const audio = wx.createInnerAudioContext();
    audio.src = url;
    audio.onEnded(() => {
      this.setData({ playing: false });
      audio.destroy();
    });
    audio.onError(() => {
      this.setData({ playing: false });
      audio.destroy();
    });
    audio.play();
  },
});
