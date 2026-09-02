// 本地存储的 key 全集。散在各处的字符串字面量迟早会拼错，集中在这里。

export const SK = {
  SESSION: 'hc.session',
  OPENID: 'hc.openid',
  /** 今日队列的读缓存（T1-c：通勤/地铁是核心场景，纯瘦客户端在这里不可用） */
  PLAN_CACHE: 'hc.cache.plan',
  CARDS_CACHE: 'hc.cache.cards',
  /** 离线写队列 */
  REVIEW_QUEUE: 'hc.queue.review',
  /** 埋点攒批 */
  EVENT_BUFFER: 'hc.buffer.events',
  HC_PROFILE: 'hc.profile',
} as const;

export function read<T>(key: string, fallback: T): T {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, value);
  } catch {
    // 存储写满或被清理，不该让业务流程崩掉
  }
}

export function remove(key: string): void {
  try {
    wx.removeStorageSync(key);
  } catch {
    /* noop */
  }
}

/** 带时效的读缓存 */
export interface Cached<T> {
  at: number;
  data: T;
}

export function readCache<T>(key: string, maxAgeMs: number): T | null {
  const c = read<Cached<T> | null>(key, null);
  if (!c || typeof c.at !== 'number') return null;
  if (Date.now() - c.at > maxAgeMs) return null;
  return c.data;
}

/** 过期也照样返回。断网时「旧数据 + 一个离线角标」远好过一片空白。 */
export function readCacheStale<T>(key: string): T | null {
  const c = read<Cached<T> | null>(key, null);
  return c && typeof c.at === 'number' ? c.data : null;
}

export function writeCache<T>(key: string, data: T): void {
  write(key, { at: Date.now(), data } satisfies Cached<T>);
}
