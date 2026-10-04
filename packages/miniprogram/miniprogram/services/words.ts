// ③ 我的生词的数据层。`design.md` §5.4 S6。
//
// 三个筛选走同一个 RPC `hc_list_words`（`0006`），**不在客户端拼两张表**：
// 「已激活」的判据是 `hc_word_status.activated_at` 非空（附录 A，一次写入永不改写），
// 用 `interval_days >= 21` 这个便捷判据在 lapse 之后会变假 —— 那正是 §8.2 禁止的回退。
// 判据只能有一处实现，放服务端。

import * as gw from './gateway';
import * as store from './storage';
import { toCard } from './learning';
import type { QueueRow } from './learning';
import type { StudyCard } from '../shared/types';
import type { Loaded } from './learning';
import { ApiError } from './types';
import { mockWords, mockWordsSummary } from './words.mock';

/** 当前「我的生词」尚未接接口。改为 false 即恢复下方现成的 RPC + 缓存路径。 */
export const USING_LOCAL_MOCK = true;

/** 与 §5.4 S6 的三个 tab 一一对应 */
export type WordFilter = 'recent' | 'due' | 'activated';

export const FILTERS: { id: WordFilter; label: string }[] = [
  { id: 'recent', label: '最近遇到' },
  { id: 'due', label: '待复习' },
  { id: 'activated', label: '已激活' },
];

/** 一屏取多少。长列表靠分页 + recycle-view 控住 setData 体积（§14.3） */
export const PAGE_SIZE = 40;

const CACHE_TTL = 3 * 60 * 1000;

function cacheKey(filter: WordFilter): string {
  return `${store.SK.WORDS_CACHE}.${filter}`;
}

/**
 * 拉一页生词。
 *
 * 只有第一页进读缓存：断网时给「上次的第一屏 + 离线角标」远好过一片空白（T1-c），
 * 而缓存翻页没有意义 —— 用户在地铁里翻到第 5 页这件事本身就不会发生。
 */
export async function fetchWords(
  filter: WordFilter,
  offset = 0
): Promise<Loaded<StudyCard[]>> {
  if (USING_LOCAL_MOCK) {
    const rows = mockWords(filter);
    return { data: rows.slice(offset, offset + PAGE_SIZE), stale: false };
  }
  try {
    const rows = await gw.rpc<QueueRow[]>('hc_list_words', {
      p_filter: filter,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    const cards = (rows || []).map(toCard);
    if (offset === 0) store.writeCache(cacheKey(filter), cards);
    return { data: cards, stale: false };
  } catch (e) {
    if (offset === 0) {
      const fallback = store.readCacheStale<StudyCard[]>(cacheKey(filter));
      if (fallback) return { data: fallback, stale: true };
    }
    if ((e as ApiError).kind === 'network') return { data: [], stale: true };
    throw e;
  }
}

/** 首屏的即时渲染：先吐缓存再打网络，列表不要空一下再跳出来 */
export function cachedWords(filter: WordFilter): StudyCard[] | null {
  if (USING_LOCAL_MOCK) return mockWords(filter).slice(0, PAGE_SIZE);
  return store.readCache<StudyCard[]>(cacheKey(filter), CACHE_TTL);
}

/** mock 模式下供页面标题计数；真实接口模式继续使用 hc_home_summary。 */
export const localMockSummary = mockWordsSummary;

export function clearCache(): void {
  for (const f of FILTERS) store.remove(cacheKey(f.id));
}
