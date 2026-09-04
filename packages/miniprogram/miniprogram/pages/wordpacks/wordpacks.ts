// 词包 W1（tab 3）。还原对象：`docs/prototype/src/components/WordPacksTab.tsx`。
//
// 词包是**供给层**，不改调度算法：加了包只影响新词的来源与优先级
// （capture 的词 > 词包 > 底座词）。tabbar 位置插在「查词」之前。

import * as packs from '../../services/wordpacks';
import * as onboarding from '../../services/onboarding';
import * as theme from '../../services/theme';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import type { WordPack } from '../../services/wordpacks';

interface PackVM extends WordPack {
  percent: number;
  joined: boolean;
}

function toVM(p: WordPack): PackVM {
  return {
    ...p,
    percent: p.totalWords > 0 ? Math.round((p.activatedWords / p.totalWords) * 100) : 0,
    joined: packs.isSubscribed(p.id),
  };
}

Page({
  data: {
    themeClass: '',
    mine: [] as PackVM[],
    recommended: [] as PackVM[],
    exams: [] as PackVM[],
    customs: [] as PackVM[],
    creating: false,
    newTitle: '',
  },

  onShow() {
    if (onboarding.guard()) return;
    this.getTabBar?.()?.setData({ active: 2 });
    theme.apply(this);
    this.refresh();
  },

  refresh() {
    const scenes = onboarding.selectedScenes();
    this.setData({
      mine: packs.subscribed().map(toVM),
      recommended: packs.recommended(scenes).map(toVM),
      exams: packs.exams().map(toVM),
      customs: packs.customs().map(toVM),
    });
  },

  openPack(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/packdetail/packdetail?id=${id}` });
  },

  addPack(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (packs.isSubscribed(id)) return;
    packs.subscribe(id);
    tracker.track(EV.WORDPACK_ADDED, { pack_id: id, from: 'list' });
    this.refresh();
    wx.showToast({ title: '已加入，今日队列开始出这个包的词', icon: 'none' });
  },

  sharePack(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    const pack = packs.find(id);
    if (!pack) return;
    tracker.track(EV.WORDPACK_SHARED, { pack_id: id });
    // 微信规定分享必须由用户主动触发，所以这里只能提示去用右上角转发，不能代为拉起
    wx.showModal({
      title: '分享词包',
      content: `点右上角「···」转发给朋友，卡片会带上「${pack.title} · ${pack.totalWords} 词」和前几个词的预览。`,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  openCreate() { this.setData({ creating: true, newTitle: '' }); },
  closeCreate() { this.setData({ creating: false }); },
  onTitle(e: WechatMiniprogram.Input) { this.setData({ newTitle: e.detail.value }); },

  confirmCreate() {
    const title = this.data.newTitle.trim();
    if (!title) {
      wx.showToast({ title: '先给它起个名字', icon: 'none' });
      return;
    }
    packs.createCustom(title);
    this.setData({ creating: false });
    this.refresh();
  },

  /**
   * tab 页的转发 = 转发小程序本身，**不替用户挑一个包**。
   * 想分享某个包，进那个包的详情页用右上角转发（带 from=share，落到 W3 接收屏）。
   */
  onShareAppMessage() {
    return { title: '活词 · 把撞见的英文生词练到能说出口', path: '/pages/today/today?scene=share' };
  },

  noop() { /* 挡住蒙层后面的滚动 */ },
});
