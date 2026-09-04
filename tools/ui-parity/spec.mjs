// 九屏还原判据 —— `docs/design.md` §5 的机器可读转写。
//
// **权威关系（这份工具的全部意义）**
//   功能 / 结构 / 文案  → `design.md` §5 说了算。原型与它冲突，改原型不改实现。
//   视觉 / 效果 / 布局  → `docs/prototype/` 说了算。实现与它不一致，改实现。
// 所以每一屏都是三方比对：规格 ↔ 原型 ↔ 小程序，三条边各自出结论。
//
// 改这份文件的唯一理由是 `design.md` §5 改了。不要为了「让报告变绿」来改判据。

export const PROTO = 'docs/prototype/src/components/';
export const IMPL = 'packages/miniprogram/miniprogram/';

/** §5.0 ② + §5.5 + `dev-todo.md` §4 红线速查。**原型与实现同样受约束**。 */
export const RED_LINES = [
  { word: '加油', why: '§5.0 ②：语气是工具不是课堂' },
  { word: '棒棒哒', why: '§5.0 ②' },
  { word: '打卡成功', why: '§5.0 ②' },
  { word: '英语水平测试', why: '§5.0 ② / §5.3 S2 文案固定' },
  { word: '星级', why: '§5.0 ② / §5.5：不画星级或等级' },
  { word: '段位', why: '§5.0 ②' },
  { word: '排行榜', why: '§5.5' },
  { word: '连击', why: '§5.5：不画连击/火苗动画' },
  { word: '数据同步', why: '§5.4 S8：没有「数据同步」入口（伪命题）' },
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
    // ⚠️ 原型里 S0 有**两个**版本：`WeChatLoginScreen.tsx`（App.tsx 实际用的那个，
    // 带游客模式 / 价值卡 / 分段切换）和 `OnboardingFlow.tsx` 的第 0 步
    // （「选择进入方式」，形状反而更贴 §5.3 S0）。这里取前者 —— 它是原型跑起来时
    // 真正会看到的那一屏，也正因如此它的越界必须被报出来。**哪个是视觉基准待定。**
    proto: ['WeChatLoginScreen.tsx'],
    must: [
      ['活词', '品牌头'],
      ['词以致用', '§5.1 Slogan，一字不改'],
      ['微信一键登录', '新用户默认路径，一次点击'],
      ['我有词鲸账号', '次要样式的并列入口'],
      ['隐私政策', '底部两个协议链接之一'],
      ['用户协议', '底部两个协议链接之一'],
      ['词鲸注册邮箱', '老账号走邮箱+密码'],
      ['密码', '同上'],
    ],
    mustNot: [
      ['游客', 'S0 只有两个并列入口，09-02 已削回：没有游客模式'],
      ['免登录', '同上'],
      ['快速体验', '同上'],
      ['注册', '不提供邮箱注册入口（「不提供邮箱注册」这句说明除外，见白名单）'],
      ['4级', '自评是三档，不是四档（§5.6 附录 B）'],
      ['4 级', '同上'],
    ],
    // 「小程序不提供邮箱注册」这类否定句里的「注册」不算违规
    allowIn: { 注册: ['不提供邮箱注册', '词鲸注册邮箱'] },
    shape: [
      {
        why: '两个并列入口，不是分叉流程 —— 不许出现分段/tab 切换器',
        test: (src) => !/(segmented|tab-switch|seg-btn|login-tabs)/i.test(src),
      },
      {
        why: '不画价值卡（§5.3 S0 只有品牌头 + 两个入口 + 两个协议链接）',
        test: (src) => !/value-card|feature-card|highlight-card/i.test(src),
      },
    ],
  },

  {
    id: 'S1',
    name: '场景勾选',
    ref: '§5.3 S1',
    impl: ['pages/onboarding/onboarding.wxml', 'pages/onboarding/onboarding.ts'],
    proto: ['OnboardingFlow.tsx'],
    must: [
      ['你平时在哪读英文？', '§5.3 S1 的屏内文案'],
      ['技术文档', '七个场景之一'],
      ['产品 SaaS', '七个场景之一'],
      ['GitHub', '七个场景之一'],
      ['论文', '七个场景之一'],
      ['行业文章', '七个场景之一'],
      ['其他', '七个场景之一'],
      ['下一步', '主按钮'],
    ],
    mustNot: [
      ['测评', '「不要写成测评第 1 步」'],
      ['第 1 步', '同上：不要有考试式步骤计数'],
      ['水平', '同上'],
    ],
    shape: [
      {
        why: '可跳过 —— 必须有跳过入口',
        test: (src) => /跳过/.test(src),
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
      ['已选', '按钮上带已选数'],
    ],
    mustNot: [
      ['释义', '只有拼写，显示释义就变成阅读理解题'],
      ['英语水平测试', '§5.3 S2 明写'],
      ['测评', '同上'],
      ['水平', '同上'],
    ],
    shape: [
      {
        why: '词格子里只渲染拼写，不渲染 meaning/translation 字段',
        test: (src) => !/item\.(meaning|translation|definition|primaryMeaning)/.test(src),
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
      ['开始学习', '主按钮'],
      ['你的底子够了', '零勾选分支（§5.3 S3 的第三条播种规则）'],
    ],
    mustNot: [
      ['你的水平是', '不显示等级'],
      ['分数', '不显示分数'],
      ['B2', '不显示 CEFR 等级'],
      ['稳定性 ≥ 21', '这是解释不是结果，S3 不做知识科普（原型越界处）'],
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
    mustNot: [
      ['打卡', '§5.0 ②：工具语气'],
    ],
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
      ['显示答案', '正面唯一按钮'],
      ['想不起来', '三档自评，emoji 与文案固定（附录 B）'],
      ['有点模糊', '同上'],
      ['记得', '同上'],
      ['原句', 'capture 词正面必须显示原句'],
      ['已复习词汇', '会话结束页：本轮学了几个'],
      ['新激活活词', '会话结束页：其中几个是我自己遇到的词'],
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
      ['加入我的活词', '§5.4 S7 的主按钮'],
      ['例', '例句（§5.4 S7 的结果区四行之一）'],
    ],
    mustNot: [
      ['加入成功', '加入后按钮变已加入态，不要弹模态框'],
    ],
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
      ['学习统计', '菜单项'],
      ['绑定词鲸账号', '兜底入口（主入口在 S0）'],
      ['关于活词', '菜单项'],
      ['开源许可', '菜单项'],
      ['隐私政策', '菜单项'],
      ['词鲸 App（iOS）已上架 App Store', '纯文字，不可点，一字不改'],
      ['Browne', '许可证义务：NGSL 系列署名，不是可选项'],
      ['CC BY-SA 4.0', '许可证义务'],
      ['将被丢弃', '绑定确认弹窗：「小程序上的 N 个词将被丢弃」+ 二次确认'],
    ],
    mustNot: [
      ['词包', 'P2 砍掉，没有「词包」入口'],
      ['数据同步', '伪命题：小程序与 iOS 读写同一份数据'],
    ],
    shape: [
      {
        why: '「词鲸 App…」那行不放链接、不放二维码、不放按钮',
        // 只看承载这行文字的那一个元素本身，不看它后面的兄弟节点
        test: (src) => !(src.match(/<[^>]*>[^<>]*App Store[^<>]*</) || [''])[0].match(/navigator|bindtap|url=/),
      },
    ],
  },
];

/** tabbar 四项，文案与顺序都由 §5.2 固定。 */
export const TABBAR = ['今日', '我的生词', '查词', '我的'];
