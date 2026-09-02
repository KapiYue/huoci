// ④ 查词（tab 3）。《执行方案》§6.4 —— 本次垂直切片未实现。
Page({
  data: { note: '输入 → 服务端查词（复用词鲸 lookup-word）→ 拼写 / 音标 / 释义 / 🔊 / 例句 → ＋ 加入我的活词。\n输入框防抖 300ms，全量词典永不下发。' },
  onShow() { this.getTabBar?.()?.setData({ active: 2 }); },
});
