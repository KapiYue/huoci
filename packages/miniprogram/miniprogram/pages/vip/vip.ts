// AI 额度页。原型是 `VipModal.tsx`（M1–M4），但 `[09-03 裁决]` 小程序内**不卖**，
// 所以默认形态是「额度从哪来」，售卖那套被 membership.SELL_ENABLED 关着（理由见那个文件抬头）。
//
// 入口只有两处：「今日」页顶部、「我的」页顶部的状态卡。不做全局角标、不在别处弹浮层。

import * as membership from '../../services/membership';
import * as pay from '../../services/pay';
import * as tracker from '../../services/tracker';
import * as theme from '../../services/theme';
import { EV } from '../../shared/events';
import type { CreditPack } from '../../services/membership';
import { guardReleaseFeature } from '../../config/release';

type PayState = 'idle' | 'confirm' | 'paying' | 'success' | 'failed';

const DEFAULT_PACK = membership.CREDIT_PACKS[1] as CreditPack;

Page({
  data: {
    themeClass: '',
    sellEnabled: membership.SELL_ENABLED,
    credits: 0,
    isVip: false,
    vipExpiry: '',
    balanceNote: '',

    dailyFree: membership.DAILY_FREE,
    streakMilestone: membership.STREAK_MILESTONE,
    streakBonus: membership.STREAK_BONUS,

    adReady: pay.adReady(),
    adHint: pay.adUnavailableHint(),
    adReward: membership.AD_REWARD,
    adLimit: membership.AD_DAILY_LIMIT,
    adWatched: 0,
    adDisabled: false,
    adBtnText: '看广告',

    packs: membership.CREDIT_PACKS,
    selectedId: DEFAULT_PACK.id,
    selected: DEFAULT_PACK,
    payState: 'idle' as PayState,
    payError: '',
  },

  onShow() {
    if (guardReleaseFeature('aiQuota')) return;
    theme.apply(this);
    this.refresh();
    tracker.track(EV.SALES_VIEW, { sell_enabled: membership.SELL_ENABLED, ad_ready: pay.adReady() });
  },

  refresh() {
    const m = membership.get();
    this.setData({
      credits: m.credits,
      isVip: m.isVip,
      vipExpiry: m.vipExpiry || '',
      // 余额为 0 时说清楚停的是哪些功能，且必须写明学习功能不受影响
      balanceNote:
        m.credits > 0
          ? `还能进行约 ${m.credits} 轮 AI 场景对话或短文生成`
          : 'AI 场景对话与短文暂停；生词、复习、查词、阅读、词包、排行榜一个都不受影响',
      adWatched: m.adWatchedToday,
      adDisabled: m.adWatchedToday >= membership.AD_DAILY_LIMIT,
      adBtnText: m.adWatchedToday >= membership.AD_DAILY_LIMIT ? '已达上限' : '看广告',
    });
  },

  selectPack(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    const selected = membership.CREDIT_PACKS.find((p) => p.id === id);
    if (selected) this.setData({ selectedId: id, selected });
  },

  // ---------------- 售卖模式才走得到（SELL_ENABLED=true） ----------------

  openConfirm() {
    this.setData({ payState: 'confirm', payError: '' });
  },

  /** 用户取消：停在原页，**不弹任何挽留** */
  cancelPay() {
    this.setData({ payState: 'idle', payError: '' });
  },

  async confirmPay() {
    const pack = this.data.selected;
    this.setData({ payState: 'paying' });
    const res = await pay.purchase(pack);
    if (res.ok) {
      tracker.track(EV.CREDITS_PURCHASED, { pack_id: pack.id, credited: res.credited });
      this.refresh();
      this.setData({ payState: 'success' });
    } else {
      this.setData({ payState: 'failed', payError: res.message || '网络超时或支付被取消，没有扣费。' });
    }
  },

  /** 成功后回到来处，不是回首页 */
  finishSuccess() {
    this.setData({ payState: 'idle' });
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) });
  },

  // ---------------- 激励视频 ----------------

  async watchAd() {
    if (this.data.adDisabled) return;
    this.setData({ adDisabled: true, adBtnText: '加载中…' });
    const res = await pay.watchRewardedAd();
    if (res.ok) tracker.track(EV.AD_REWARDED, { credited: res.credited });
    this.refresh();
    wx.showToast({
      title: res.ok ? `已到账 ${res.credited} 次` : res.message || '没能看完',
      icon: 'none',
    });
  },

  noop() {
    /* 挡住蒙层后面的滚动与点击 */
  },
});
