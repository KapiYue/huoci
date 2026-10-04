import * as auth from './services/auth';
import * as membership from './services/membership';
import * as tracker from './services/tracker';
import { flush as flushReviews } from './services/reviewQueue';
import { EV } from './shared/events';
import { RELEASE_FEATURES } from './config/release';

interface GlobalData {
  /** 自定义 tabBar 的当前选中项 */
  tabIndex: number;
  /** 最近一次 flush 后是否还有没补发的复习，用来在首页挂离线角标 */
  pendingReviews: number;
}

App<{ globalData: GlobalData; syncPending(): Promise<void> }>({
  globalData: {
    tabIndex: 0,
    pendingReviews: 0,
  },

  onLaunch() {
    // 每天首次进来把 AI 额度补足到保底值（`[09-03]` 不卖 Credits，只送）
    if (RELEASE_FEATURES.aiQuota) membership.ensureDailyFree();
    tracker.startSession();
    tracker.track(EV.APP_OPEN, { is_new: !auth.isLoggedIn() });
    // 冷启先把上次没发出去的复习补上（通勤断网是常态，T1-c）
    void this.syncPending();
  },

  onShow() {
    void this.syncPending();
  },

  onHide() {
    void tracker.flush();
  },

  async syncPending() {
    if (!auth.isLoggedIn()) return;
    const res = await flushReviews();
    this.globalData.pendingReviews = res.remaining;
    await tracker.flush();
  },
});
