// 排行榜与好友 PK（L1–L4）。还原对象：`docs/prototype/src/components/LeaderboardModal.tsx`。
//
// 🔴 服务端还没有（P4），榜和对手都来自 services/leaderboard.ts 的本地假数据。
//    真接上之后这一页只换取数，交互与文案不用动。
//
// 两条不能省的：
//   1. 首次进入的**一次性隐私告知** —— 榜单把昵称展示给陌生人，这是隐私政策要写的内容
//   2. 分享**必须用户主动点**（open-type="share"），不自动弹转发、不做「分享后解锁」

import * as lb from '../../services/leaderboard';
import * as wordsSvc from '../../services/words';
import * as auth from '../../services/auth';
import * as prefs from '../../services/prefs';
import * as theme from '../../services/theme';
import * as tracker from '../../services/tracker';
import * as wxacode from '../../services/wxacode';
import { EV } from '../../shared/events';
import type { LeaderRow, Question } from '../../services/leaderboard';
import { guardReleaseFeature } from '../../config/release';

/**
 * 归因用的周标记，形如 `2026W36`。周界跟 §5.9 的榜一致：**周一 0 点**、按用户本地时区。
 * 只用来给分享分桶，不参与任何计数，所以不引第三方日期库。
 */
function weekTag(): string {
  const now = new Date();
  // getDay() 里周日是 0，先掰成「周一 = 0」，否则周日会被算进下一周
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const jan1 = new Date(monday.getFullYear(), 0, 1);
  const week = Math.floor((monday.getTime() - jan1.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
  return `${monday.getFullYear()}W${week}`;
}

interface OptionVM { idx: number; label: string; text: string; cls: string }
interface ReviewVM { term: string; ok: boolean; correct: string; picked: string }

const EMPTY_ROW: LeaderRow = { rank: 0, id: 'me', displayName: '你', initial: '你', activatedThisWeek: 0 };

Page({
  data: {
    themeClass: '',
    hidden: false,
    notice: false,
    view: 'list' as 'list' | 'invite' | 'battle' | 'result',
    navTitle: '活词周榜',
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
    secondsText: String(lb.PK_SECONDS).padStart(2, '0'),
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
    if (guardReleaseFeature('leaderboard')) return;
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
    const { rows, mine } = lb.board(this.data.period, {
      name: s ? s.displayName : '你',
      // 榜单本身仍是原型假数据，当前用户也固定用原型的 7，避免真假口径混排。
      activatedThisWeek: 7,
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
    this.setData({ view: 'invite', navTitle: '发起好友 PK', opponent });
  },

  backToList() {
    this.stopTimer();
    this.setData({ view: 'list', navTitle: '活词周榜' });
  },

  backNav() {
    if (this.data.view !== 'list') {
      this.backToList();
      return;
    }
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) });
  },

  showPrivacy() {
    this.setData({ notice: true });
  },

  // ---------------- L3 对战 ----------------

  startBattle() {
    const questions = lb.buildQuestions(this._pool);
    this._startAt = Date.now();
    this.setData({
      view: 'battle',
      navTitle: `第 1 / ${questions.length} 题`,
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
      options: q.options.map((text, idx) => ({ idx, label: `${String.fromCharCode(65 + idx)}.`, text, cls: '' })),
      seconds: lb.PK_SECONDS,
      secondsText: String(lb.PK_SECONDS).padStart(2, '0'),
      navTitle: `第 ${i + 1} / ${this.data.questions.length} 题`,
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
        this.setData({ seconds: left, secondsText: String(left).padStart(2, '0') });
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
    const resultTitle = myScore >= oppScore ? '你赢了' : '惜败';
    this.setData({
      view: 'result',
      navTitle: '对战战报',
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

        // 小程序码贴右下角。**异步补画，不阻塞海报** ——
        // 小程序首次发布之前 getwxacodeunlimit 一定失败（41030，见 services/wxacode.ts），
        // 拿不到码是常态；这时候海报照样是完整的，只是右下角空着。
        this.drawQr(canvas, ctx, w, h);
      });
  },

  /** 把小程序码画到已经铺好底的 canvas 右下角。失败一律静默 —— 用户要的是海报，不是错误。 */
  drawQr(
    canvas: WechatMiniprogram.Canvas,
    ctx: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
    w: number,
    h: number,
  ) {
    // 归因用（§14.4）：s=海报来源，w=周序号。两段都短，拼完远在 32 字符以内。
    const scene = wxacode.buildScene({ s: 'poster', w: weekTag() });
    wxacode
      .qrFile(scene, 'pages/today/today')
      .then((path) => {
        if (!path || !this.data.poster) return;
        const size = 64;
        const x = w - size - 20;
        const y = h - size - 20;
        const img = canvas.createImage();
        img.onload = () => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
          ctx.drawImage(img, x, y, size, size);
        };
        img.onerror = () => console.warn('[poster] 小程序码解码失败，海报保持无码版');
        img.src = path;
      })
      .catch(() => { /* 见上：拿不到码不算错误 */ });
  },

  // ⚠️ 存图与补画小程序码是**两条独立的时序** —— 码还没画上去就点保存，存下来的是无码版。
  // 现在不管它：首次发布之前码本来就拿不到，等 P4 真能出码了再看要不要等一等
  // （用例在 docs/operations-and-tests.md 的人工复测清单 P3，不是 design.md 的编号）。
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
