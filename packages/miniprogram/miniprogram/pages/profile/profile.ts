// ⑤ 我的（tabbar 最右）。还原对象：`docs/prototype/src/components/ProfileTab.tsx`。
//
// 三条仍然生效的硬约束（跟原型不冲突，原型也是这么画的）：
//   1. 「词鲸 App…」那两行**不放链接、不放二维码、不放按钮**
//   2. 没有任何 App 下载引导
//   3. 绑定词鲸账号必须画「N 个词将被丢弃」+ 二次确认 —— ⚠️ 原型的绑定弹层只要一个邮箱、
//      没有这一步。这里**保留**二次确认：绑定会把当前微信账号下的词留在原账号，不可逆，
//      少一步确认丢的是用户的数据，不是一个视觉细节。

import * as auth from '../../services/auth';
import * as learning from '../../services/learning';
import * as profile from '../../services/profile';
import * as onboarding from '../../services/onboarding';
import * as tracker from '../../services/tracker';
import * as words from '../../services/words';
import * as prefs from '../../services/prefs';
import * as theme from '../../services/theme';
import { PRIVACY_SECTIONS } from '../../services/privacy';
import { EV } from '../../shared/events';
import { ApiError } from '../../services/types';
import type { StudyCardMode } from '../../services/prefs';
import { RELEASE_FEATURES } from '../../config/release';

const CARD_MODE_LABEL: Record<StudyCardMode, string> = {
  context: '语境优先（先读原句再猜词）',
  classic: '传统模式（先看单词正面）',
};

Page({
  data: {
    themeClass: '',
    releaseFeatures: RELEASE_FEATURES,
    themeSetting: 'system' as theme.ThemeSetting,
    displayName: '微信用户',
    avatarUrl: '',
    shortId: '—',
    isBound: false,
    /** 微信登录的用户没绑过邮箱账号，才显示「绑定词鲸账号」 */
    canBind: true,
    summary: learning.EMPTY_SUMMARY,
    learningCount: 0,
    dailyGoal: 20,
    cardMode: 'context' as StudyCardMode,
    cardModeLabel: CARD_MODE_LABEL.context,
    hideFromLeaderboard: false,
    cardModal: false,
    privacyModal: false,
    privacySections: PRIVACY_SECTIONS,
    loadError: '',
    /** 绑定弹层 */
    binding: false,
    bindEmail: '',
    bindPassword: '',
    bindError: '',
    bindBusy: false,
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login?back=1' });
      return;
    }
    if (onboarding.guard()) return;
    this.getTabBar?.()?.setData({ active: RELEASE_FEATURES.wordPacks ? 4 : 3 });
    theme.apply(this);
    this.loadLocal();
    void this.load();
  },

  /** 本地就有的东西先画出来，别等网络 */
  loadLocal() {
    const s = auth.getSession();
    const p = prefs.get();
    this.setData({
      displayName: s ? s.displayName : '微信用户',
      avatarUrl: s && s.avatarUrl ? s.avatarUrl : '',
      shortId: s ? s.userId.slice(0, 8) : '—',
      isBound: s ? s.provider === 'password' : false,
      canBind: s ? s.provider === 'wechat' : true,
      cardMode: p.studyCardMode,
      cardModeLabel: CARD_MODE_LABEL[p.studyCardMode],
      hideFromLeaderboard: p.hideFromLeaderboard,
    });
  },

  async load() {
    this.setData({ loadError: '' });
    try {
      const [summary, p] = await Promise.all([learning.fetchHomeSummary(), profile.fetchProfile()]);
      this.setData({
        summary: summary.data,
        // ⚠️ 这是「还没激活的词」，**不等于**「正在学的词」——后者要 repetitions>0，
        // 服务端概览没给这个数。别把标签写成「学习中」，那是两个口径。
        learningCount: Math.max(0, summary.data.total_words - summary.data.activated_count),
        dailyGoal: p.daily_goal,
      });
    } catch (e) {
      this.setData({ loadError: (e as Error).message || '学习数据加载失败' });
    }
  },

  retryLoad() { void this.load(); },

  // ---------------- 跳转 ----------------

  openLeaderboard() { wx.navigateTo({ url: '/pages/leaderboard/leaderboard' }); },
  openReader() { wx.navigateTo({ url: '/pages/reader/reader' }); },
  openLicense() { wx.navigateTo({ url: '/pages/license/license' }); },

  openAbout() {
    wx.showModal({
      title: '关于活词',
      content: '活词 · 词以致用。把你在真实工作场景里撞见的英文生词，变成能说出口的英文。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  openPrivacy() {
    this.setData({ privacyModal: true });
  },

  closePrivacy() { this.setData({ privacyModal: false }); },

  // ---------------- 偏好 ----------------

  setTheme(e: WechatMiniprogram.BaseEvent) {
    const v = e.currentTarget.dataset.v as theme.ThemeSetting;
    theme.set(v);
    theme.apply(this);
  },

  openCardMode() { this.setData({ cardModal: true }); },
  closeCardMode() { this.setData({ cardModal: false }); },

  pickCardMode(e: WechatMiniprogram.BaseEvent) {
    const v = e.currentTarget.dataset.v as StudyCardMode;
    prefs.set({ studyCardMode: v });
    this.setData({ cardMode: v, cardModeLabel: CARD_MODE_LABEL[v], cardModal: false });
  },

  toggleLeaderboard(e: WechatMiniprogram.SwitchChange) {
    const on = e.detail.value;
    prefs.set({ hideFromLeaderboard: on });
    this.setData({ hideFromLeaderboard: on });
  },

  // ---------------- 绑定词鲸账号（兜底入口） ----------------

  /**
   * 绑定确认弹窗**必须**画「小程序上的 N 个词将被丢弃」+ 二次确认。
   *
   * 为什么会丢：绑定 = 换成词鲸那个 auth user 登录，微信这个匿名 user 的 words 留在原账号下，
   * 新账号里看不到。这件事不能藏在小字里，它是不可逆的。
   */
  startBind() {
    const n = this.data.summary.total_words;
    wx.showModal({
      title: '绑定词鲸账号',
      content:
        n > 0
          ? `绑定后会切换到你的词鲸账号，当前微信账号下的 ${n} 个词将被丢弃，且无法找回。确定继续吗？`
          : '绑定后会切换到你的词鲸账号。确定继续吗？',
      confirmText: '继续绑定',
      confirmColor: '#e11d48',
      cancelText: '算了',
      success: (res) => {
        if (res.confirm) this.setData({ binding: true, bindError: '' });
      },
    });
  },

  closeBind() {
    this.setData({ binding: false, bindEmail: '', bindPassword: '', bindError: '' });
  },

  onBindEmail(e: WechatMiniprogram.Input) {
    this.setData({ bindEmail: e.detail.value.trim(), bindError: '' });
  },

  onBindPassword(e: WechatMiniprogram.Input) {
    this.setData({ bindPassword: e.detail.value, bindError: '' });
  },

  async confirmBind() {
    const { bindEmail, bindPassword, bindBusy } = this.data;
    if (bindBusy) return;
    if (!bindEmail || !bindPassword) {
      this.setData({ bindError: '邮箱和密码都要填' });
      return;
    }
    this.setData({ bindBusy: true });
    try {
      await auth.loginWithPassword(bindEmail, bindPassword);
      tracker.track(EV.BIND_CIJING, { ok: true });
      // 换了账号，本地这些全是上一个账号的
      words.clearCache();
      onboarding.reset();
      void tracker.flush();
      this.setData({ binding: false });
      wx.reLaunch({ url: '/pages/today/today' });
    } catch (e) {
      const err = e as ApiError;
      this.setData({
        bindError:
          err.kind === 'network'
            ? '网络不给力，检查一下再试'
            : err.kind === 'client' || err.status === 400
              ? '邮箱或密码不对'
              : err.message || '绑定失败',
      });
    } finally {
      this.setData({ bindBusy: false });
    }
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
        wx.reLaunch({ url: '/pages/search/search' });
      },
    });
  },

  noop() {
    /* 挡住蒙层后面的滚动 */
  },
});
