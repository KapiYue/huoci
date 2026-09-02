// 三端共享的领域类型。**字段名逐字对齐词鲸 Postgres schema**，不要自己起别名。
//
// ⚠️ 两处文档与实际 schema 不一致，以本文件（= 实际 schema）为准：
//   1. 《执行方案》§3.1/§4.0 写的是 `words.interval`，实际列名是 **`interval_days`**
//   2. §4.2 说「不在 words 上存 first_source」，实际 `words` 已有
//      `first_context` / `first_source_url` / `first_source_title`，来源展示直接读它们，
//      不必每次去 word_contexts 做 MIN 查询。word_contexts 仍是「全部上下文」的来源。

/** 词鲸 word_learning_status 枚举。⚠️ 它的 'mastered' 与活词五态的 mastered **不是**一回事。 */
export type CijingWordStatus =
  | 'new'
  | 'learning'
  | 'review'
  | 'weak'
  | 'mastered'
  | 'ignored';

/** public.words 行。apply_review / get_learning_targets 都返回它。 */
export interface CijingWord {
  id: string;
  user_id: string;
  term: string;
  normalized_term: string;
  lemma: string;
  phonetic: string | null;
  audio_url: string | null;
  parts: string[];
  primary_meaning: string;
  contextual_meaning: string | null;
  english_definition: string | null;
  example_en: string | null;
  example_zh: string | null;
  first_context: string | null;
  first_source_url: string | null;
  first_source_title: string | null;
  notes: string;
  custom_meaning: string | null;
  status: CijingWordStatus;
  strength: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  lookup_count: number;
  error_count: number;
  due_at: string;
  last_reviewed_at: string | null;
  mastered_at: string | null;
  created_at: string;
  updated_at: string;
}

/** public.word_contexts 行 */
export interface WordContext {
  id: string;
  user_id: string;
  word_id: string;
  context_text: string;
  contextual_meaning: string | null;
  sentence: string | null;
  source_url: string | null;
  source_title: string | null;
  created_at: string;
}

/** get_daily_plan() 的返回。字段名逐字对齐 jsonb_build_object。 */
export interface DailyPlan {
  review_due: number;
  new_suggested: number;
  weak_count: number;
  learned_count: number;
  mastered_count: number;
  streak_days: number;
  reviewed_today: number;
  practice_today: number;
  reading_today: number;
  generation_today: number;
  reading_total: number;
  completed_today: boolean;
  daily_new_goal: number;
  daily_review_goal: number;
}

/** hc_profiles 行（活词私有，《执行方案》§4.1） */
export interface HcProfile {
  user_id: string;
  level_line: number | null;
  daily_goal: number;
  active_pack_ids: string[];
  onboarding_done_at: string | null;
  updated_at: string;
}

/** hc_word_status 行（活词私有，§4.1b）。activated_at 一次写入永不改写。 */
export interface HcWordStatus {
  user_id: string;
  word_id: string;
  activated_at: string;
}

/** 学习卡片消费的视图：词鲸事实 + 活词解释，拼好再交给 UI。 */
export interface StudyCard {
  wordId: string;
  term: string;
  phonetic: string;
  pos: string;
  meaning: string;
  /** 原句。仅 capture 词有；底座词为 null，**不编造例句**（§6.2） */
  contextSentence: string | null;
  /** 来源展示文案，如「GitHub · 2 小时前」。底座词显示「首启添加」 */
  contextSource: string;
  exampleEn: string | null;
  exampleZh: string | null;
  audioUrl: string | null;
  // —— 状态机输入 ——
  repetitions: number;
  interval: number;
  activatedAt: string | null;
}
