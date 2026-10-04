// 学习域。今日概览、队列、提交复习。
//
// §14.4 第 1 条：**禁止裸 REST 写 words**，写一律走 rpc。
// 读缓存（T1-c）：断网时返回旧数据 + 一个离线标记，好过一片空白。

import * as gw from './gateway';
import * as store from './storage';
import * as queue from './reviewQueue';
import { uuid } from '../utils/uuid';
import { relativeTime, hostLabel } from '../utils/format';
import { ApiError } from './types';
import type { CijingWord, StudyCard } from '../shared/types';
import { toQuality, EXERCISE_TYPE_SELF_RATING } from '../shared/rating';
import type { UiRating } from '../shared/rating';
import { wordStatus } from '../shared/wordStatus';
import type { WordStatus } from '../shared/wordStatus';
import basePhonetics from './basePhonetics.generated';

const PLAN_TTL = 5 * 60 * 1000;
/** 产品裁决：每轮固定最多 20 张。daily_goal 和历史积压都不能放大本轮。 */
export const STUDY_ROUND_LIMIT = 20;

/** 只供真机验收积压排版；不改队列、不写库。 */
export function backlogTestSummary(summary: HomeSummary, enabled: boolean): HomeSummary {
  if (!enabled) return summary;
  return { ...summary, due_count: 35, new_count: 8, new_available: Math.max(summary.new_available, 8) };
}

export interface HomeSummary {
  due_count: number;
  new_count: number;
  new_available: number;
  total_words: number;
  daily_goal: number;
  streak_days: number;
  reviewed_today: number;
  activated_count: number;
  activated_this_week: number;
}

export const EMPTY_SUMMARY: HomeSummary = {
  due_count: 0,
  new_count: 0,
  new_available: 0,
  total_words: 0,
  daily_goal: 20,
  streak_days: 0,
  reviewed_today: 0,
  activated_count: 0,
  activated_this_week: 0,
};

export interface StudyRoundInfo {
  roundCount: number;
  backlogTotal: number;
  hasBacklog: boolean;
}

/**
 * 首页必须用实际取回的队列长度描述“本轮”，概览只描述积压。
 * 两者分开，避免 due_count + new_count 大于 20 时按钮误称本轮会学完全部积压。
 */
export function studyRoundInfo(summary: Pick<HomeSummary, 'due_count' | 'new_count'>, queueLength: number): StudyRoundInfo {
  const backlogTotal = Math.max(0, summary.due_count) + Math.max(0, summary.new_count);
  const roundCount = Math.min(STUDY_ROUND_LIMIT, Math.max(0, Math.trunc(queueLength)));
  return { roundCount, backlogTotal, hasBacklog: backlogTotal > roundCount };
}

/** hc_get_study_queue 与 hc_list_words 返回同一个形状 —— 两边共用 toCard() */
export type QueueRow = CijingWord & { activated_at: string | null; is_capture: boolean };

export interface Loaded<T> {
  data: T;
  /** 数据来自本地缓存（当前离线或请求失败） */
  stale: boolean;
}

export async function fetchHomeSummary(): Promise<Loaded<HomeSummary>> {
  const cached = store.readCache<HomeSummary>(store.SK.PLAN_CACHE, PLAN_TTL);
  if (cached) return { data: cached, stale: false };
  try {
    const data = await gw.rpc<HomeSummary>('hc_home_summary');
    store.writeCache(store.SK.PLAN_CACHE, data);
    return { data, stale: false };
  } catch (e) {
    const fallback = store.readCacheStale<HomeSummary>(store.SK.PLAN_CACHE);
    if (fallback) return { data: fallback, stale: true };
    if ((e as ApiError).kind === 'network') return { data: EMPTY_SUMMARY, stale: true };
    throw e;
  }
}

/** 来源展示文案。§5.4 S6：来源比释义更需要被看见；底座词显示「首启添加」，不留空白。 */
function sourceLabel(w: CijingWord): string {
  const title = w.first_source_title || hostLabel(w.first_source_url);
  const when = relativeTime(w.created_at);
  if (!title) return '首启添加';
  return when ? `${title} · ${when}` : title;
}

/** 数据库里同时存在 `fəʊ`、`/fəʊ/` 两种历史写法，展示层统一成原型的 /…/。 */
function displayPhonetic(value: string | null, term: string): string {
  const raw = (value || basePhonetics[term.toLowerCase()] || '—').trim();
  let inner = raw.replace(/^\/+|\/+$/g, '').trim();
  // 早期 ECDICT 音标使用 `ә / є / ' / : / ei / әu` 这套旧式 ASCII/DJ 写法；
  // 与新收录词的 Unicode IPA 混排会出现截图里的 bowl、landscape 格式不一致。
  if (/[әє':]/.test(inner)) {
    inner = inner
      .replace(/\.\s+/g, '; ')
      .replace(/єә/g, 'eə')
      .replace(/әu/g, 'əʊ')
      .replace(/ɒi/g, 'ɔɪ')
      .replace(/ei/g, 'eɪ')
      .replace(/ai/g, 'aɪ')
      .replace(/au/g, 'aʊ')
      .replace(/iә/g, 'ɪə')
      .replace(/uә/g, 'ʊə')
      .replace(/i:/g, 'iː')
      .replace(/u:/g, 'uː')
      .replace(/ɑ:/g, 'ɑː')
      .replace(/ɒ:/g, 'ɔː')
      .replace(/ә:/g, 'ɜː')
      .replace(/ә/g, 'ə')
      .replace(/є/g, 'e')
      .replace(/'/g, 'ˈ')
      .replace(/\./g, 'ˌ')
      .replace(/i(?!ː)/g, 'ɪ')
      .replace(/u(?!ː)/g, 'ʊ')
      .replace(/ɪ(?=\s|;|$)/g, 'i');
  }
  return `/${inner || '—'}/`;
}

/**
 * 历史数据的 audio_url 大多为空。先使用库内音频；空值时用词典的美音朗读地址，
 * 让原型中始终存在的喇叭在小程序里也真正可点、可播放。
 */
function pronunciationUrl(value: string | null, term: string): string {
  return value || `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(term)}&type=2`;
}

export function toCard(row: QueueRow): StudyCard {
  return {
    wordId: row.id,
    term: row.term,
    phonetic: displayPhonetic(row.phonetic, row.term),
    pos: Array.isArray(row.parts) && row.parts.length > 0 ? String(row.parts[0]) : '',
    meaning: row.custom_meaning || row.primary_meaning,
    // 底座词没有原句，正面只有拼写 + 音标，**不编造例句**（§5.4 S5）
    contextSentence: row.first_context,
    contextSource: sourceLabel(row),
    exampleEn: row.example_en,
    exampleZh: row.example_zh,
    audioUrl: pronunciationUrl(row.audio_url, row.term),
    repetitions: row.repetitions,
    interval: row.interval_days,
    activatedAt: row.activated_at,
  };
}

export async function fetchStudyQueue(limit = STUDY_ROUND_LIMIT): Promise<Loaded<StudyCard[]>> {
  const roundLimit = Math.min(STUDY_ROUND_LIMIT, Math.max(0, Math.trunc(limit)));
  try {
    const rows = await gw.rpc<QueueRow[]>('hc_get_study_queue', { p_limit: roundLimit });
    const cards = (rows || []).slice(0, roundLimit).map(toCard);
    store.writeCache(store.SK.CARDS_CACHE, cards);
    return { data: cards, stale: false };
  } catch (e) {
    const fallback = store.readCacheStale<StudyCard[]>(store.SK.CARDS_CACHE);
    if (fallback && fallback.length > 0) return { data: fallback, stale: true };
    if ((e as ApiError).kind === 'network') return { data: [], stale: true };
    throw e;
  }
}

export interface SubmitResult {
  /** 本地乐观推算出的新状态。服务端是权威，补发成功后会被覆盖 */
  status: WordStatus;
  /** 本次是否首次跨过激活线（乐观判断，用于当场放小彩带） */
  newlyActivated: boolean;
}

/**
 * 提交一次自评。**先入队 → UI 立即响应 → 后台补发**（§5.4 S5 结尾 + T1-c）。
 * 返回的是本地乐观值，不等网络。
 */
export function submitReview(card: StudyCard, rating: UiRating, durationMs: number): SubmitResult {
  queue.enqueue({
    clientEventId: uuid(),
    wordId: card.wordId,
    quality: toQuality(rating),
    exerciseType: EXERCISE_TYPE_SELF_RATING,
    responseTimeMs: Math.max(0, Math.round(durationMs)),
  });

  const next = optimistic(card, rating);
  return {
    status: wordStatus(next),
    newlyActivated: card.activatedAt === null && next.activatedAt !== null,
  };
}

/**
 * 复刻服务端 apply_review 的 SM-2，**只为了让 UI 立刻能动**。
 * 服务端永远是权威：补发返回的 words 行会覆盖本地。
 * q=4 时 ease 恒 2.5，序列 1/3/8/20/50（`design.md` §8.2 已验算）。
 */
function optimistic(card: StudyCard, rating: UiRating): StudyCard {
  const q = toQuality(rating);
  let repetitions = card.repetitions;
  let interval = card.interval;

  if (q < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    repetitions += 1;
    const mult = q === 3 ? 0.75 : q === 5 ? 1.2 : 1;
    interval =
      repetitions === 1
        ? 1
        : repetitions === 2
          ? 3
          : Math.max(1, Math.round(Math.max(interval, 3) * 2.5 * mult));
  }

  const activatedAt =
    card.activatedAt !== null
      ? card.activatedAt
      : repetitions > 0 && interval >= 21
        ? new Date().toISOString()
        : null;

  return { ...card, repetitions, interval, activatedAt };
}

export const flushReviews = queue.flush;
export const pendingReviews = queue.pendingCount;
