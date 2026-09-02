// 自定义 tabBar。用它而不是 app.json 的原生 list，是为了跟原型的图标风格对齐
// ——原生 tabBar 只吃 PNG，换一版图标就要重出六张图。

const ITEMS = [
  { path: '/pages/today/today', text: '今日', icon: '◷', iconOn: '◉' },
  { path: '/pages/words/words', text: '我的生词', icon: '☰', iconOn: '▤' },
  { path: '/pages/search/search', text: '查词', icon: '⌕', iconOn: '⌕' },
  { path: '/pages/profile/profile', text: '我的', icon: '☺', iconOn: '☻' },
] as const;

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
