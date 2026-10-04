// 自定义 tabBar。图标直接按 prototype 的 CartoonTabIcon SVG 落地。

import { RELEASE_FEATURES } from '../config/release';

const ITEMS = [
  { path: '/pages/today/today', text: '今日', icon: '/assets/ui/tab-today.svg', iconOn: '/assets/ui/tab-today-on.svg' },
  { path: '/pages/words/words', text: '我的生词', icon: '/assets/ui/tab-words.svg', iconOn: '/assets/ui/tab-words-on.svg' },
  ...(RELEASE_FEATURES.wordPacks
    ? [{ path: '/pages/wordpacks/wordpacks', text: '词包', icon: '/assets/ui/tab-pack.svg', iconOn: '/assets/ui/tab-pack-on.svg' }]
    : []),
  { path: '/pages/search/search', text: '查词', icon: '/assets/ui/tab-search.svg', iconOn: '/assets/ui/tab-search-on.svg' },
  { path: '/pages/profile/profile', text: '我的', icon: '/assets/ui/tab-profile.svg', iconOn: '/assets/ui/tab-profile-on.svg' },
];

Component({
  data: {
    active: 0,
    items: ITEMS,
  },
  methods: {
    go(e: WechatMiniprogram.TouchEvent) {
      const i = Number(e.currentTarget.dataset.index);
      const item = ITEMS[i];
      if (!item) return;
      this.setData({ active: i });
      wx.switchTab({ url: item.path });
    },
  },
});
