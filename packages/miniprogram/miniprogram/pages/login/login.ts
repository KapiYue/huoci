// S0 · 身份屏。《执行方案》§6.0 / 《原型输入》§3 S0。
//
// 两个入口是**并列**的，不是分叉流程：
//   微信一键登录 → 新用户默认路径 → 进首启三屏
//   我有词鲸账号 → 邮箱 + 密码   → **跳过首启**，直接进「今日」（已有学习数据）

import * as auth from '../../services/auth';
import { select } from '../../services/gateway';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import { ApiError } from '../../services/types';
import * as store from '../../services/storage';

const DEFAULT_AVATAR =
  'data:image/svg+xml;base64,' +
  // 一个纯色圆 + 「活」字，避免引外链（小程序 image 不走白名单，但离线时外链会空白）
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjOTMzM2VhIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNjM2NmYxIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByeD0iNDgiIGZpbGw9InVybCgjZykiLz48dGV4dCB4PSI0OCIgeT0iNjIiIGZvbnQtc2l6ZT0iNDQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+5rS7PC90ZXh0Pjwvc3ZnPg==';

Page({
  data: {
    tab: 'wechat' as 'wechat' | 'cijing',
    agreed: false,
    showAuth: false,
    loading: false,
    error: '',
    email: '',
    password: '',
    nickname: '',
    avatarUrl: '',
    defaultAvatar: DEFAULT_AVATAR,
  },

  onLoad() {
    tracker.track(EV.APP_OPEN, { page: 'login' });
  },

  noop() {
    /* 挡住穿透点击 */
  },

  switchWechat() {
    this.setData({ tab: 'wechat', error: '' });
  },

  switchCijing() {
    this.setData({ tab: 'cijing', error: '' });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  onEmail(e: WechatMiniprogram.Input) {
    this.setData({ email: e.detail.value.trim(), error: '' });
  },

  onPassword(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value, error: '' });
  },

  onNickname(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({ avatarUrl: e.detail.avatarUrl });
  },

  requireAgreement(): boolean {
    if (this.data.agreed) return true;
    wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
    return false;
  },

  openAuthDialog() {
    if (!this.requireAgreement()) return;
    this.setData({ showAuth: true });
  },

  closeAuthDialog() {
    this.setData({ showAuth: false });
  },

  async confirmWechatLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      await auth.loginWithWeChat({
        nickname: this.data.nickname || undefined,
        avatarUrl: this.data.avatarUrl || undefined,
      });
      tracker.track(EV.LOGIN_SUCCESS, { provider: 'wechat' });
      this.setData({ showAuth: false });
      // 新用户去首启；已做过首启的（重装、换设备）直接进今日
      this.go(await this.needsOnboarding());
    } catch (e) {
      this.fail(e);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loginWithPassword() {
    if (this.data.loading) return;
    if (!this.requireAgreement()) return;
    const { email, password } = this.data;
    if (!email || !password) {
      this.setData({ error: '邮箱和密码都要填' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await auth.loginWithPassword(email, password);
      tracker.track(EV.LOGIN_SUCCESS, { provider: 'password' });
      // 走这条的用户**跳过首启三屏**（已有学习数据，不需要再测一次水平）
      this.go(false);
    } catch (e) {
      const err = e as ApiError;
      this.setData({
        error:
          err.kind === 'client' || err.status === 400
            ? '邮箱或密码不对'
            : err.kind === 'network'
              ? '网络不给力，检查一下再试'
              : err.message,
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** hc_profiles.onboarding_done_at 为空 = 还没做完首启 */
  async needsOnboarding(): Promise<boolean> {
    try {
      const rows = await select<{ onboarding_done_at: string | null }[]>(
        'hc_profiles?select=onboarding_done_at&limit=1'
      );
      return !rows[0]?.onboarding_done_at;
    } catch {
      return true; // 拿不准就走首启，最坏是多问 40 秒
    }
  },

  go(toOnboarding: boolean) {
    if (toOnboarding) {
      // TODO(P2/W2)：首启三屏还没做，先直接进今日，做完改回 pages/onboarding/onboarding
      wx.switchTab({ url: '/pages/today/today' });
      return;
    }
    wx.switchTab({ url: '/pages/today/today' });
  },

  enterGuest() {
    store.write('hc.guest', true);
    wx.switchTab({ url: '/pages/today/today' });
  },

  openTerms() {
    wx.showModal({ title: '用户服务协议', content: '协议正文待补（备案通过后指向 joy-coder.cn）', showCancel: false });
  },

  openPrivacy() {
    wx.showModal({ title: '隐私保护指引', content: '隐私政策待补（备案通过后指向 joy-coder.cn）', showCancel: false });
  },

  fail(e: unknown) {
    const err = e as ApiError;
    wx.showToast({ title: err.message || '登录失败', icon: 'none' });
  },
});
