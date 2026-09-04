// 词状态机。`docs/design.md` §8（2026-09-01 改写：输入源 FSRS → 词鲸 SM-2）。
//
// Captured → Learning → Remembered → Activated → Mastered
//
// 全部是词鲸 `words` 行的**派生值**，不新增字段、不新增表，任何一端都能本地算。
// 「活词」= activated，**不涉及口语**（对原定义的修正，见 `design.md` §8 与 §9.4）。

/** 可调产品常量，不是科学结论。⚠️ 只能升不能降——降会让已激活的词回退。 */
export const ACTIVATION_INTERVAL_DAYS = 21;
export const MASTERY_INTERVAL_DAYS = 60;
/** SM-2 第二次成功的间隔。词鲸 lapse 时 interval 重置为 1，故 1 < 6 自动退回 learning。 */
export const LEARNING_INTERVAL_DAYS = 6;
export const MASTERY_SPEAKING_SCORE = 80;

export type WordStatus =
  | 'captured'
  | 'learning'
  | 'remembered'
  | 'activated'
  | 'mastered';

/** 词鲸 `words` 行的子集 + 活词私有的 `hc_word_status.activated_at` */
export interface WordState {
  /** words.repetitions，default 0 */
  repetitions: number;
  /** words.interval，单位天，default 0 */
  interval: number;
  /** hc_word_status.activated_at，一次写入永不改写 */
  activatedAt: string | null;
}

/** P6 才有。P6 之前调用方一律不传。 */
export interface SpeakingState {
  bestScore: number;
}

export function wordStatus(w: WordState, speaking?: SpeakingState): WordStatus {
  if (w.repetitions === 0) return 'captured'; // 从未学过

  // 已激活即永不回退（§3.3）：SM-2 的 interval 在 lapse 时会被打回 1，
  // 若每次实时用 interval >= 21 判断，用户遗忘一次就会看到「已激活 83 个」变 82。
  if (w.activatedAt !== null) {
    if (
      w.interval >= MASTERY_INTERVAL_DAYS &&
      (speaking?.bestScore ?? 0) >= MASTERY_SPEAKING_SCORE
    ) {
      return 'mastered';
    }
    return 'activated';
  }

  if (w.interval >= ACTIVATION_INTERVAL_DAYS) return 'activated';
  if (w.interval < LEARNING_INTERVAL_DAYS) return 'learning';
  return 'remembered';
}

/** 是否算「活词」（首页计数、我的生词「已激活」筛选都用它） */
export function isActivated(w: WordState, speaking?: SpeakingState): boolean {
  const s = wordStatus(w, speaking);
  return s === 'activated' || s === 'mastered';
}

/**
 * 首次进入 activated 的时刻要落 `hc_word_status.activated_at`（北极星
 * Weekly Activated Words 的唯一数据源）。调用方在收到 apply_review 的返回后调用本函数，
 * 返回 true 才去写 activated_at —— **一次写入，此后永不改写**。
 */
export function shouldStampActivation(after: WordState): boolean {
  if (after.activatedAt !== null) return false;
  return after.repetitions > 0 && after.interval >= ACTIVATION_INTERVAL_DAYS;
}
