// ⑤ 我的（tabbar 最右）。还原对象：`docs/prototype/src/components/ProfileTab.tsx`。
//
// 三条仍然生效的硬约束（跟原型不冲突，原型也是这么画的）：
//   1. 「词鲸 App…」那两行**不放链接、不放二维码、不放按钮**
//   2. 没有任何 App 下载引导
//   3. 关联必须由用户主动发起、明确勾选，并验证微信身份与词鲸账号的双重控制权。

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
    isCijingSession: false,
    /** 仅微信会话可发起关联；已关联账号显示解绑入口。 */
    canUseCijingLogin: true,
    accountLinked: false,
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
    linkConfirmed: false,
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
    void auth.getAccountLinkStatus()
      .then(({ linked }) => this.setData({ accountLinked: linked }))
      .catch(() => { /* 状态失败不影响学习；操作时仍由服务端校验。 */ });
  },

  /** 本地就有的东西先画出来，别等网络 */
  loadLocal() {
    const s = auth.getSession();
    const p = prefs.get();
    this.setData({
      displayName: s ? s.displayName : '微信用户',
      avatarUrl: s && s.avatarUrl ? s.avatarUrl : '',
      shortId: s ? s.userId.slice(0, 8) : '—',
      isCijingSession: s ? s.provider === 'password' : false,
      canUseCijingLogin: s ? s.provider === 'wechat' : true,
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

  // ---------------- 关联词鲸账号 ----------------

  /**
   * 关联在表单内要求主动勾选，并由新的微信 code 和词鲸密码完成双重控制权验证。
   */
  startBind() {
    this.setData({ binding: true, bindError: '', linkConfirmed: false });
  },

  closeBind() {
    this.setData({ binding: false, bindEmail: '', bindPassword: '', bindError: '', linkConfirmed: false });
  },

  onBindEmail(e: WechatMiniprogram.Input) {
    this.setData({ bindEmail: e.detail.value.trim(), bindError: '' });
  },

  onBindPassword(e: WechatMiniprogram.Input) {
    this.setData({ bindPassword: e.detail.value, bindError: '' });
  },

  toggleLinkConfirmation(e: WechatMiniprogram.SwitchChange) {
    this.setData({ linkConfirmed: e.detail.value, bindError: '' });
  },

  async confirmBind() {
    const { bindEmail, bindPassword, bindBusy, linkConfirmed } = this.data;
    if (bindBusy) return;
    if (!bindEmail || !bindPassword) {
      this.setData({ bindError: '邮箱和密码都要填' });
      return;
    }
    if (!linkConfirmed) {
      this.setData({ bindError: '请先勾选并确认数据处理说明' });
      return;
    }
    this.setData({ bindBusy: true });
    try {
      await auth.confirmAccountLink(bindEmail, bindPassword);
      tracker.track(EV.BIND_CIJING, { ok: true });
      // 关联后会话已切换到规范账号，本地读取缓存需要重取。
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
            // 关联需要同时验证新鲜的微信 code、当前登录态及词鲸账号。
            // 服务端已经给出了脱敏的具体原因，不能把任何 4xx 都误报成密码错误。
            : err.message || '关联失败，请稍后重试',
      });
    } finally {
      this.setData({ bindBusy: false });
    }
  },

  unlinkAccount() {
    if (this.data.bindBusy) return;
    wx.showModal({
      title: '解除微信关联',
      content: '系统会先把词鲸账号当前的学习数据复制回微信账号。解除后两边停止同步，并各自独立变化。确定继续吗？',
      confirmText: '确认解绑',
      confirmColor: '#e11d48',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ bindBusy: true });
        try {
          await auth.unlinkAccount();
          words.clearCache();
          onboarding.reset();
          wx.showToast({ title: '已解除关联', icon: 'success' });
          wx.reLaunch({ url: '/pages/today/today' });
        } catch (e) {
          wx.showToast({ title: (e as ApiError).message || '解绑失败，请稍后重试', icon: 'none' });
        } finally {
          this.setData({ bindBusy: false });
        }
      },
    });
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
