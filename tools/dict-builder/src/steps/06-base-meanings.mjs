import { PATHS, ATTRIBUTION } from '../config.mjs';
import { readCsv } from '../lib/csv.mjs';
import { readJson, writeJson, P, step, ok, log, warn, fmt, pct } from '../lib/io.mjs';

// 06 · 给底座词补音标与释义，产出**服务端**用的 packs/base-full.json。
//
// 为什么要有这一步（`design.md` §11 ④）：
//   `words.primary_meaning` 是 **NOT NULL**。首启播种要把 20 个底座词写成用户的 words 行，
//   必须在某处拿到释义 —— 而主包里的 base.json 按 §13.1 只有 spelling + band + frq。
//
// 「底座不存释义」那条约束针对的是**主包 90KB 预算**，服务端表没有这个预算。
// 所以分成两份产物，各自遵守各自的约束：
//   packs/base.json       → 打进小程序主包，**不带释义**，93KB
//   packs/base-full.json  → 灌 hc_base_words，带音标 + 释义，约 400KB，永不下发
//
// ⚠️ 这一步要重扫一遍 241MB 的 ecdict.csv。它不在 `all` 里，需要时单独跑：
//     node src/cli.mjs base-meanings

/** ECDICT 的 translation 是多义项换行串。取前两条，够卡片正面用，也不至于糊满一屏。 */
const MAX_SENSES = 2;
const MAX_LEN = 120;

function condense(translation) {
  const senses = translation
    .split(/\\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SENSES);
  const text = senses.join('；');
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 1)}…` : text;
}

export async function baseMeanings() {
  step('06 · 给底座词补音标与释义（服务端用）');

  const base = readJson(P('packs/base.json'));
  if (!base?.words?.length) {
    throw new Error('先跑 `node src/cli.mjs packs` 产出 packs/base.json');
  }

  // spelling 一律小写：hc_base_words.spelling 要和 words.normalized_term 同口径才 join 得上
  const want = new Map();
  for (const [spelling, band, bits, frq] of base.words) {
    want.set(spelling.toLowerCase(), { spelling: spelling.toLowerCase(), band, bits, frq });
  }
  log(`底座 ${fmt(want.size)} 词，开始从 ecdict.csv 取音标与释义`);

  const found = new Map();
  await readCsv(PATHS.ecdict, (r) => {
    const w = (r.word || '').trim().toLowerCase();
    if (!w || !want.has(w) || found.has(w)) return;
    const translation = (r.translation || '').trim();
    if (!translation) return;
    found.set(w, {
      phonetic: (r.phonetic || '').trim(),
      meaning: condense(translation),
    });
  });

  const rows = [];
  const missing = [];
  for (const [w, meta] of want) {
    const hit = found.get(w);
    if (!hit) {
      missing.push(w);
      continue;
    }
    rows.push([meta.spelling, meta.band, meta.bits, meta.frq, hit.phonetic, hit.meaning]);
  }

  writeJson(P('packs/base-full.json'), {
    id: 'base-full',
    name: '通用底座 + 职场底座（含音标与释义，服务端用）',
    version: base.version,
    generatedAt: new Date().toISOString().slice(0, 10),
    bandCount: base.bandCount,
    schema: ['spelling', 'band(1-6)', 'sourceBits(1=NGSL,2=BSL)', 'frqRank(0=缺值)', 'phonetic', 'primaryMeaning'],
    ...ATTRIBUTION,
    note: `${ATTRIBUTION.note}。**本文件永不下发到客户端**，只用于灌 hc_base_words（design.md §13.2）。`,
    count: rows.length,
    words: rows,
  });

  if (missing.length) {
    warn(`${fmt(missing.length)} 个底座词在 ECDICT 里没有中文释义（${pct(missing.length, want.size)}）`);
    warn('它们不会进 base-full.json —— 播种时会退化成「待补充」，不影响流程');
    writeJson(P('reports/base-meanings-missing.json'), { count: missing.length, words: missing });
  }

  ok(`packs/base-full.json  ${fmt(rows.length)} 词（覆盖 ${pct(rows.length, want.size)}）`);
  return { total: want.size, filled: rows.length, missing: missing.length };
}
