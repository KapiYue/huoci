// 埋点事件名常量。《执行方案》§7。落库到 `hc_events`（§4.5）。
//
// 攒批 + 在一轮学习结束时随 hc_ RPC 一次性 flush，**不单独发请求**。

export const EV = {
  APP_OPEN: 'app_open',
  ONBOARDING_START: 'onboarding_start',
  ONBOARDING_WORD_CHECKED: 'onboarding_word_checked',
  ONBOARDING_DONE: 'onboarding_done',
  STUDY_SESSION_START: 'study_session_start',
  REVIEW_SUBMIT: 'review_submit',
  STUDY_SESSION_END: 'study_session_end',
  WORD_ACTIVATED: 'word_activated',
  READER_OPEN: 'reader_open',
  READER_WORD_SAVED: 'reader_word_saved',
  SEARCH_SUBMIT: 'search_submit',
  SEARCH_WORD_ADDED: 'search_word_added',
  LOGIN_SUCCESS: 'login_success',
  BIND_CIJING: 'bind_cijing',
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

export type Platform = 'mp' | 'ext' | 'ios' | 'android';

export interface HcEvent {
  name: EventName;
  props?: Record<string, unknown>;
  /** 客户端时间戳，ISO8601。服务端另记 server_ts。 */
  clientTs: string;
  sessionId: string;
}
