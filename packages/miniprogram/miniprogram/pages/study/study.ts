// ② 学习卡片。《执行方案》§6.2
//
// 交互：显示答案 → 三档自评（想不起来 / 有点模糊 / 记得），mode = 'recall'。
// **P2 明确不做**：拼写输入、听力选择、例句朗读、连击动画。
//
// 提交一律 **先入队 → UI 立即响应 → 后台补发**（§6.2 结尾）。用户在地铁里也能一路点完。

import * as learning from '../../services/learning';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import { UI_RATINGS } from '../../shared/rating';
import type { UiRating } from '../../shared/rating';
import { wordStatus } from '../../shared/wordStatus';
import type { WordStatus } from '../../shared/wordStatus';
import type { StudyCard } from '../../shared/types';

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
}

function decorate(c: StudyCard): ViewCard {
  const st = wordStatus(c);
  return { ...c, status: st, statusLabel: STATUS_LABEL[st].label, badge: STATUS_LABEL[st].badge };
}

let audioCtx: WechatMiniprogram.InnerAudioContext | null = null;
/** 卡片出现的时刻，用来算 response_time_ms（§7 的 review_submit.duration_ms） */
let shownAt = 0;

Page({
  data: {
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
  },

  async onLoad() {
    const { data } = await learning.fetchStudyQueue(20);
    const queue = data.map(decorate);
    this.setData({
      loading: false,
      queue,
      card: queue[0] ?? null,
      percent: queue.length ? Math.round((1 / queue.length) * 100) : 0,
    });
    shownAt = Date.now();
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
      tracker.track(EV.WORD_ACTIVATED, { word_id: card.wordId });
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
    tracker.track(EV.STUDY_SESSION_END, { reviewed, activated });

    // 一轮结束是补发的最好时机：用户还在前台，网络大概率还在
    void (async () => {
      await learning.flushReviews();
      await tracker.flush();
      this.setData({ pending: learning.pendingReviews() });
    })();

    wx.vibrateShort({ type: 'medium' });
  },

  back() {
    wx.switchTab({ url: '/pages/today/today' });
  },
});
