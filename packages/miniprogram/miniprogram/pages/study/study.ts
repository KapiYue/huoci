// ② 学习卡片。原型 `docs/prototype/src/components/StudySessionModal.tsx`；规格 §5.4 S5。
//
// 交互：显示答案 → 三档自评（想不起来 / 有点模糊 / 记得），mode = 'recall'。
// `[09-03]` 卡片正面有两种模式（「我的 → 学习卡片模式」里切，原型 ProfileTab）：
//   context —— 正面直接给英文原句、把生词挖空，靠上下文回忆（默认）
//   classic —— 正面给拼写 + 音标
// ⚠️ **底座词没有原句**，context 对它自动退回 classic —— 不编造例句（附录 C）。
//
// 提交一律 **先入队 → UI 立即响应 → 后台补发**。用户在地铁里也能一路点完。

import * as learning from '../../services/learning';
import * as tracker from '../../services/tracker';
import { EV, isSessionCompleted } from '../../shared/events';
import { UI_RATINGS } from '../../shared/rating';
import type { UiRating } from '../../shared/rating';
import { wordStatus } from '../../shared/wordStatus';
import type { WordStatus } from '../../shared/wordStatus';
import type { StudyCard } from '../../shared/types';
import * as prefs from '../../services/prefs';
import * as theme from '../../services/theme';

const STATUS_LABEL: Record<WordStatus, { label: string; badge: string }> = {
  captured: { label: '刚收进', badge: '📥' },
  learning: { label: '学习中', badge: '🌱' },
  remembered: { label: '已记住', badge: '🧠' },
  activated: { label: '活词', badge: '✨' },
  mastered: { label: '能说出', badge: '👑' },
};

interface ViewCard extends StudyCard {
  status: WordStatus;
  statusLabel: string;
  badge: string;
  /** 语境模式下的挖空句。底座词没有原句时为空串，界面据此退回 classic */
  cloze: string;
}

/** 把原句里的目标词换成 ____。词形变化（implements / implemented）也一起挖掉 */
function clozeOf(sentence: string | null, term: string): string {
  if (!sentence || !term) return '';
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'gi');
  const out = sentence.replace(re, '____');
  // 一次都没换掉说明原句里其实没有这个词（词形差太远），那就别装作挖空了
  return out === sentence ? '' : out;
}

function decorate(c: StudyCard): ViewCard {
  const st = wordStatus(c);
  return {
    ...c,
    status: st,
    statusLabel: STATUS_LABEL[st].label,
    badge: STATUS_LABEL[st].badge,
    cloze: clozeOf(c.contextSentence, c.term),
  };
}

let audioCtx: WechatMiniprogram.InnerAudioContext | null = null;
/** 卡片出现的时刻，用来算 response_time_ms（§15 的 review_submit.duration_ms） */
let shownAt = 0;
/** 本轮开始的时刻，用来算 study_session_end.duration_ms */
let sessionStartedAt = 0;

Page({
  data: {
    themeClass: '',
    loading: true,
    queue: [] as ViewCard[],
    index: 0,
    card: null as ViewCard | null,
    revealed: false,
    done: false,
    reviewed: 0,
    activated: 0,
    pending: 0,
    percent: 0,
    ratings: UI_RATINGS,
    cardMode: 'context' as prefs.StudyCardMode,
    /** R5：会话结束页那一句阅读器引导，只在本轮出现过底座词时给，且只出现一次 */
    showReaderHint: false,
  },

  async onLoad() {
    theme.apply(this);
    const { data } = await learning.fetchStudyQueue(20);
    const queue = data.map(decorate);
    this.setData({
      loading: false,
      queue,
      card: queue[0] ?? null,
      percent: queue.length ? Math.round((1 / queue.length) * 100) : 0,
      cardMode: prefs.get().studyCardMode,
      // 底座词 = 没有原句的词。有它才给阅读器那句引导，否则那句话没有由头
      showReaderHint: queue.some((c) => !c.contextSentence),
    });
    shownAt = Date.now();
    sessionStartedAt = Date.now();
  },

  onUnload() {
    audioCtx?.destroy();
    audioCtx = null;
    void tracker.flush();
  },

  reveal() {
    this.setData({ revealed: true });
  },

  playAudio() {
    const url = this.data.card?.audioUrl;
    if (!url) return;
    if (!audioCtx) audioCtx = wx.createInnerAudioContext();
    audioCtx.src = url;
    audioCtx.play();
  },

  rate(e: WechatMiniprogram.TouchEvent) {
    const card = this.data.card;
    if (!card || !this.data.revealed) return;

    const rating = Number(e.currentTarget.dataset.rating) as UiRating;
    const duration = Date.now() - shownAt;

    const res = learning.submitReview(card, rating, duration);

    tracker.track(EV.REVIEW_SUBMIT, {
      word_id: card.wordId,
      rating,
      mode: 'recall',
      duration_ms: duration,
      has_context: card.contextSentence !== null,
    });

    let activated = this.data.activated;
    if (res.newlyActivated) {
      activated += 1;
      // ⚠️ 这里**不**打 word_activated：本地是乐观推算，服务端补发回来才是权威，
      // 两处都打会把北极星算重一倍。上报在 finish() 里按 flush 的结果打。
      wx.vibrateShort({ type: 'light' });
      wx.showToast({ title: `「${card.term}」成了活词 ✨`, icon: 'none', duration: 1400 });
    }

    const next = this.data.index + 1;
    const reviewed = this.data.reviewed + 1;

    if (next >= this.data.queue.length) {
      this.finish(reviewed, activated);
      return;
    }

    this.setData({
      index: next,
      card: this.data.queue[next] as ViewCard,
      revealed: false,
      reviewed,
      activated,
      percent: Math.round(((next + 1) / this.data.queue.length) * 100),
    });
    shownAt = Date.now();
  },

  finish(reviewed: number, activated: number) {
    this.setData({ done: true, reviewed, activated });
    // completed 的口径写在 shared 里，三端只有一处实现（§15「口径统一」）：
    // 队列走完 或 本轮 ≥10 张，取先到者。口径打架的话首次学习完成率就是废数据。
    tracker.track(EV.STUDY_SESSION_END, {
      reviewed,
      activated,
      duration_ms: Date.now() - sessionStartedAt,
      completed: isSessionCompleted(reviewed, this.data.index + 1 >= this.data.queue.length),
    });

    // 一轮结束是补发的最好时机：用户还在前台，网络大概率还在
    void (async () => {
      const res = await learning.flushReviews();
      tracker.track(EV.WRITE_QUEUE_FLUSH, {
        ok: res.remaining === 0,
        pushed: res.sent,
        retries: 0,
        err: res.offline ? 'offline' : null,
      });
      // 服务端才是激活的权威：本地 optimistic 只为让 UI 当场能动，
      // 落库这一刻拿到的 newly_activated 才是北极星该吃的那个数（§15 word_activated）
      for (const wordId of res.activated) {
        tracker.track(EV.WORD_ACTIVATED, { word_id: wordId });
      }
      await tracker.flush();
      this.setData({ pending: learning.pendingReviews() });
    })();

    wx.vibrateShort({ type: 'medium' });
  },

  back() {
    wx.switchTab({ url: '/pages/today/today' });
  },

  /** R5：学习卡片遇到底座词时**不打断学习**，只在会话结束页出现这一次 */
  openReader() {
    wx.navigateTo({ url: '/pages/reader/reader' });
  },
});
