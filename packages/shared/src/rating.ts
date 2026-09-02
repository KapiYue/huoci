// 三档自评 → SM-2 quality 的映射。《执行方案》§4.3。
//
// ⚠️ 两个值域千万别混：
//   - `Rating` 是**客户端内部值** 1–4（FSRS 口径，schema 不动，见 §4.3 的红字）
//   - `p_quality` 是**词鲸 apply_review 的入参**，值域 0–5
// 落库前一律用 toQuality() 转换，禁止把 rating 直接当 p_quality 传。

export type Rating = 1 | 2 | 3 | 4;

/** P2–P5 的 UI 只出这三档。4 Easy 由 P6 的口语高分触发，此前不产生。 */
export type UiRating = 1 | 2 | 3;

export type ReviewMode = 'recall' | 'speak' | 'pk' | 'spell';

/** 词鲸 apply_review 的 p_exercise_type。活词全走自评。 */
export const EXERCISE_TYPE_SELF_RATING = 'self_rating';

const QUALITY_BY_RATING: Record<Rating, number> = {
  1: 1, // 😵 想不起来 → lapse：repetitions=0、interval=1、status='weak'、strength−0.18
  2: 3, // 😐 有点模糊 → 通过但困难，间隔乘子 0.75
  3: 4, // 🙂 记得     → 纯按 ease_factor 增长（乘子 1）
  4: 5, // (P6) 口语高分 → 乘子 1.2
};

export function toQuality(rating: Rating): number {
  return QUALITY_BY_RATING[rating];
}

export interface RatingOption {
  rating: UiRating;
  emoji: string;
  label: string;
  /** 卡片上给用户的下次间隔口径，是文案不是算法 */
  hint: string;
}

/** UI 顺序固定：想不起来 / 有点模糊 / 记得。左→右由差到好。 */
export const UI_RATINGS: readonly RatingOption[] = [
  { rating: 1, emoji: '😵', label: '想不起来', hint: '1 天后复习' },
  { rating: 2, emoji: '😐', label: '有点模糊', hint: '减半间隔' },
  { rating: 3, emoji: '🙂', label: '记得', hint: '正常延长' },
] as const;
