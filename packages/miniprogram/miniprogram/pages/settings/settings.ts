// 设置。`design.md` §5.4 S8 的「设置」入口。
//
// P2 只有一项：每日目标。
//   level_line 是首启测出来的，**不给手改** —— 手改一个测量结果，测量就没意义了
//   active_pack_ids 在 P2 恒为 {base}（§9.1），P4 有词包了再说
//   **没有「数据同步」开关**（§5.4 S8：伪命题，三端读写同一份数据）
//
// 写走 `hc_update_profile` RPC —— `wx.request` 没有 PATCH（§11 ③）。

import * as profile from '../../services/profile';
import { ApiError } from '../../services/types';
import * as theme from '../../services/theme';

Page({
  data: {
    themeClass: '',
    options: profile.GOAL_OPTIONS,
    goal: 20,
    busy: false,
  },

  onLoad() {
    theme.apply(this);
    this.setData({ goal: profile.cachedProfile().daily_goal });
    void profile.fetchProfile().then((row) => this.setData({ goal: row.daily_goal }));
  },

  async pick(e: WechatMiniprogram.BaseEvent<Record<string, never>, { goal: string }>) {
    const goal = Number(e.currentTarget.dataset.goal);
    if (this.data.busy || goal === this.data.goal) return;
    const prev = this.data.goal;
    // 先改 UI 再落库：这是一个可回滚的小写入，等一次跨境往返不值得
    this.setData({ goal, busy: true });
    try {
      await profile.setDailyGoal(goal);
    } catch (err) {
      this.setData({ goal: prev });
      wx.showToast({ title: (err as ApiError).message || '没保存上', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },
});
