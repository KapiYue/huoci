// S0 · 身份屏。还原对象：`docs/prototype/src/components/LoginTab.tsx`。
//
// 两条路径：
//   微信快捷登录 → 新用户默认路径，先显示 React 原型的头像/昵称授权层，再调用真实 wx.login
//   我有词鲸账号 → 邮箱 + 密码 → **跳过 S1–S3**，直接进「今日」（已有学习数据）
//
// `[09-03]` 三处按原型加回来：品牌头 + 分段切换 + 协议勾选；
//   另加 State A（已登录时的账号管理视图），入口是「我的 → 登录 / 账号管理」。
// `redirect` 参数：收到词包分享的未登录用户先来这里，登录完**回到那一屏**，不丢回首页。

import * as auth from '../../services/auth';
import { select } from '../../services/gateway';
import * as tracker from '../../services/tracker';
import * as learning from '../../services/learning';
import * as membership from '../../services/membership';
import * as words from '../../services/words';
import * as theme from '../../services/theme';
import { EV } from '../../shared/events';
import { ApiError } from '../../services/types';
import * as onboarding from '../../services/onboarding';
import { RELEASE_FEATURES } from '../../config/release';

/** 失败态文案（密码错误、网络失败都要有落点） */
function explain(e: unknown, wrongCredential: string): string {
  const err = e as ApiError;
  if (err.kind === 'network') return '网络不给力，检查一下再试';
  if (err.kind === 'client' || err.status === 400) return wrongCredential;
  return err.message || '登录失败，稍后再试';
}

Page({
  data: {
    themeClass: '',
    releaseFeatures: RELEASE_FEATURES,
    tab: 'wechat' as 'wechat' | 'cijing',
    loading: false,
    error: '',
    email: '',
    password: '',
    agreed: true,
    agreeNotice: false,
    showWeChatAuthSheet: false,
    legalModal: '' as '' | 'terms' | 'privacy',
    selectedAvatarId: 'cat',
    wechatNickname: '微信学习者',

    // State A
    loggedIn: false,
    switching: false,
    displayName: '',
    avatarUrl: '',
    shortId: '',
    isBound: false,
    summary: learning.EMPTY_SUMMARY,
    credits: 0,
    mascotMessage: '欢迎来到活词！登录后即可开启云端实时同步，跨端保存生词与激活进度。',
  },

  /** 登录成功后要跳回的地址（收到分享的人从这里来） */
  _redirect: '',

  onLoad(query: Record<string, string | undefined>) {
    tracker.track(EV.APP_OPEN, { page: 'login' });
    this._redirect = query.redirect ? decodeURIComponent(query.redirect) : '';

    const s = auth.getSession();
    // 从「我的 → 登录/账号管理」进来时是 State A；正常未登录进来是 State B
    const manage = query.manage === '1' && !!s;
    if (s) {
      this.setData({
        loggedIn: true,
        switching: !manage,
        displayName: s.displayName,
        avatarUrl: s.avatarUrl || '',
        shortId: s.userId.slice(0, 8),
        isBound: s.provider === 'password',
        email: s.provider === 'password' && s.email ? s.email : '',
        agreed: true, // 已经登录过就是已经同意过，不用再勾一次
        mascotMessage: `${s.displayName}，欢迎回来！你的学习进度与复习曲线已在云端实时同步。`,
      });
      void this.loadStats();
    }
  },

  onShow() {
    theme.apply(this);
  },

  async loadStats() {
    const summary = await learning.fetchHomeSummary();
    this.setData({ summary: summary.data, credits: membership.get().credits });
  },

  switchTab(e: WechatMiniprogram.BaseEvent) {
    this.setData({ tab: e.currentTarget.dataset.v as 'wechat' | 'cijing', error: '' });
  },

  rotateMascot() {
    const messages = [
      '今天还剩 7 个待复习词，坚持 6 天啦 🔥',
      '活词 = 记忆稳固度 ≥ 21 天，永不回退 ✨',
      '遇到不懂的词？去「场景阅读」点一下直接收录 📖',
      '自评三档：记得 / 有点模糊 / 想不起来 💡',
    ];
    const current = messages.indexOf(this.data.mascotMessage);
    this.setData({ mascotMessage: messages[(current + 1) % messages.length] });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed, agreeNotice: false });
  },

  /** 没勾协议就别往下走。返回 false 表示已经提示过了 */
  requireAgreement(): boolean {
    if (this.data.agreed) return true;
    this.setData({ agreeNotice: true });
    return false;
  },

  onEmail(e: WechatMiniprogram.Input) {
    this.setData({ email: e.detail.value.trim(), error: '' });
  },

  onPassword(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value, error: '' });
  },

  showWeChatLogin() {
    if (this.data.loading || !this.requireAgreement()) return;
    this.setData({ showWeChatAuthSheet: true, error: '' });
  },

  closeWeChatLogin() {
    if (this.data.loading) return;
    this.setData({ showWeChatAuthSheet: false });
  },

  selectAvatar(e: WechatMiniprogram.BaseEvent) {
    this.setData({ selectedAvatarId: String(e.currentTarget.dataset.avatar || 'cat') });
  },

  onWechatNickname(e: WechatMiniprogram.Input) {
    this.setData({ wechatNickname: e.detail.value, error: '' });
  },

  async confirmWeChatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      await auth.loginWithWeChat({ nickname: this.data.wechatNickname.trim() || '微信用户' });
      tracker.track(EV.LOGIN_SUCCESS, { provider: 'wechat' });
      wx.setStorageSync('hc.login.celebrate', Date.now());
      this.setData({ showWeChatAuthSheet: false });
      // 新用户去首启；已做过首启的（重装、换设备）直接进今日
      this.go(await this.needsOnboarding());
    } catch (e) {
      this.setData({ error: explain(e, '微信登录没通过，请重试') });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loginWithPassword() {
    if (this.data.loading || !this.requireAgreement()) return;
    const { email, password } = this.data;
    if (!email || !password) {
      this.setData({ error: '邮箱和密码都要填' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await auth.loginWithPassword(email, password);
      tracker.track(EV.LOGIN_SUCCESS, { provider: 'password' });
      // 换了账号，本地缓存全是上一个账号的
      words.clearCache();
      // 走这条的用户**跳过 S1–S3**（已有学习数据，不需要再测一次水平）
      this.go(false);
    } catch (e) {
      this.setData({ error: explain(e, '邮箱或密码不对') });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * hc_profiles.onboarding_done_at 为空 = 还没做完首启。
   *
   * 服务端为准、本地兜底：读不到（离线、超时）才退回本地记录，最坏是多问一次 40 秒。
   */
  async needsOnboarding(): Promise<boolean> {
    try {
      const rows = await select<{ onboarding_done_at: string | null }[]>(
        'hc_profiles?select=onboarding_done_at&limit=1'
      );
      return !rows[0]?.onboarding_done_at;
    } catch {
      return !onboarding.isDone();
    }
  },

  go(toOnboarding: boolean) {
    if (toOnboarding) {
      // redirectTo 而不是 navigateTo：首启做完之后不该能「后退」回登录页
      wx.redirectTo({ url: '/pages/onboarding/onboarding' });
      return;
    }
    if (this._redirect) {
      const url = this._redirect;
      this._redirect = '';
      wx.redirectTo({ url, fail: () => wx.switchTab({ url: '/pages/today/today' }) });
      return;
    }
    wx.switchTab({ url: '/pages/today/today' });
  },

  // ---------------- State A ----------------

  goToday() {
    wx.switchTab({ url: '/pages/today/today' });
  },

  startSwitch() {
    this.setData({ switching: true, tab: 'wechat', error: '', password: '' });
  },

  cancelSwitch() {
    this.setData({ switching: false, error: '', agreeNotice: false });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '没同步完的复习会留着，下次登录自动补上。',
      confirmText: '退出',
      success: (res) => {
        if (!res.confirm) return;
        auth.logout();
        words.clearCache();
        this.setData({ loggedIn: false, switching: false, agreed: false, summary: learning.EMPTY_SUMMARY });
      },
    });
  },

  openTerms() {
    this.setData({ legalModal: 'terms' });
  },

  openPrivacy() {
    this.setData({ legalModal: 'privacy' });
  },

  closeLegal() {
    this.setData({ legalModal: '' });
  },

  noop() {},
});
