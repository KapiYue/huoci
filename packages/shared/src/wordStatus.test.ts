import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordStatus,
  isActivated,
  shouldStampActivation,
  ACTIVATION_INTERVAL_DAYS as ACT,
  MASTERY_INTERVAL_DAYS as MAS,
  LEARNING_INTERVAL_DAYS as LRN,
  type WordState,
} from './wordStatus.js';
import { toQuality, UI_RATINGS } from './rating.js';

const w = (repetitions: number, interval: number, activatedAt: string | null = null): WordState =>
  ({ repetitions, interval, activatedAt });

const T = '2026-09-01T00:00:00.000Z';

test('从未学过 = captured，与 interval 无关', () => {
  assert.equal(wordStatus(w(0, 0)), 'captured');
  assert.equal(wordStatus(w(0, 999)), 'captured');
});

test('interval < 6 = learning（含 lapse 后的 interval=1）', () => {
  assert.equal(wordStatus(w(1, 1)), 'learning');
  assert.equal(wordStatus(w(2, 3)), 'learning');
  assert.equal(wordStatus(w(0 + 1, LRN - 1)), 'learning');
});

test('6 ≤ interval < 21 = remembered（SM-2 的第 3、4 次成功：8 / 20）', () => {
  assert.equal(wordStatus(w(3, 8)), 'remembered');
  assert.equal(wordStatus(w(4, 20)), 'remembered');
  assert.equal(wordStatus(w(3, LRN)), 'remembered');
});

test('interval ≥ 21 = activated（边界含等号；SM-2 第 5 次成功 interval=50）', () => {
  assert.equal(wordStatus(w(5, ACT)), 'activated');
  assert.equal(wordStatus(w(5, 50)), 'activated');
});

test('§3.3 已激活永不回退：lapse 把 interval 打回 1 也仍是 activated', () => {
  assert.equal(wordStatus(w(0, 1, T)), 'captured', 'repetitions=0 优先级最高');
  assert.equal(wordStatus(w(1, 1, T)), 'activated', 'activatedAt 非空即锁死');
  assert.equal(wordStatus(w(2, 3, T)), 'activated');
});

test('P6 之前不存在 mastered —— 没有口语数据就停在 activated', () => {
  assert.equal(wordStatus(w(9, MAS + 100, T)), 'activated');
});

test('mastered 需要 activatedAt + interval≥60 + 口语≥80 三者同时成立', () => {
  assert.equal(wordStatus(w(9, MAS, T), { bestScore: 80 }), 'mastered');
  assert.equal(wordStatus(w(9, MAS, T), { bestScore: 79 }), 'activated');
  assert.equal(wordStatus(w(9, MAS - 1, T), { bestScore: 100 }), 'activated');
  assert.equal(
    wordStatus(w(9, MAS, null), { bestScore: 100 }),
    'activated',
    'activatedAt 为空时不可能 mastered'
  );
});

test('isActivated 覆盖 activated 与 mastered', () => {
  assert.equal(isActivated(w(5, ACT)), true);
  assert.equal(isActivated(w(9, MAS, T), { bestScore: 90 }), true);
  assert.equal(isActivated(w(4, ACT - 1)), false);
  assert.equal(isActivated(w(0, 0)), false);
});

test('shouldStampActivation 只在首次跨过 21 天时为 true', () => {
  assert.equal(shouldStampActivation(w(5, ACT)), true);
  assert.equal(shouldStampActivation(w(4, ACT - 1)), false);
  assert.equal(shouldStampActivation(w(0, ACT)), false, 'repetitions=0 是 captured，不该盖章');
  assert.equal(shouldStampActivation(w(5, ACT, T)), false, '已盖过章就不再改写');
});

test('§4.3 rating → p_quality 映射固定为 1 / 3 / 4 / 5', () => {
  assert.equal(toQuality(1), 1);
  assert.equal(toQuality(2), 3);
  assert.equal(toQuality(3), 4);
  assert.equal(toQuality(4), 5);
});

test('UI 只出三档，顺序由差到好', () => {
  assert.deepEqual(
    UI_RATINGS.map((o) => o.rating),
    [1, 2, 3]
  );
  assert.equal(UI_RATINGS.length, 3, 'P2–P5 不得出现第四档');
});

test('§3.2 等价性：全程自评「记得」的间隔序列是 1/3/8/20/50，第 5 次才越过 21', () => {
  // 复刻 apply_review 的 SM-2（q=4 时 ease 恒 2.5、乘子 1）
  const seq: number[] = [];
  let interval = 0;
  for (let rep = 1; rep <= 5; rep++) {
    interval =
      rep === 1 ? 1 : rep === 2 ? 3 : Math.max(1, Math.round(Math.max(interval, 3) * 2.5));
    seq.push(interval);
  }
  assert.deepEqual(seq, [1, 3, 8, 20, 50]);
  assert.equal(seq.findIndex((i) => i >= ACT) + 1, 5, '第 5 次成功才达到激活线');
});
