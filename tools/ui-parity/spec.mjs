// H1 源码级辅助检查。UI 唯一标准是 `docs/prototype/`；design.md 只补充四类硬约束。
//
// **权威关系（这份工具的全部意义）**
//   结构 / 视觉 / 文案 / 状态 / 交互 → `docs/prototype/` 说了算。
//   账号绑定安全、开源署名、AI 额度不卖、数据安全 → design.md 补充。
//
// 只在 React 原型或四项硬约束变化时改判据。不要为了「让报告变绿」降低判据。

export const PROTO = 'docs/prototype/src/components/';
export const IMPL = 'packages/miniprogram/miniprogram/';

/** 四项硬约束中的合规底线；这里只扫描实现，不反向审判 React 原型。 */
export const RED_LINES = [
  { word: '二维码', why: '§5.0 ③：不画任何 App 下载引导' },
  { word: '立即下载', why: '§5.0 ③' },
  { word: '下载体验', why: '§5.0 ③' },
];

/**
 * 每屏一条。
 *   impl      小程序侧源文件（wxml/ts/wxss 都可以，文案抽取器按后缀分派）
 *   proto     原型侧源文件
 *   must      必须出现的文案（`design.md` §5 的原话或其等价物）
 *   mustNot   本屏额外禁止的文案（红线之外的）
 *   shape     对 wxml 源码的结构判据：{ why, test(src) => true 表示通过 }
 */
export const SCREENS = [
  {
    id: 'S0',
    name: '身份（登录）',
    ref: '§5.3 S0',
    impl: ['pages/login/login.wxml', 'pages/login/login.ts'],
    // App.tsx 未登录时实际渲染 LoginTab；它是登录页唯一基准。
    proto: ['LoginTab.tsx'],
    must: [
      ['活词', '品牌头'],
      ['ActiveWords', 'React 品牌名'],
      ['微信一键快捷登录', 'React 微信登录主操作'],
      ['词鲸账号', 'React 分段入口'],
      ['个人信息保护政策', 'React 协议链接'],
      ['用户服务协议', 'React 协议链接'],
      ['词鲸注册邮箱', '老账号走邮箱+密码'],
      ['密码', '同上'],
      ['选择小程序展示头像', 'React 微信授权层'],
      ['微信学习昵称', 'React 微信授权层'],
      ['允许登录', 'React 微信授权层'],
    ],
    mustNot: [],
    // 「小程序不提供邮箱注册」这类否定句里的「注册」不算违规
    allowIn: { 注册: ['不提供邮箱注册', '词鲸注册邮箱'] },
    shape: [],
  },

  {
    id: 'S1',
    name: '场景勾选',
    ref: '§5.3 S1',
    impl: ['pages/onboarding/onboarding.wxml', 'pages/onboarding/onboarding.ts'],
    proto: ['OnboardingFlow.tsx'],
    must: [
      ['第 1 步 / 共 3 步', 'React 原型步骤提示'],
      ['你平时在哪里遇到英文最多？', 'React 原型标题'],
      ['技术文档 / API', 'React 六个场景之一'],
      ['产品 SaaS / 工具', 'React 六个场景之一'],
      ['GitHub 源码 / PR', 'React 六个场景之一'],
      ['工作邮件 / Slack', 'React 六个场景之一'],
      ['学术论文 / 博客', 'React 六个场景之一'],
      ['行业热点 / 资讯', 'React 六个场景之一'],
      ['下一步：40 秒生词初探', 'React 原型主按钮'],
    ],
    mustNot: [],
    shape: [
      {
        why: 'React 原型为六张场景卡，并且没有跳过入口',
        test: (src) => !/先跳过/.test(src),
      },
    ],
  },

  {
    id: 'S2',
    name: '30 词勾选',
    ref: '§5.3 S2',
    impl: ['pages/onboarding/onboarding.wxml', 'pages/onboarding/onboarding.ts'],
    proto: ['OnboardingFlow.tsx'],
    must: [
      ['哪些词你说不出口？', '§5.3 S2 文案固定，不得改写'],
      ['第 2 步 / 共 3 步', 'React 原型步骤提示'],
      ['已选', 'React 顶部实时选中数'],
      ['生成我的今日活词计划', 'React 原型主按钮'],
    ],
    mustNot: [
      ['英语水平测试', '§5.3 S2 明写'],
      ['测评', '同上'],
      ['水平', '同上'],
    ],
    shape: [
      {
        why: 'React 原型是两列卡片并带独立勾选反馈',
        test: (src) => /word-check/.test(src) && /word-grid/.test(src),
      },
    ],
  },

  {
    id: 'S3',
    name: '结果 + 播种',
    ref: '§5.3 S3',
    impl: ['pages/onboarding/onboarding.wxml', 'pages/onboarding/onboarding.ts'],
    proto: ['OnboardingFlow.tsx'],
    must: [
      ['今天先帮你激活', '§5.3 S3 的屏内文案'],
      ['立即进入「今日」开始', 'React 原型主按钮'],
      ['你的底子够了', '零勾选分支（§5.3 S3 的第三条播种规则）'],
    ],
    mustNot: [
      ['你的水平是', '不显示等级'],
      ['分数', '不显示分数'],
      ['B2', '不显示 CEFR 等级'],
    ],
    shape: [
      {
        why: '不出现任何 0–100 的分数样式字段',
        test: (src) => !/\bscore\b|得分/.test(src),
      },
    ],
  },

  {
    id: 'S4',
    name: '① 今日',
    ref: '§5.4 S4',
    impl: ['pages/today/today.wxml', 'pages/today/today.ts'],
    proto: ['TodayTab.tsx'],
    must: [
      ['个词需要复习', '§5.4 S4 首屏三行之一'],
      ['新词', '同上'],
      ['连续学习', '同上'],
      ['已经激活', '品牌计量单位的兑现处'],
      ['活词', '同上'],
    ],
    mustNot: [],
    shape: [
      {
        why: '全部学完的状态要画（把「开始学习」换成已完成态）',
        test: (src) => /已清空|已完成|全部学完/.test(src),
      },
      {
        why: '「已经激活 N 个活词」P2 就有数，不能是写死的 0 或占位',
        test: (src) => /activated_count/.test(src),
      },
    ],
  },

  {
    id: 'S5',
    name: '② 学习卡片',
    ref: '§5.4 S5',
    impl: ['pages/study/study.wxml', 'pages/study/study.ts', '../../shared/src/rating.ts'],
    proto: ['StudySessionModal.tsx'],
    must: [
      ['翻看背面', 'React 正面主按钮'],
      ['不认得 (1)', 'React 三档自评'],
      ['模糊 (2)', '同上'],
      ['掌握 (3)', '同上'],
      ['原句', 'capture 词正面必须显示原句'],
      ['完成并返回今日', 'React 会话结束页主按钮'],
    ],
    mustNot: [
      ['拼写正确', 'P2 明确不做拼写输入框'],
      ['听力', 'P2 明确不做听力选择题'],
      ['连击', 'P2 明确不做连击动画'],
      ['第 6 天达成', '连续天数的庆祝语属于打卡感（原型越界处）'],
    ],
    shape: [
      {
        why: '三个自评按钮等宽并排',
        test: (src) => /rate|self-rating|rating/i.test(src),
      },
      {
        why: '点自评后立即进下一张，不画 loading 遮罩',
        test: (src) => !/loading-mask|submitting-mask|遮罩/.test(src),
      },
    ],
  },

  {
    id: 'S6',
    name: '③ 我的生词',
    ref: '§5.4 S6',
    impl: ['pages/words/words.wxml', 'pages/words/words.ts', 'services/words.ts'],
    proto: ['WordsTab.tsx'],
    must: [
      ['我的生词', '页标题'],
      ['语境抓取驱动', 'React 页头徽标'],
      ['搜索已收录的英文或中文释义', 'React 搜索占位'],
      ['最近遇到', '三个筛选之一，默认项'],
      ['待复习', '三个筛选之一'],
      ['已激活', '三个筛选之一（§5.6 附录 A 的 activated 判据）'],
      ['首启添加', '底座词的来源行，不留空白'],
    ],
    mustNot: [],
    shape: [
      {
        why: '来源行读 words 的三列，不查 word_contexts 求 MIN（§11 ②）',
        test: (src) => !/word_contexts/.test(src),
      },
      {
        why: '长列表虚拟滚动（§14.3：不要一次 setData 几百条）',
        test: (src) => /recycle-view|virtual|scroll-view/i.test(src),
      },
    ],
  },

  {
    id: 'S7',
    name: '④ 查词',
    ref: '§5.4 S7',
    impl: ['pages/search/search.wxml', 'pages/search/search.ts', 'services/lookup.ts'],
    proto: ['SearchTab.tsx'],
    must: [
      ['查词 · 精准捕捉', 'React 页标题'],
      ['加入我的活词', '§5.4 S7 的主按钮'],
      ['例', '例句（§5.4 S7 的结果区四行之一）'],
      ['已在我的生词库中', 'React 已收录态'],
      ['成功收录！明天将进入今日复习队列', 'React 成功反馈'],
    ],
    mustNot: [],
    shape: [
      {
        // §5.4 S7 的结果区没有「释义」这个字面标签，判据是「渲染了释义与音标」本身
        why: '结果区渲染音标与释义字段',
        test: (src) => /\{\{[^}]*phonetic/.test(src) && /\{\{[^}]*meaning/.test(src),
      },
      {
        why: '输入防抖 300ms',
        test: (src) => /300/.test(src),
      },
      {
        why: '写词必须带 source_title，否则会被 S6 推导成「首启添加」（§11 ②）',
        test: (src) => /source_title|sourceTitle/.test(src),
      },
    ],
  },

  {
    id: 'S8',
    name: '⑤ 我的',
    ref: '§5.4 S8',
    impl: [
      'pages/profile/profile.wxml', 'pages/profile/profile.ts',
      // 开源许可是 S8 的子页；署名是数据驱动的，词包 meta 也算 S8 的一部分
      'pages/license/license.wxml', 'pages/license/license.ts',
      'assets/base-words.json',
    ],
    proto: ['ProfileTab.tsx'],
    must: [
      ['我的学习数据', 'React 统计卡'],
      ['绑定词鲸账号', '兜底入口（主入口在 S0）'],
      ['关于活词', '菜单项'],
      ['开源许可', '菜单项'],
      ['隐私政策与规范', 'React 菜单项'],
      ['词鲸 App（iOS）已上架 App Store', '纯文字，不可点，一字不改'],
      ['Browne', '许可证义务：NGSL 系列署名，不是可选项'],
      ['CC BY-SA 4.0', '许可证义务'],
      ['将被丢弃', '绑定确认弹窗：「小程序上的 N 个词将被丢弃」+ 二次确认'],
    ],
    mustNot: [],
    shape: [
      {
        why: '「词鲸 App…」那行不放链接、不放二维码、不放按钮',
        // 只看承载这行文字的那一个元素本身，不看它后面的兄弟节点
        test: (src) => !(src.match(/<[^>]*>[^<>]*App Store[^<>]*</) || [''])[0].match(/navigator|bindtap|url=/),
      },
    ],
  },
];

/** React 完整产品的五项 tabbar。 */
export const TABBAR = ['今日', '我的生词', '词包', '查词', '我的'];
