// 埋点事件名常量。`design.md` §15。落库到 `hc_events`（§9.5）。
//
// 攒批 + 在一轮学习结束时随 hc_ RPC 一次性 flush，**不单独发请求**。
//
// ⚠️ **名字逐字对齐 §15 的事件表**。这里改一个字，历史数据就断成两截 ——
// `hc_events.name` 是纯文本，没有外键替你拦住拼错。
// P3 的三个 reading_* 先占位（阅读器是 P3），P2 不产生。

export const EV = {
  // —— §15 事件表 ——
  APP_OPEN: 'app_open',
  ONBOARDING_START: 'onboarding_start',
  ONBOARDING_WORD_CHECKED: 'onboarding_word_checked',
  ONBOARDING_DONE: 'onboarding_done',
  STUDY_SESSION_START: 'study_session_start',
  REVIEW_SUBMIT: 'review_submit',
  STUDY_SESSION_END: 'study_session_end',
  WORD_ACTIVATED: 'word_activated',
  /** 加入生词成功。props.source ∈ 'reading' | 'ext' | 'lookup' */
  CAPTURE_CREATED: 'capture_created',
  /** P3 阅读器，P2 不产生 */
  READING_STARTED: 'reading_started',
  READING_WORD_TAPPED: 'reading_word_tapped',
  READING_FINISHED: 'reading_finished',
  LOOKUP_QUERY: 'lookup_query',
  WRITE_QUEUE_FLUSH: 'write_queue_flush',

  // —— §15 表外的补充。登录漏斗 §15 没列，但没有它就算不出「进来的人有多少登录成功」——
  LOGIN_SUCCESS: 'login_success',
  BIND_CIJING: 'bind_cijing',

  // —— `[09-03]` 原型扩到完整产品后新增的四组屏。§15 的事件表还没收录它们，
  //    先在这里定名，**名字定了就不许再改**（hc_events.name 是纯文本，改一个字历史断两截）。
  /** 会员售卖页 M2 曝光 */
  SALES_VIEW: 'sales_view',
  /** 充值到账。props.demo=true 表示演示单（支付通道未开通），分析时必须排除 */
  CREDITS_PURCHASED: 'credits_purchased',
  /** 激励视频看完到账 */
  AD_REWARDED: 'ad_rewarded',
  /** 词包：加入 / 移除 / 收下分享 */
  WORDPACK_ADDED: 'wordpack_added',
  WORDPACK_REMOVED: 'wordpack_removed',
  WORDPACK_SHARED: 'wordpack_shared',
  /** 排行榜与好友 PK */
  LEADERBOARD_VIEW: 'leaderboard_view',
  PK_STARTED: 'pk_started',
  PK_FINISHED: 'pk_finished',
  /** AI 场景练习 A1–A3 */
  AI_SCENE_STARTED: 'ai_scene_started',
  AI_SCENE_TURN: 'ai_scene_turn',
  AI_SCENE_FINISHED: 'ai_scene_finished',
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

/** capture 的来源口径（§15 `capture_created.source`）。P2 只会出现 'lookup'。 */
export type CaptureSource = 'reading' | 'ext' | 'lookup';

export type Platform = 'mp' | 'ext' | 'ios' | 'android';

export interface HcEvent {
  name: EventName;
  props?: Record<string, unknown>;
  /** 客户端时间戳，ISO8601。服务端另记 server_ts。 */
  clientTs: string;
  sessionId: string;
}

/**
 * §15 的口径统一：「一轮学习完成」= **队列走完** 或 **本轮 ≥ 10 张卡**，取先到者。
 * 写成函数是为了三端只有一处实现 —— 这个口径打架的话，首次学习完成率就是废数据。
 */
export const SESSION_COMPLETE_MIN_CARDS = 10;

export function isSessionCompleted(reviewed: number, queueExhausted: boolean): boolean {
  return queueExhausted || reviewed >= SESSION_COMPLETE_MIN_CARDS;
}
