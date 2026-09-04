// 开源许可。`design.md` §5.4 S8 + dev-todo T5。
//
// ⚠️ **这是许可证义务，不是可选项。** 内置的 4,553 词底座来自 NGSL / BSL 系列词表，
// 按 CC BY-SA 4.0 必须署名。署名信息不写死在这里，从词包里读 ——
// 词包换了署名就跟着换，两处各写一份迟早对不上。

import * as onboarding from '../../services/onboarding';
import * as theme from '../../services/theme';

Page({
  data: {
    themeClass: '',
    license: '',
    licenseUrl: '',
    authors: '',
  },

  onLoad() {
    theme.apply(this);
    this.setData(onboarding.attribution());
  },

  /** 小程序打不开外链，把链接给用户复制走 —— 义务是「可获取」，不是「可点击」 */
  copyUrl() {
    wx.setClipboardData({
      data: this.data.licenseUrl,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
    });
  },
});
