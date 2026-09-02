import * as auth from './services/auth';
import * as tracker from './services/tracker';
import { flush as flushReviews } from './services/reviewQueue';
import { EV } from './shared/events';

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
