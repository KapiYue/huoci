// 排行榜与好友 PK（L1–L4）。还原对象：`docs/prototype/src/components/LeaderboardModal.tsx`。
//
// 🔴 服务端还没有（P4），榜和对手都来自 services/leaderboard.ts 的本地假数据。
//    真接上之后这一页只换取数，交互与文案不用动。
//
// 两条不能省的：
//   1. 首次进入的**一次性隐私告知** —— 榜单把昵称展示给陌生人，这是隐私政策要写的内容
//   2. 分享**必须用户主动点**（open-type="share"），不自动弹转发、不做「分享后解锁」

import * as lb from '../../services/leaderboard';
import * as learning from '../../services/learning';
import * as wordsSvc from '../../services/words';
import * as auth from '../../services/auth';
import * as prefs from '../../services/prefs';
import * as theme from '../../services/theme';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import type { LeaderRow, Question } from '../../services/leaderboard';

interface OptionVM { idx: number; text: string; cls: string }
interface ReviewVM { term: string; ok: boolean; correct: string; picked: string }

const EMPTY_ROW: LeaderRow = { rank: 0, id: 'me', displayName: '你', initial: '你', activatedThisWeek: 0 };

Page({
  data: {
    themeClass: '',
    hidden: false,
    notice: false,
    view: 'list' as 'list' | 'invite' | 'battle' | 'result',
    period: 'thisWeek' as lb.Period,
    rows: [] as LeaderRow[],
    mine: EMPTY_ROW,
    opponent: EMPTY_ROW,

    // 对战
    questions: [] as Question[],
    question: null as Question | null,
    options: [] as OptionVM[],
    qIndex: 0,
    total: lb.PK_QUESTIONS,
    seconds: lb.PK_SECONDS,
    myScore: 0,
    oppScore: 0,
    mySeconds: 0,
    oppSeconds: 0,
    resultTitle: '',
    review: [] as ReviewVM[],
    showReview: false,

    poster: false,
  },

  _timer: 0 as number,
  _startAt: 0,
  _pool: [] as { term: string; meaning: string }[],

  onShow() {
    theme.apply(this);
    const p = prefs.get();
    this.setData({ hidden: p.hideFromLeaderboard });
    if (p.hideFromLeaderboard) return;

    if (!lb.noticeShown()) this.setData({ notice: true });
    tracker.track(EV.LEADERBOARD_VIEW, { period: this.data.period });
    void this.load();
  },

  onUnload() {
    this.stopTimer();
  },

  async load() {
    const s = auth.getSession();
    const summary = await learning.fetchHomeSummary();
    const { rows, mine } = lb.board(this.data.period, {
      name: s ? s.displayName : '你',
      activatedThisWeek: summary.data.activated_this_week,
    });
    this.setData({ rows, mine });

    // 出题池：自己的词（带释义）。对手是假的，所以还做不到「双方都学过」那一条
    const words = await wordsSvc.fetchWords('recent').catch(() => ({ data: [], stale: true }));
    this._pool = words.data.map((w) => ({ term: w.term, meaning: w.meaning }));
  },

  switchPeriod(e: WechatMiniprogram.BaseEvent) {
    const period = e.currentTarget.dataset.v as lb.Period;
    this.setData({ period });
    void this.load();
  },

  // ---------------- 一次性告知 ----------------

  acceptBoard() {
    lb.markNoticeShown();
    this.setData({ notice: false });
  },

  /** 「先不参与」= 直接把开关关上，不是把弹窗关掉了事 */
  declineBoard() {
    lb.markNoticeShown();
    prefs.set({ hideFromLeaderboard: true });
    this.setData({ notice: false, hidden: true });
  },

  // ---------------- L2 发起 ----------------

  invite(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    const opponent = this.data.rows.find((r) => r.id === id);
    if (!opponent) return;
    this.setData({ view: 'invite', opponent });
  },

  backToList() {
    this.stopTimer();
    this.setData({ view: 'list' });
  },

  // ---------------- L3 对战 ----------------

  startBattle() {
    const questions = lb.buildQuestions(this._pool);
    this._startAt = Date.now();
    this.setData({
      view: 'battle',
      questions,
      qIndex: 0,
      total: questions.length,
      myScore: 0,
      oppScore: 0,
      review: [],
      showReview: false,
    });
    tracker.track(EV.PK_STARTED, { opponent: this.data.opponent.id, questions: questions.length });
    this.showQuestion(0);
  },

  showQuestion(i: number) {
    const q = this.data.questions[i];
    if (!q) return;
    this.setData({
      qIndex: i,
      question: q,
      options: q.options.map((text, idx) => ({ idx, text, cls: '' })),
      seconds: lb.PK_SECONDS,
    });
    this.startTimer();
  },

  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => {
      const left = this.data.seconds - 1;
      if (left <= 0) {
        this.stopTimer();
        this.settle(-1); // 超时判错
      } else {
        this.setData({ seconds: left });
      }
    }, 1000) as unknown as number;
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = 0;
    }
  },

  answer(e: WechatMiniprogram.BaseEvent) {
    this.stopTimer();
    this.settle(Number(e.currentTarget.dataset.i));
  },

  /** picked = -1 表示超时 */
  settle(picked: number) {
    const q = this.data.question;
    if (!q) return;
    const ok = picked === q.answer;

    this.setData({
      options: this.data.options.map((o) => ({
        ...o,
        cls: o.idx === q.answer ? 'is-right' : o.idx === picked ? 'is-wrong' : '',
      })),
      myScore: this.data.myScore + (ok ? 1 : 0),
      // 对手是假的：按 70% 命中率模拟，真接上服务端后这一行删掉
      oppScore: this.data.oppScore + (Math.random() < 0.7 ? 1 : 0),
      review: this.data.review.concat({
        term: q.term,
        ok,
        correct: q.options[q.answer] || '',
        picked: picked >= 0 ? q.options[picked] || '' : '（超时未答）',
      }),
    });

    setTimeout(() => {
      const next = this.data.qIndex + 1;
      if (next >= this.data.questions.length) this.finish();
      else this.showQuestion(next);
    }, 700);
  },

  finish() {
    const mySeconds = Math.round((Date.now() - this._startAt) / 1000);
    const { myScore, oppScore } = this.data;
    // 胜负提示克制：不放彩带、不放连胜火苗、不放段位升降
    const resultTitle = myScore > oppScore ? '你赢了' : myScore < oppScore ? '这局你输了' : '打平';
    this.setData({
      view: 'result',
      mySeconds,
      oppSeconds: mySeconds + Math.round((Math.random() - 0.4) * 20),
      resultTitle,
    });
    tracker.track(EV.PK_FINISHED, {
      my_score: myScore,
      opp_score: oppScore,
      duration_s: mySeconds,
      opponent: this.data.opponent.id,
    });
    // TODO(P4)：把答题结果写回复习记录（PK 答对且快 = quality 4，§9.3）。
    // 现在不写：对手与出题都还是本地假数据，写回去会污染真实的 SM-2 状态。
  },

  toggleReview() {
    this.setData({ showReview: !this.data.showReview });
  },

  // ---------------- 成果海报 ----------------

  openPoster() {
    this.setData({ poster: true });
    setTimeout(() => this.drawPoster(), 60);
  },

  closePoster() {
    this.setData({ poster: false });
  },

  drawPoster() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#poster')
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) return;
        const canvas = item.node as WechatMiniprogram.Canvas;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio || 2;
        canvas.width = item.width * dpr;
        canvas.height = item.height * dpr;
        ctx.scale(dpr, dpr);

        const w = item.width;
        const h = item.height;
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#7e22ce');
        grad.addColorStop(1, '#4f46e5');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#ffffff';
        ctx.font = '600 14px sans-serif';
        ctx.fillText('活词 · 词以致用', 20, 34);

        ctx.font = '800 44px sans-serif';
        ctx.fillText(String(this.data.mine.activatedThisWeek), 20, h / 2 + 6);
        ctx.font = '600 15px sans-serif';
        ctx.fillText('本周新激活的活词', 20, h / 2 + 32);

        ctx.font = '400 11px sans-serif';
        ctx.fillText('活词 = 复习间隔已经拉过 21 天的词', 20, h - 24);
        // TODO(P4)：右下角贴小程序码（要服务端 getUnlimited 接口，现在没有）
      });
  },

  savePoster() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#poster')
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) return;
        wx.canvasToTempFilePath({
          canvas: item.node as WechatMiniprogram.Canvas,
          success: (r) => {
            wx.saveImageToPhotosAlbum({
              filePath: r.tempFilePath,
              success: () => wx.showToast({ title: '已存进相册', icon: 'none' }),
              fail: () => wx.showToast({ title: '没能保存，检查一下相册权限', icon: 'none' }),
            });
          },
          fail: () => wx.showToast({ title: '海报生成失败', icon: 'none' }),
        });
      });
  },

  /** 分享由用户主动点，带 scene 用于归因 */
  onShareAppMessage() {
    const opp = this.data.opponent;
    if (this.data.view === 'invite' && opp.id !== 'me') {
      return {
        title: `${this.data.mine.displayName} 想和你比 10 题英文词义`,
        path: `/pages/leaderboard/leaderboard?scene=pk&by=${encodeURIComponent(this.data.mine.displayName)}`,
      };
    }
    return {
      title: `我这周激活了 ${this.data.mine.activatedThisWeek} 个活词`,
      path: '/pages/today/today?scene=board',
    };
  },

  noop() { /* 挡住蒙层后面的滚动 */ },
});
