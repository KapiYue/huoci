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
  iconOn: string;
  selected: boolean;
}

/** React OnboardingFlow 的六张场景卡。 */
const SCENES: SceneOption[] = [
  { id: 'tech_doc', label: '技术文档 / API', desc: 'Stripe, AWS, MDN 等', icon: '/assets/ui/scene-code.svg', iconOn: '/assets/ui/scene-code-on.svg', selected: false },
  { id: 'saas', label: '产品 SaaS / 工具', desc: 'Linear, Figma, Notion 等', icon: '/assets/ui/scene-layers.svg', iconOn: '/assets/ui/scene-layers-on.svg', selected: false },
  { id: 'github', label: 'GitHub 源码 / PR', desc: 'Issue 讨论、代码 Review', icon: '/assets/ui/scene-book.svg', iconOn: '/assets/ui/scene-book-on.svg', selected: false },
  { id: 'email', label: '工作邮件 / Slack', desc: '日常沟通、跨国会议', icon: '/assets/ui/scene-mail.svg', iconOn: '/assets/ui/scene-mail-on.svg', selected: false },
  { id: 'paper', label: '学术论文 / 博客', desc: 'arXiv, Medium, Substack', icon: '/assets/ui/scene-cap.svg', iconOn: '/assets/ui/scene-cap-on.svg', selected: false },
  { id: 'other', label: '行业热点 / 资讯', desc: 'TechCrunch, HN, X', icon: '/assets/ui/scene-globe.svg', iconOn: '/assets/ui/scene-globe-on.svg', selected: false },
];

interface WordCell {
  spelling: string;
  band: number;
  hint: string;
  checked: boolean;
}

/** 与 prototype 的 ONBOARDING_TEST_WORDS 一一对应。 */
const PROTOTYPE_WORDS: Array<Omit<WordCell, 'checked'>> = [
  { spelling: 'feature', band: 1, hint: '功能，特性' },
  { spelling: 'process', band: 1, hint: '处理，流程' },
  { spelling: 'request', band: 1, hint: '请求，要求' },
  { spelling: 'standard', band: 1, hint: '标准，规范' },
  { spelling: 'response', band: 1, hint: '响应，回答' },
  { spelling: 'implement', band: 2, hint: '实施，实现' },
  { spelling: 'deploy', band: 2, hint: '部署，配置' },
  { spelling: 'maintain', band: 2, hint: '维护，保持' },
  { spelling: 'convert', band: 2, hint: '转换，转变' },
  { spelling: 'execute', band: 2, hint: '执行，实行' },
  { spelling: 'latency', band: 3, hint: '延迟' },
  { spelling: 'resilient', band: 3, hint: '有弹性的，容灾的' },
  { spelling: 'retention', band: 3, hint: '留存，保留' },
  { spelling: 'asynchronous', band: 3, hint: '异步的' },
  { spelling: 'bottleneck', band: 3, hint: '瓶颈' },
  { spelling: 'mitigate', band: 4, hint: '减轻，缓解' },
  { spelling: 'concurrency', band: 4, hint: '并发' },
  { spelling: 'granular', band: 4, hint: '细粒度的' },
  { spelling: 'reconcile', band: 4, hint: '协调，对账' },
  { spelling: 'orchestrate', band: 4, hint: '编排，协调' },
  { spelling: 'idempotent', band: 5, hint: '幂等的' },
  { spelling: 'telemetry', band: 5, hint: '遥测，指标' },
  { spelling: 'scaffold', band: 5, hint: '脚手架' },
  { spelling: 'deprecate', band: 5, hint: '废弃，弃用' },
  { spelling: 'throughput', band: 5, hint: '吞吐量' },
  { spelling: 'heuristics', band: 6, hint: '启发式，经验法则' },
  { spelling: 'amortize', band: 6, hint: '摊销，分摊' },
  { spelling: 'ephemeral', band: 6, hint: '短暂的，瞬时的' },
  { spelling: 'canonical', band: 6, hint: '规范的，正统的' },
  { spelling: 'ubiquitous', band: 6, hint: '普遍存在的，无处不在的' },
];

const DEFAULT_CHECKED = new Set(['implement', 'latency', 'mitigate', 'idempotent']);

Page({
  data: {
    themeClass: '',
    step: 1 as 1 | 2 | 3,
    scenes: SCENES,
    selectedScenes: [] as string[],

    words: [] as WordCell[],
    checkedCount: 0,

    previewTabs: [
      { text: '今日', icon: '/assets/ui/tab-today.svg' },
      { text: '我的生词', icon: '/assets/ui/tab-words.svg' },
      { text: '词包', icon: '/assets/ui/tab-pack.svg' },
      { text: '查词', icon: '/assets/ui/tab-search.svg' },
      { text: '我的', icon: '/assets/ui/tab-profile-on.svg', active: true },
    ],

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
      const poolBySpelling = new Map(onboarding.loadBasePool().map((word) => [word.spelling, word]));
      this.pool = PROTOTYPE_WORDS.map((word) => poolBySpelling.get(word.spelling))
        .filter((word): word is BaseWord => Boolean(word));
    } catch (e) {
      console.error('[onboarding] 词表读取失败', e);
      this.pool = [];
    }
    this.setData({
      words: PROTOTYPE_WORDS.map((word) => ({ ...word, checked: DEFAULT_CHECKED.has(word.spelling) })),
      checkedCount: DEFAULT_CHECKED.size,
    });
  },

  // ---------------- S1 场景勾选 ----------------

  toggleScene(e: WechatMiniprogram.BaseEvent<Record<string, never>, { id: string }>) {
    const { id } = e.currentTarget.dataset;
    const next = this.data.selectedScenes.includes(id)
      ? this.data.selectedScenes.filter((s) => s !== id)
      : [...this.data.selectedScenes, id];
    this.setData({
      selectedScenes: next,
      scenes: this.data.scenes.map((scene) => ({ ...scene, selected: next.includes(scene.id) })),
    });
  },

  /** React 原型要求至少选一个场景，按钮才可进入下一步。 */
  goStep2() {
    if (this.data.selectedScenes.length === 0) return;
    this.setData({ step: 2 });
  },

  skipScenes() {
    this.setData({ selectedScenes: [], step: 2 });
  },

  // ---------------- S2 30 词勾选 ----------------

  toggleWord(e: WechatMiniprogram.BaseEvent<Record<string, never>, { spelling: string }>) {
    const spelling = String(e.currentTarget.dataset.spelling || '');
    const i = this.data.words.findIndex((word) => word.spelling === spelling);
    const cell = this.data.words[i];
    if (!cell) return;
    const checked = !cell.checked;
    // 整列替换比动态路径 setData 在 scroll-view + wx:for 中稳定，真机不会出现
    // dataset 已触发但局部节点没有刷新的假死反馈。
    const words = this.data.words.map((word, index) => index === i ? { ...word, checked } : word);
    this.setData({
      words,
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
      const checkedSpellings = new Set(this.data.words.filter((word) => word.checked).map((word) => word.spelling));
      const checked = this.pool.filter((word) => checkedSpellings.has(word.spelling));
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
