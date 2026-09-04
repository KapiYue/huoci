// ① 今日（tab 1）。还原对象：`docs/prototype/src/components/TodayTab.tsx`。
//
//   [头像] 昵称 VIP            会员中心 💎
//   (o o) 今天有 N 个词进入了遗忘临界点
//   ┌ 今日记忆队列 ────── 上限 20 词/轮 ┐
//   │ 7 个词需要复习 · 13 个新词待学习   │
//   │ [ ▶ 开始今日学习（20 词） ]        │
//   └───────────────────────────────┘
//   [连续学习 6 天 + 周点阵] [已激活 83 个 →]
//   今日小目标 · 场景触达   → 阅读器 / 查词
//   最近遇到的词  查看全部（N）→   ← S6「最近遇到」的前 3 条，带来源行

import * as learning from '../../services/learning';
import * as wordsSvc from '../../services/words';
import * as auth from '../../services/auth';
import * as tracker from '../../services/tracker';
import * as membership from '../../services/membership';
import { EV } from '../../shared/events';
import { wordStatus } from '../../shared/wordStatus';
import type { WordStatus } from '../../shared/wordStatus';
import type { StudyCard } from '../../shared/types';
import * as onboarding from '../../services/onboarding';
import * as theme from '../../services/theme';

const STATUS_LABEL: Record<WordStatus, { label: string; badge: string }> = {
  captured: { label: '刚收进', badge: '📥' },
  learning: { label: '学习中', badge: '🌱' },
  remembered: { label: '已记住', badge: '🧠' },
  activated: { label: '活词', badge: '✨' },
  mastered: { label: '能说出', badge: '👑' },
};

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

interface RecentItem extends StudyCard {
  status: WordStatus;
  statusLabel: string;
  badge: string;
}

/** 一句问候。按时段给，不按主题给 —— 小程序的深色是系统级的，用户不一定在夜里 */
function greetingText(): string {
  const h = new Date().getHours();
  if (h < 6) return '夜里也在啃词，悠着点 🌙';
  if (h < 11) return '今天又是让单词活起来的一天 ✨';
  if (h < 18) return '抽三分钟，把到期的词过一遍 ☕';
  return '睡前这一轮，明天早上还记得 🌙';
}

Page({
  data: {
    themeClass: '',
    summary: learning.EMPTY_SUMMARY,
    recent: [] as RecentItem[],
    total: 0,
    stale: false,
    pending: 0,
    refreshing: false,
    mascotMessage: '今天有几个词进入了遗忘临界点，来完成一次巩固吧！',
    displayName: '微信用户',
    avatarUrl: '',
    credits: 0,
    greeting: greetingText(),
    weekDots: WEEK_LABELS.map((label) => ({ label, on: false })),
    miniTaskLeft: 3,
  },

  onShow() {
    theme.apply(this);
    // 顺序不能反：先看有没有登录，再看首启做没做完。
    // 反过来会把「没登录」的人送进首启，做完 40 秒再告诉他要登录。
    if (!auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    if (onboarding.guard()) return;
    this.setTab();
    this.loadIdentity();
    // 首启结果没落库就补一次（S3 那次可能碰上地铁）。已落库时是纯本地判断，不发请求。
    // 必须排在 load() 之前：播种词就是队列本身，补库之后才拉得到东西。
    void onboarding.sync().then(() => this.load());
  },

  setTab() {
    const tabbar = this.getTabBar?.();
    if (tabbar) tabbar.setData({ active: 0 });
  },

  /** 头像 / 昵称 / 会员态。全是本地已有的东西，不发请求，所以能先于 load() 画出来 */
  loadIdentity() {
    const s = auth.getSession();
    // 每天首次进来把额度补足到保底值。放这里而不是只放 app.onLaunch：
    // 小程序常驻后台好几天，onLaunch 可能一次都不再触发
    const m = membership.ensureDailyFree();
    this.setData({
      displayName: s ? s.displayName : '微信用户',
      avatarUrl: s && s.avatarUrl ? s.avatarUrl : '',
      credits: m.credits,
      greeting: greetingText(),
    });
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
      // 「最近遇到的词」走 S6 的 recent 筛选，**不是队列的前 3 张卡**：
      // 队列答的是「今天要学什么」，这一块答的是「我最近撞见了什么」——后者才是来源行的兑现处。
      // 顺带把 S6 第一页的缓存预热了（同一个 cacheKey），点进「我的生词」不会空一下。
      // 单独 catch：这一块塌了不该拖垮上面的数字和「开始学习」。
      const [summary, queue, recentWords] = await Promise.all([
        learning.fetchHomeSummary(),
        learning.fetchStudyQueue(20),
        wordsSvc.fetchWords('recent').catch(() => ({ data: [], stale: true })),
      ]);

      const recent: RecentItem[] = recentWords.data.slice(0, 3).map((c) => {
        const st = wordStatus(c);
        return { ...c, status: st, statusLabel: STATUS_LABEL[st].label, badge: STATUS_LABEL[st].badge };
      });

      const total = summary.data.due_count + summary.data.new_count;
      const streak = summary.data.streak_days;

      // 连续学习到里程碑就发额度。每个里程碑只发一次（判据在 membership 里）。
      // ⚠️ 这是**陈述句的延伸，不是打卡奖励**：断了不补发、不弹「别灰心」、不放火苗。
      const bonus = membership.claimStreakBonus(streak);
      if (bonus > 0) {
        wx.showToast({ title: `连续学习 ${streak} 天，+${bonus} 次 AI 额度`, icon: 'none', duration: 2200 });
      }
      this.setData({
        summary: summary.data,
        recent,
        total,
        stale: summary.stale || queue.stale,
        pending: learning.pendingReviews(),
        weekDots: WEEK_LABELS.map((label, i) => ({ label, on: i < streak })),
        credits: membership.get().credits,
        // 三件事：把今天的队列过一遍 / 读一篇文章 / 查一个词。
        // 后两件没有「今天做没做过」的记录，所以只有第一件会真的减 —— 不假装追踪。
        miniTaskLeft: summary.data.reviewed_today > 0 ? 2 : 3,
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

  openProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  /** AI 额度页。`[09-03]` 不卖 Credits 之后这里不再是「充值」，是「额度从哪来」 */
  openVip() {
    wx.navigateTo({ url: '/pages/vip/vip' });
  },

  openReader() {
    wx.navigateTo({ url: '/pages/reader/reader' });
  },
});
