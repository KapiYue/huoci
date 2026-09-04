// 首启抽样与播种。`design.md` §5.3（S2/S3）· `wordpacks-and-cold-start.md` §4。
//
// 放 shared 而不是页面里，是因为这两条规则要被单测钉死：
// 它们决定新用户看到的**前 30 个词**和**前 20 个学习目标**，错了一次就是一个用户的第一印象。
//
// ⚠️ 这里**不做任何网络请求、不碰 wx.***。输入是词表数组，输出是词表数组，纯函数。

/** `packs/base.json` 的一行：[拼写, 频段 1-6, 来源位, frq 排名（0 = 缺值）] */
export type BaseWordRow = [string, number, number, number];

export interface BaseWord {
  spelling: string;
  /** 1 = 最高频，6 = 最低频 */
  band: number;
  /** ECDICT frq 排名，越小越常见。**0 表示缺值，一律排到最后** */
  frq: number;
}

export const BAND_COUNT = 6;
/** S2 出题数：6 频段 × 3 = 18，再按边界段 ±1 补 12 = 30 */
export const SAMPLE_FIRST_ROUND_PER_BAND = 3;
export const SAMPLE_TOTAL = 30;
/** S3 播种数 */
export const SEED_COUNT = 20;

/** frq 缺值（0）排到最后，否则「没有频率数据的生僻词」会被当成最常见的词优先投放 */
export function frqRank(frq: number): number {
  return frq > 0 ? frq : Number.POSITIVE_INFINITY;
}

export function parseBasePack(rows: BaseWordRow[]): BaseWord[] {
  return rows.map(([spelling, band, , frq]) => ({ spelling, band, frq }));
}

/** 可注入的随机源，让单测能拿到确定结果 */
export type Rng = () => number;

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function byBand(words: readonly BaseWord[]): Map<number, BaseWord[]> {
  const m = new Map<number, BaseWord[]>();
  for (let b = 1; b <= BAND_COUNT; b++) m.set(b, []);
  for (const w of words) {
    const bucket = m.get(w.band);
    if (bucket) bucket.push(w);
  }
  return m;
}

/**
 * S2 的 30 词抽样。`wordpacks-and-cold-start.md` §4 第 2 层。
 *
 *   第一轮：6 个频段各抽 3 个 = 18 题（**段间不随机、段内随机**）
 *   第二轮：在「边界段 ±1」再抽 12 题，凑满 30
 *
 * 第一轮跑完还不知道用户的边界在哪，所以第二轮的 12 题是**预取**的：
 * 从中间三段（2/3/4）补，覆盖绝大多数上班族的实际边界。真正的自适应留到有数据之后再说
 * —— 现在做自适应等于用假设去猜假设。
 *
 * 返回顺序 = 呈现顺序：**按频段升序**，用户从最熟悉的词开始勾，心理成本最低。
 */
export function sampleOnboardingWords(
  pool: readonly BaseWord[],
  rng: Rng = Math.random
): BaseWord[] {
  const buckets = byBand(pool);
  const picked = new Map<string, BaseWord>();

  // 第一轮：段间不随机（1→6 逐段），段内随机
  for (let b = 1; b <= BAND_COUNT; b++) {
    for (const w of shuffled(buckets.get(b) ?? [], rng).slice(0, SAMPLE_FIRST_ROUND_PER_BAND)) {
      picked.set(w.spelling, w);
    }
  }

  // 第二轮：边界段 ±1 补足到 30。先中间三段，不够再从全表补
  const boundaryOrder = [3, 2, 4, 1, 5, 6];
  for (const b of boundaryOrder) {
    if (picked.size >= SAMPLE_TOTAL) break;
    for (const w of shuffled(buckets.get(b) ?? [], rng)) {
      if (picked.size >= SAMPLE_TOTAL) break;
      if (!picked.has(w.spelling)) picked.set(w.spelling, w);
    }
  }

  return [...picked.values()].sort(
    (a, b) => a.band - b.band || frqRank(a.frq) - frqRank(b.frq) || a.spelling.localeCompare(b.spelling)
  );
}

/**
 * 由勾选结果推出 `level_line`（用户水平线所在频段）。
 *
 * 定义：**勾选（= 说不出口）的词里最高频的那一段**就是边界 —— 连那一段都说不出口，
 * 说明水平线还在它上面。一个都没勾 = 水平线在最低频段之外。
 */
export function computeLevelLine(checked: readonly BaseWord[]): number {
  if (checked.length === 0) return BAND_COUNT;
  return Math.min(...checked.map((w) => w.band));
}

export interface SeedResult {
  words: BaseWord[];
  levelLine: number;
  /** 一个都没勾：底子够了，该去读自己的文章而不是背底座词（§5.3 S3） */
  isHighLevel: boolean;
}

/**
 * S3 播种。`design.md` §5.3 S3：
 *
 *   seeds = 勾选词，按 frq 升序，取前 20
 *   if (不足 20)  从 level_line 所在频段内、frq 升序、未勾选的词补足到 20
 *   if (勾选 0 个) 从第 6 频段（最低频）取 20 词，并提示去读自己的文章
 *
 * 补足仍不够时（小词表 / 测试夹具）从全表按 frq 升序兜底，**宁可少于 20 也不重复**。
 */
export function seedWords(
  pool: readonly BaseWord[],
  checked: readonly BaseWord[],
  count = SEED_COUNT
): SeedResult {
  const levelLine = computeLevelLine(checked);
  const asc = (a: BaseWord, b: BaseWord) =>
    frqRank(a.frq) - frqRank(b.frq) || a.spelling.localeCompare(b.spelling);

  if (checked.length === 0) {
    const lowest = pool.filter((w) => w.band === BAND_COUNT).sort(asc);
    return { words: lowest.slice(0, count), levelLine, isHighLevel: true };
  }

  const seeds = checked.slice().sort(asc).slice(0, count);
  if (seeds.length < count) {
    const taken = new Set(seeds.map((w) => w.spelling));
    const fill = (candidates: BaseWord[]) => {
      for (const w of candidates.sort(asc)) {
        if (seeds.length >= count) return;
        if (taken.has(w.spelling)) continue;
        taken.add(w.spelling);
        seeds.push(w);
      }
    };
    fill(pool.filter((w) => w.band === levelLine));
    fill(pool.slice()); // 兜底：小词表时 level_line 那一段可能不够 20 个
  }

  return { words: seeds, levelLine, isHighLevel: false };
}
