// ③ 我的生词（tab 2）。还原对象：`docs/prototype/src/components/WordsTab.tsx`。
//
//   我的生词                       已激活 83 / 全部 183
//   [ 搜索框 ]
//   [全部] [最近遇到] [待复习] [已激活]     ← `[09-03]` 原型是四个，比 §5.4 S6 多一个「全部」
//
// 四个 tab 里只有三个走服务端：`hc_list_words` 的 recent / due / activated。
// 「最近遇到」= 在 recent 那一页上再筛掉底座词（原型的判据就是「有真实来源」），
// 这一步能放客户端是因为 recent 本来就按 created_at 倒序，筛掉的是穿插其间的底座词，
// **不影响分页正确性**。
//
// 三条硬约束：
//   1. **来源行不许留空**——底座词显示「首启添加」，capture 词显示「GitHub · 2 小时前」
//   2. 空态引导指向**阅读器**，不是「装插件」（微信端点不出来那个动作）
//   3. 长列表不要一次 setData 几百条（§14.3）——分页 + 触底加载 + 追加时按下标 patch

import * as words from '../../services/words';
import * as learning from '../../services/learning';
import * as onboarding from '../../services/onboarding';
import type { WordFilter } from '../../services/words';
import type { StudyCard } from '../../shared/types';
import { wordStatus } from '../../shared/wordStatus';
import * as theme from '../../services/theme';

/** 界面上的四个 tab。`server` 是它实际打到哪个 RPC 筛选 */
type UiFilter = 'all' | 'recent' | 'due' | 'activated';

const UI_FILTERS: { id: UiFilter; label: string; server: WordFilter }[] = [
  { id: 'all', label: '全部', server: 'recent' },
  { id: 'recent', label: '最近遇到', server: 'recent' },
  { id: 'due', label: '待复习', server: 'due' },
  { id: 'activated', label: '已激活', server: 'activated' },
];

interface Row extends StudyCard {
  /** 底座词与 capture 词的视觉差异是**刻意**的（§5.1 全局视觉主张） */
  isBase: boolean;
  activated: boolean;
  statusLabel: string;
  activatedDate: string;
}

function toRow(c: StudyCard): Row {
  const st = wordStatus(c);
  return {
    ...c,
    isBase: c.contextSentence === null && c.contextSource === '首启添加',
    activated: st === 'activated' || st === 'mastered',
    statusLabel: st === 'activated' || st === 'mastered' ? '活词' : st === 'captured' ? '刚收进' : '学习中',
    activatedDate: c.activatedAt ? c.activatedAt.slice(0, 10) : '还没激活',
  };
}

Page({
  data: {
    themeClass: '',
    filters: UI_FILTERS,
    filter: 'all' as UiFilter,
    query: '',
    /** 服务端拉回来的原始页 */
    rows: [] as Row[],
    /** 实际渲染的那一份（= rows 过一遍 tab 的客户端规则与搜索词） */
    view: [] as Row[],
    total: 0,
    activatedTotal: 0,
    loading: false,
    /** 还有下一页。触底才加载，不预取 */
    hasMore: true,
    stale: false,
    ready: false,
    /** 词详情抽屉（原型的 Word Detail Drawer） */
    detail: null as Row | null,
  },

  onShow() {
    theme.apply(this);
    if (onboarding.guard()) return;
    this.getTabBar?.()?.setData({ active: 1 });
    void this.reload();
  },

  onPullDownRefresh() {
    void this.reload().then(() => wx.stopPullDownRefresh());
  },

  /** 触底加载下一页。§14.3：一次只追加一页，不重建整个数组 */
  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return;
    void this.loadMore();
  },

  serverFilter(): WordFilter {
    const f = UI_FILTERS.find((x) => x.id === this.data.filter);
    return f ? f.server : 'recent';
  },

  /** 客户端还要不要再筛一道。只有「最近遇到」和搜索会 */
  clientFiltered(): boolean {
    return this.data.filter === 'recent' || this.data.query.length > 0;
  },

  computeView(rows: Row[]): Row[] {
    const q = this.data.query.trim().toLowerCase();
    return rows.filter((r) => {
      // 「最近遇到」= 有真实来源的词（原型的判据）。底座词不算「遇到」，它是系统给的
      if (this.data.filter === 'recent' && r.isBase) return false;
      if (!q) return true;
      return r.term.toLowerCase().indexOf(q) >= 0 || r.meaning.toLowerCase().indexOf(q) >= 0;
    });
  },

  switchFilter(e: WechatMiniprogram.BaseEvent<Record<string, never>, { id: UiFilter }>) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.filter) return;
    const prev = this.serverFilter();
    this.setData({ filter: id, hasMore: true });
    // 「全部」和「最近遇到」打的是同一个 RPC，切它俩不用重新请求
    if (this.serverFilter() === prev && this.data.rows.length > 0) {
      this.setData({ view: this.computeView(this.data.rows) });
      return;
    }
    this.setData({ rows: [], view: [], ready: false });
    void this.reload();
  },

  onSearch(e: WechatMiniprogram.Input) {
    this.setData({ query: e.detail.value }, () => {
      this.setData({ view: this.computeView(this.data.rows) });
    });
  },

  clearSearch() {
    this.setData({ query: '' }, () => {
      this.setData({ view: this.computeView(this.data.rows) });
    });
  },

  async reload() {
    // 先吐缓存：切筛选时列表不该先空一下再跳出来
    const cached = words.cachedWords(this.serverFilter());
    if (cached) {
      const rows = cached.map(toRow);
      this.setData({ rows, view: this.computeView(rows), ready: true });
    }

    this.setData({ loading: true });
    try {
      const [page, summary] = await Promise.all([
        words.fetchWords(this.serverFilter(), 0),
        learning.fetchHomeSummary(),
      ]);
      const rows = page.data.map(toRow);
      this.setData({
        rows,
        view: this.computeView(rows),
        total: summary.data.total_words,
        activatedTotal: summary.data.activated_count,
        hasMore: page.data.length >= words.PAGE_SIZE,
        stale: page.stale,
        ready: true,
      });
    } catch (e) {
      wx.showToast({ title: (e as Error).message || '加载失败', icon: 'none' });
      this.setData({ ready: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMore() {
    this.setData({ loading: true });
    try {
      const page = await words.fetchWords(this.serverFilter(), this.data.rows.length);
      if (page.data.length > 0) {
        const start = this.data.rows.length;
        const added = page.data.map(toRow);
        if (this.clientFiltered()) {
          // 有客户端筛选时才重建 view —— 这一支下的行数本来就少
          const rows = this.data.rows.concat(added);
          this.setData({ rows, view: this.computeView(rows) });
        } else {
          // 常态：只按下标追加，不重建 —— 200 词的列表重建一次 setData 就是几百 KB
          const patch: Record<string, Row> = {};
          added.forEach((r, i) => {
            patch[`rows[${start + i}]`] = r;
            patch[`view[${start + i}]`] = r;
          });
          this.setData(patch);
        }
      }
      this.setData({ hasMore: page.data.length >= words.PAGE_SIZE });
    } catch {
      this.setData({ hasMore: false });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ---------------- 词详情抽屉 ----------------

  openDetail(e: WechatMiniprogram.BaseEvent) {
    const id = e.currentTarget.dataset.id as string;
    const row = this.data.rows.find((r) => r.wordId === id);
    if (row) this.setData({ detail: row });
  },

  closeDetail() {
    this.setData({ detail: null });
  },

  /** 空态的出口（§5.7 R5）。`[09-03]` 阅读器已经实现，直接进页面 */
  openReader() {
    wx.navigateTo({ url: '/pages/reader/reader' });
  },

  openSearch() {
    wx.switchTab({ url: '/pages/search/search' });
  },

  noop() { /* 挡住抽屉后面的滚动 */ },
});
