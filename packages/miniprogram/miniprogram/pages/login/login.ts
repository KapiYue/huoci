// S0 · 身份屏。还原对象：`docs/prototype/src/components/LoginTab.tsx`。
//
// 两条路径：
//   微信一键登录 → 新用户默认路径，**一次点击**（wx.login 静默取 code，不插头像/昵称弹层）
//   我有词鲸账号 → 邮箱 + 密码 → **跳过 S1–S3**，直接进「今日」（已有学习数据）
//
// 昵称不在这里问：网关建 user 时兜底塞 '微信用户'，想改去「我的」。
// 在这里插一个授权弹层，就把「一次点击」变成三次。
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
    tab: 'wechat' as 'wechat' | 'cijing',
    loading: false,
    error: '',
    email: '',
    password: '',
    agreed: false,
    agreeNotice: false,

    // State A
    loggedIn: false,
    switching: false,
    displayName: '',
    avatarUrl: '',
    shortId: '',
    isBound: false,
    summary: learning.EMPTY_SUMMARY,
    credits: 0,
    mascotMessage: '欢迎来到活词。登录之后，你收下的每个词都存在云端，换设备也在。',
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
        mascotMessage: `${s.displayName}，欢迎回来。你的学习进度和复习曲线都在云端。`,
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

  async loginWithWeChat() {
    if (this.data.loading || !this.requireAgreement()) return;
    this.setData({ loading: true, error: '' });
    try {
      await auth.loginWithWeChat({});
      tracker.track(EV.LOGIN_SUCCESS, { provider: 'wechat' });
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
    wx.showModal({
      title: '用户服务协议',
      content: '协议正文待补（备案通过后指向 joy-coder.cn）。要点：小程序只保存你主动收下的词、收词时那句原文与来源标题。',
      showCancel: false,
    });
  },

  openPrivacy() {
    wx.showModal({
      title: '个人信息保护政策',
      content: '我们不读剪贴板、不收集通讯录、不做广告投放。贴进阅读器的正文只留在你手机上，不会上传。',
      showCancel: false,
    });
  },
});
