// ④ 查词的数据层。`design.md` §5.4 S7。
//
// 首发审核版只提供公开词典信息查询，不调用内容生成服务。
// **全量词典永不下发**（§13.2）——客户端只向网关提交单个英文词。
//
// 加入生词走词鲸的 `save_word(p_payload jsonb)` RPC（**不是**裸 REST，§12.4 第 1 条；
// 何况 wx.request 没有 PATCH，物理上也走不了 upsert）。

import * as gw from './gateway';
import * as words from './words';
import { ApiError } from './types';
import type { CijingWord } from '../shared/types';

/** 公开词典查询的统一返回体。 */
export interface LookupResult {
  term: string;
  lemma: string;
  phonetic: string;
  parts: { partOfSpeech: string; meaning: string }[];
  primaryMeaning: string;
  contextualMeaning: string;
  englishDefinition: string;
  exampleEnglish: string;
  exampleChinese: string;
  sentence: string;
  audioUrl?: string | null;
  dictionaryAttribution?: unknown;
}

/** 只放行单个英文词。Edge Function 那边同样会校验，这里先挡一道省一次跨境往返。 */
export const WORD_RE = /^[A-Za-z][A-Za-z'-]{0,60}$/;

export function normalize(input: string): string {
  return input.trim().replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, '');
}

export async function lookup(word: string): Promise<LookupResult> {
  const term = normalize(word);
  if (!WORD_RE.test(term)) {
    throw new ApiError('client', 400, '只能查一个英文单词');
  }
  const res = await gw.request<{ data: LookupResult }>('/functions/v1/dictionary-lookup', {
    method: 'POST',
    body: { word: term },
    anonymous: true,
    timeout: 10000,
  });
  return res.data;
}

/**
 * 一次 capture 的来源信息。
 *
 * ⚠️ **`sourceTitle` 必填**：S6 的来源行按「三列全空 = 底座词」推导出「首启添加」，
 * 不带来源的词会被显示成首启播种的，那是错的（`design.md` §11 ④ 末尾的红字）。
 */
export interface CaptureMeta {
  sourceTitle: string;
  /** 原句。capture 词的核心资产。查词那条路没有原句就留空 —— **不编造例句**（附录 C） */
  context?: string | null;
  sourceUrl?: string | null;
}

/** 查词页的默认来源。阅读器会传入自己的来源与原句。 */
export const LOOKUP_META: CaptureMeta = { sourceTitle: '查词添加' };

/**
 * 加入我的活词。查词与阅读器共用这一个函数，差别只在 `meta`。
 */
export async function addWord(r: LookupResult, meta: CaptureMeta = LOOKUP_META): Promise<CijingWord> {
  const res = await gw.rpc<CijingWord | CijingWord[]>('save_word', {
    p_payload: {
      term: r.term,
      lemma: r.lemma || r.term,
      phonetic: r.phonetic,
      audio_url: r.audioUrl ?? null,
      parts: r.parts,
      primary_meaning: r.primaryMeaning,
      english_definition: r.englishDefinition,
      example_en: r.exampleEnglish,
      example_zh: r.exampleChinese,
      dictionary_attribution: r.dictionaryAttribution ?? null,
      context: meta.context ?? null,
      source_url: meta.sourceUrl ?? null,
      source_title: meta.sourceTitle,
    },
  });
  const saved = Array.isArray(res) ? (res[0] as CijingWord) : res;
  // 查词、阅读器等所有 capture 入口都走这里；缓存失效不能依赖每个页面各自记得做。
  words.clearCache();
  return saved;
}

/** 这个词是不是已经在我的活词里了。查完就知道按钮该显示哪一态。 */
export async function isSaved(term: string): Promise<boolean> {
  const norm = normalize(term).toLowerCase();
  if (!norm) return false;
  const rows = await gw.select<{ id: string }[]>(
    `words?select=id&normalized_term=eq.${encodeURIComponent(norm)}&limit=1`
  );
  return rows.length > 0;
}
