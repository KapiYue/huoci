// 首启三屏。`design.md` §5.3 S1 / S2 / S3。目标：**40 秒走完**。
//
// 三屏放一个 page 而不是三个路由：中途没有可返回的中间态，
// 拆成三个路由只会让「后退」把用户丢回半截流程里。
//
// 三条硬约束（§5.3 + §12 红线 14）：
//   S1  仅埋点，**不影响任何算法**
//   S2  文案固定「哪些词你说不出口？」，**不得出现「英语水平测试」**，只显示拼写不显示释义
//   S3  **不显示分数、不显示星级、不显示等级**

import * as onboarding from '../../services/onboarding';
import * as tracker from '../../services/tracker';
import { EV } from '../../shared/events';
import { SEED_COUNT, type BaseWord } from '../../shared/onboarding';
import * as theme from '../../services/theme';

interface SceneOption {
  id: string;
  label: string;
  desc: string;
  icon: string;
}

/** §5.3 S1 列的七项，一项不多一项不少 */
const SCENES: SceneOption[] = [
  { id: 'tech_doc', label: '技术文档', desc: 'API / MDN / 官方手册', icon: '📄' },
  { id: 'saas', label: '产品 SaaS', desc: 'Figma / Notion / Linear', icon: '🧩' },
  { id: 'email', label: '工作邮件', desc: '邮件 / Slack / 会议', icon: '✉️' },
  { id: 'article', label: '行业文章', desc: '资讯 / 博客 / 周刊', icon: '📰' },
  { id: 'github', label: 'GitHub', desc: 'Issue / PR / Code Review', icon: '🐙' },
  { id: 'paper', label: '论文', desc: 'arXiv / 期刊', icon: '🎓' },
  { id: 'other', label: '其他', desc: '别的场景', icon: '✨' },
];

interface WordCell {
  spelling: string;
  band: number;
  checked: boolean;
}

Page({
  data: {
    themeClass: '',
    step: 1 as 1 | 2 | 3,
    scenes: SCENES,
    selectedScenes: [] as string[],

    words: [] as WordCell[],
    checkedCount: 0,

    seedCount: SEED_COUNT,
    seededCount: 0,
    isHighLevel: false,
    /** S3 结果卡上的「匹配场景」一行 */
    sceneLabels: '',

    busy: false,
  },

  /** 抽样结果的完整对象。data 里只放渲染要用的字段，避免 setData 拷大对象 */
  pool: [] as BaseWord[],

  onLoad() {
    theme.apply(this);
    tracker.track(EV.ONBOARDING_START);
    try {
      this.pool = onboarding.sampleQuestions();
    } catch (e) {
      console.error('[onboarding] 词表读取失败', e);
      this.pool = [];
    }
    this.setData({
      words: this.pool.map((w) => ({ spelling: w.spelling, band: w.band, checked: false })),
    });
  },

  // ---------------- S1 场景勾选 ----------------

  toggleScene(e: WechatMiniprogram.BaseEvent<Record<string, never>, { id: string }>) {
    const { id } = e.currentTarget.dataset;
    const next = this.data.selectedScenes.includes(id)
      ? this.data.selectedScenes.filter((s) => s !== id)
      : [...this.data.selectedScenes, id];
    this.setData({ selectedScenes: next });
  },

  /** 「下一步」和「跳过」走同一条路 —— 这一屏本来就可跳过（§5.3 S1） */
  goStep2() {
    this.setData({ step: 2 });
  },

  skipScenes() {
    this.setData({ selectedScenes: [], step: 2 });
  },

  // ---------------- S2 30 词勾选 ----------------

  toggleWord(e: WechatMiniprogram.BaseEvent<Record<string, never>, { index: number }>) {
    const i = Number(e.currentTarget.dataset.index);
    const cell = this.data.words[i];
    if (!cell) return;
    const checked = !cell.checked;
    this.setData({
      [`words[${i}].checked`]: checked,
      checkedCount: this.data.checkedCount + (checked ? 1 : -1),
    });
    if (checked) {
      tracker.track(EV.ONBOARDING_WORD_CHECKED, { spelling: cell.spelling, band: cell.band });
    }
  },

  backToStep1() {
    this.setData({ step: 1 });
  },

  // ---------------- S3 结果 + 播种 ----------------

  finishSelection() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const checked = this.pool.filter((_, i) => this.data.words[i]?.checked);
      const result = onboarding.finish(this.data.selectedScenes, checked);
      tracker.track(EV.ONBOARDING_DONE, {
        scenes: result.scenes,
        checked: checked.length,
        level_line: result.levelLine,
        seeded: result.seeded.length,
        is_high_level: result.isHighLevel,
      });
      this.setData({
        step: 3,
        seededCount: result.seeded.length,
        isHighLevel: result.isHighLevel,
        sceneLabels: SCENES.filter((s) => result.scenes.indexOf(s.id) >= 0)
          .map((s) => s.label)
          .join(' · '),
      });
      // 落库**不等**：S3 要立刻出结果，40 秒预算里没有一次往返的位置。
      // 失败也不提示——首启在本地已经生效，today 的 onShow 会补。
      void onboarding.sync();
    } catch (e) {
      console.error('[onboarding] 播种失败', e);
      wx.showToast({ title: '出了点问题，再试一次', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  startLearning() {
    void tracker.flush();
    wx.switchTab({ url: '/pages/today/today' });
  },

  /**
   * 零勾选分支的出口（§5.3 S3）。`[09-03]` 阅读器已经实现，直接把人送过去。
   * 先 switchTab 落到「今日」再 navigateTo：不这么做的话用户从阅读器返回时
   * 会退回首启页，而首启已经做完了。
   */
  goReader() {
    void tracker.flush();
    wx.switchTab({
      url: '/pages/today/today',
      success: () => wx.navigateTo({ url: '/pages/reader/reader' }),
    });
  },
});
