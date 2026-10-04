// W2 词包详情 / W3 接收分享。还原对象：`docs/prototype/src/components/WordPacksTab.tsx`。
//
// W3 的关键一条：**未登录用户点开分享 → 先走 S0 登录，登录后直接回到这一屏**，
// 不要把人丢到首页（原型明写）。这里用 `redirect` 参数把回跳地址带过去。

import * as packs from '../../services/wordpacks';
import * as auth from '../../services/auth';
import * as theme from '../../services/theme';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import type { PackWord, WordPack } from '../../services/wordpacks';
import { guardReleaseFeature } from '../../config/release';

const STATUS_LABEL: Record<PackWord['status'], { label: string; cls: string }> = {
  activated: { label: '已激活', cls: 'activated' },
  learning: { label: '学习中', cls: 'learning' },
  unlearned: { label: '未学', cls: 'unlearned' },
};

interface WordVM extends PackWord {
  statusLabel: string;
  badgeClass: string;
}

Page({
  data: {
    themeClass: '',
    isShare: false,
    sharerName: '朋友',
    packId: '',
    pack: null as (WordPack & { words: WordVM[] }) | null,
    joined: false,
    preview: '',
    shareVisible: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    if (guardReleaseFeature('wordPacks')) return;
    const id = query.id || '';
    const isShare = query.from === 'share';

    // 未登录就先去登录，登录完回到这一屏 —— 别把收到分享的人丢回首页
    if (isShare && !auth.isLoggedIn()) {
      const back = encodeURIComponent(`/pages/packdetail/packdetail?id=${id}&from=share`);
      wx.redirectTo({ url: `/pages/login/login?redirect=${back}` });
      return;
    }

    const pack = packs.find(id);
    if (!pack) {
      wx.showToast({ title: '这个词包不在了', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }

    this.setData({
      isShare,
      packId: id,
      sharerName: query.by ? decodeURIComponent(query.by) : '朋友',
      pack: {
        ...pack,
        words: pack.words.map((w) => ({
          ...w,
          statusLabel: STATUS_LABEL[w.status].label,
          badgeClass: STATUS_LABEL[w.status].cls,
        })),
      },
      preview: pack.words.slice(0, 3).map((w) => w.spelling).join(' / ') + ' …',
    });
    wx.setNavigationBarTitle({ title: isShare ? '接收词包' : pack.title });
  },

  onShow() {
    theme.apply(this);
    this.setData({ joined: packs.isSubscribed(this.data.packId) });
  },

  join() {
    packs.subscribe(this.data.packId);
    tracker.track(EV.WORDPACK_ADDED, { pack_id: this.data.packId, from: 'detail' });
    this.setData({ joined: true });
    wx.showToast({ title: '加入后，今日队列开始出这个包的词', icon: 'none' });
  },

  /** 收下即 fork 一份到自己账号，不做「关注原包 / 同步更新」 */
  receive() {
    packs.subscribe(this.data.packId);
    tracker.track(EV.WORDPACK_ADDED, { pack_id: this.data.packId, from: 'share' });
    this.setData({ joined: true });
    wx.switchTab({ url: '/pages/today/today' });
  },

  startStudy() {
    wx.switchTab({ url: '/pages/today/today' });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/wordpacks/wordpacks' }) });
  },

  openShare() { this.setData({ shareVisible: true }); },
  closeShare() { this.setData({ shareVisible: false }); },

  /** 移除要二次确认，且说清楚「已经学过的词留在生词本里，不会被删」 */
  remove() {
    wx.showModal({
      title: '移除这个词包',
      content: '移除后今日队列不再出这个包的新词。已经学过的词留在你的生词本里，不会被删。',
      confirmText: '移除',
      confirmColor: '#e11d48',
      success: (res) => {
        if (!res.confirm) return;
        packs.unsubscribe(this.data.packId);
        tracker.track(EV.WORDPACK_REMOVED, { pack_id: this.data.packId });
        this.setData({ joined: false });
      },
    });
  },

  onShareAppMessage() {
    const p = this.data.pack;
    tracker.track(EV.WORDPACK_SHARED, { pack_id: this.data.packId });
    return {
      title: p ? `${p.title} · ${p.totalWords} 词` : '一个词包送你',
      path: `/pages/packdetail/packdetail?id=${this.data.packId}&from=share`,
    };
  },

  noop() { /* 挡住分享弹层后的滚动 */ },
});
