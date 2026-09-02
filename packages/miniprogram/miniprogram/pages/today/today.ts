// ① 今日。《执行方案》§6.1
//
//   今天
//     7 个词需要复习
//     13 个新词
//     [ 开始学习 ]
//   ─────────────
//   连续学习 6 天
//   已经激活 83 个活词      ← §3 的 activated，P2 就有数

import * as learning from '../../services/learning';
import * as auth from '../../services/auth';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import { wordStatus } from '../../shared/wordStatus';
import type { WordStatus } from '../../shared/wordStatus';
import type { StudyCard } from '../../shared/types';

const STATUS_LABEL: Record<WordStatus, { label: string; badge: string }> = {
  captured: { label: '刚收进', badge: '📥' },
  learning: { label: '学习中', badge: '🌱' },
  remembered: { label: '已记住', badge: '🧠' },
  activated: { label: '活词', badge: '✨' },
  mastered: { label: '能说出', badge: '👑' },
};

interface RecentItem extends StudyCard {
  status: WordStatus;
  statusLabel: string;
  badge: string;
}

const DEFAULT_AVATAR =
  'data:image/svg+xml;base64,' +
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjOTMzM2VhIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNjM2NmYxIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByeD0iNDgiIGZpbGw9InVybCgjZykiLz48dGV4dCB4PSI0OCIgeT0iNjIiIGZvbnQtc2l6ZT0iNDQiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiI+5rS7PC90ZXh0Pjwvc3ZnPg==';

Page({
  data: {
    displayName: '微信用户',
    avatarUrl: '',
    defaultAvatar: DEFAULT_AVATAR,
    isVip: false,
    summary: learning.EMPTY_SUMMARY,
    recent: [] as RecentItem[],
    total: 0,
    cap: 20,
    stale: false,
    pending: 0,
    refreshing: false,
    weekDays: ['一', '二', '三', '四', '五', '六', '日'],
    mascotMessage: '今天有几个词进入了遗忘临界点，来完成一次巩固吧！',
  },

  onLoad() {
    const s = auth.getSession();
    if (s) this.setData({ displayName: s.displayName });
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setTab();
    void this.load();
  },

  setTab() {
    const tabbar = this.getTabBar?.();
    if (tabbar) tabbar.setData({ active: 0 });
  },

  async onPullRefresh() {
    this.setData({ refreshing: true });
    // 下拉是用户明确要最新，绕开 TTL
    wx.removeStorageSync('hc.cache.plan');
    await this.load();
    this.setData({ refreshing: false });
  },

  async load() {
    try {
      const [summary, queue] = await Promise.all([
        learning.fetchHomeSummary(),
        learning.fetchStudyQueue(20),
      ]);

      const recent: RecentItem[] = queue.data.slice(0, 3).map((c) => {
        const st = wordStatus(c);
        return { ...c, status: st, statusLabel: STATUS_LABEL[st].label, badge: STATUS_LABEL[st].badge };
      });

      const total = summary.data.due_count + summary.data.new_count;
      this.setData({
        summary: summary.data,
        recent,
        total,
        cap: Math.round(summary.data.daily_goal * 1.5),
        stale: summary.stale || queue.stale,
        pending: learning.pendingReviews(),
        mascotMessage:
          total === 0
            ? '今天的队列已经清空了，休息一下，明天见 🌙'
            : `今天有 ${summary.data.due_count} 个词进入了遗忘临界点，来完成一次巩固吧！`,
      });
    } catch (e) {
      wx.showToast({ title: (e as Error).message || '加载失败', icon: 'none' });
    }
  },

  startStudy() {
    if (this.data.total === 0) return;
    tracker.track(EV.STUDY_SESSION_START, {
      due_count: this.data.summary.due_count,
      new_count: this.data.summary.new_count,
    });
    wx.navigateTo({ url: '/pages/study/study' });
  },

  openWords() {
    wx.switchTab({ url: '/pages/words/words' });
  },

  openSearch() {
    wx.switchTab({ url: '/pages/search/search' });
  },

  openReader() {
    // P3（W4）。现在先说清楚它是什么，别让用户点进死路。
    wx.showModal({
      title: '阅读器',
      content: '贴入一篇你自己的文章，点词就能连原句和来源一起收进来。这个功能正在做，下周见。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  openVip() {
    wx.showModal({
      title: '会员中心',
      content: '会员页正在做。⚠️ 微信支付要等主体变更 + 微信认证完成才能开通，目前只能看不能买。',
      showCancel: false,
      confirmText: '知道了',
    });
  },
});
