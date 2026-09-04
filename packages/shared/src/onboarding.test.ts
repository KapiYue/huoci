import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleOnboardingWords,
  seedWords,
  computeLevelLine,
  parseBasePack,
  frqRank,
  BAND_COUNT,
  SAMPLE_TOTAL,
  SEED_COUNT,
  type BaseWord,
  type BaseWordRow,
  type Rng,
} from './onboarding.js';

/** 6 段 × n 词的合成词表。frq 全局递增，方便断言排序。 */
function pool(perBand = 40): BaseWord[] {
  const out: BaseWord[] = [];
  let frq = 1;
  for (let b = 1; b <= BAND_COUNT; b++) {
    for (let i = 0; i < perBand; i++) {
      out.push({ spelling: `b${b}w${String(i).padStart(3, '0')}`, band: b, frq: frq++ });
    }
  }
  return out;
}

/** 确定性 RNG，让「段内随机」在测试里可复现 */
function seededRng(seed = 1): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------- 抽样 ----------

test('§5.3 S2：恒出 30 题，无重复', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const got = sampleOnboardingWords(pool(), seededRng(seed));
    assert.equal(got.length, SAMPLE_TOTAL, `seed=${seed}`);
    assert.equal(new Set(got.map((w) => w.spelling)).size, SAMPLE_TOTAL, `seed=${seed} 有重复`);
  }
});

test('§5.3 S2：6 个频段每段至少 3 个（第一轮的硬保证）', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const got = sampleOnboardingWords(pool(), seededRng(seed));
    for (let b = 1; b <= BAND_COUNT; b++) {
      const n = got.filter((w) => w.band === b).length;
      assert.ok(n >= 3, `seed=${seed} band=${b} 只有 ${n} 个`);
    }
  }
});

test('§5.3 S2：呈现顺序按频段升序，用户从最熟的词开始勾', () => {
  const got = sampleOnboardingWords(pool(), seededRng(7));
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i]!.band >= got[i - 1]!.band, `第 ${i} 个的 band 倒退了`);
  }
});

test('§5.3 S2：段内随机 —— 换随机源出的题不同（否则每个用户看到同一批词）', () => {
  const a = sampleOnboardingWords(pool(), seededRng(1)).map((w) => w.spelling).join();
  const b = sampleOnboardingWords(pool(), seededRng(999)).map((w) => w.spelling).join();
  assert.notEqual(a, b);
});

test('词表小于 30 时不死循环，也不造假词', () => {
  const tiny = pool(2); // 12 个词
  const got = sampleOnboardingWords(tiny, seededRng(3));
  assert.equal(got.length, 12);
  assert.equal(new Set(got.map((w) => w.spelling)).size, 12);
});

// ---------- level_line ----------

test('level_line = 勾选词里最高频的那一段', () => {
  const p = pool();
  const pick = (b: number) => p.find((w) => w.band === b)!;
  assert.equal(computeLevelLine([pick(4), pick(2), pick(5)]), 2);
  assert.equal(computeLevelLine([pick(6)]), 6);
});

test('一个都没勾 → level_line 落在最低频段', () => {
  assert.equal(computeLevelLine([]), BAND_COUNT);
});

// ---------- 播种 ----------

test('§5.3 S3 主路径：勾满时恒出 20 词，按 frq 升序', () => {
  const p = pool();
  const checked = p.filter((w) => w.band === 3).slice(0, 25);
  const { words, isHighLevel } = seedWords(p, checked);
  assert.equal(words.length, SEED_COUNT);
  assert.equal(isHighLevel, false);
  for (let i = 1; i < words.length; i++) {
    assert.ok(frqRank(words[i]!.frq) >= frqRank(words[i - 1]!.frq), '不是 frq 升序');
  }
  // 全部来自勾选词，不掺未勾选的
  const set = new Set(checked.map((w) => w.spelling));
  assert.ok(words.every((w) => set.has(w.spelling)));
});

test('§5.3 S3 补足分支：勾选不足 20 时从 level_line 频段补', () => {
  const p = pool();
  const checked = p.filter((w) => w.band === 4).slice(0, 5);
  const { words, levelLine } = seedWords(p, checked);
  assert.equal(words.length, SEED_COUNT);
  assert.equal(levelLine, 4);
  const checkedSet = new Set(checked.map((w) => w.spelling));
  const filled = words.filter((w) => !checkedSet.has(w.spelling));
  assert.equal(filled.length, 15);
  assert.ok(filled.every((w) => w.band === 4), '补的词应来自 level_line 所在频段');
  assert.equal(new Set(words.map((w) => w.spelling)).size, SEED_COUNT, '补足时出现了重复');
});

test('§5.3 S3 零勾选分支：从第 6 频段取 20 词，并标记 isHighLevel', () => {
  const p = pool();
  const { words, levelLine, isHighLevel } = seedWords(p, []);
  assert.equal(words.length, SEED_COUNT);
  assert.equal(levelLine, BAND_COUNT);
  assert.equal(isHighLevel, true);
  assert.ok(words.every((w) => w.band === BAND_COUNT));
});

test('level_line 那一段不够时从全表兜底，宁可少于 20 也不重复', () => {
  const tiny = pool(3); // 每段 3 个，共 18
  const checked = tiny.filter((w) => w.band === 2).slice(0, 1);
  const { words } = seedWords(tiny, checked);
  assert.equal(words.length, 18);
  assert.equal(new Set(words.map((w) => w.spelling)).size, 18);
});

// ---------- frq 缺值 ----------

test('frq = 0 是缺值，必须排到最后，不能被当成最常见的词', () => {
  assert.equal(frqRank(0), Number.POSITIVE_INFINITY);
  assert.equal(frqRank(5), 5);
  const p: BaseWord[] = [
    { spelling: 'missing', band: 1, frq: 0 },
    { spelling: 'common', band: 1, frq: 100 },
  ];
  const { words } = seedWords(p, p, 2);
  assert.deepEqual(words.map((w) => w.spelling), ['common', 'missing']);
});

// ---------- 词包解析 ----------

test('parseBasePack 读 [拼写, band, sourceBits, frq] 四列，忽略 sourceBits', () => {
  const rows: BaseWordRow[] = [['able', 1, 3, 42], ['zeal', 6, 1, 0]];
  assert.deepEqual(parseBasePack(rows), [
    { spelling: 'able', band: 1, frq: 42 },
    { spelling: 'zeal', band: 6, frq: 0 },
  ]);
});
