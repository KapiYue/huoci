import { LISTS, PATHS } from '../config.mjs';
import { readNdjson, readJson, writeJson, ensureDirSelf, P, step, ok, warn, log, fmt, pct } from '../lib/io.mjs';
import { inflectionsOf } from '../lib/exchange.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ⚠️ 这一步是整条管线的主要风险（`design.md` §13.1）。
// NGSL 系列是 lemma 列表，ECDICT 是词形表。对不上的必须落盘供人工过目，不能静默丢弃。
export async function alignLemma() {
  step('03 · 词元对齐（主要风险步骤）');

  const { lists, base } = readJson(P('out/lists.json'));
  const wanted = new Set(base);
  for (const l of LISTS) for (const w of lists[l.id] || []) wanted.add(w);

  /** @type {Map<string, any>} spelling -> ecdict lite row */
  const hit = new Map();
  /** @type {Map<string, string>} 变位形式 -> 原型（仅限我们关心的原型） */
  const inflectionIndex = new Map();

  // ⚠️ 大小写兜底索引。ECDICT 里有一批常用词**只以大写/首字母大写形式收录**：
  // core→CORE、north→North、god→God、polish→Polish、pole→Pole、fax→Fax、
  // mister→Mister、i→I、conservative→Conservative、populist→Populist。
  // 只做精确匹配的话，NGSL/BSL 这种全小写 lemma 表会把它们全判成「ECDICT 收词缺口」——
  // 那是错的诊断，会让 4,553 个底座词凭空少掉一批最高频的。
  /** @type {Map<string, any>} lowercase spelling -> ecdict lite row */
  const ciIndex = new Map();
  const wantedLower = new Set();
  for (const w of wanted) wantedLower.add(w.toLowerCase());

  let scanned = 0;
  await readNdjson(P('out/word-lite.ndjson'), (r) => {
    scanned++;
    if (wanted.has(r.w)) {
      // 同一拼写在 ECDICT 里可能多行，保留 frq 更优（更小且非 0）的那条
      const prev = hit.get(r.w);
      if (!prev || (r.f > 0 && (prev.f === 0 || r.f < prev.f))) hit.set(r.w, r);
    } else {
      const lower = r.w.toLowerCase();
      if (wantedLower.has(lower)) {
        const prev = ciIndex.get(lower);
        if (!prev || (r.f > 0 && (prev.f === 0 || r.f < prev.f))) ciIndex.set(lower, r);
      }
    }
    // 该词形指向的原型正好是我们要的 → 记下这条覆盖关系
    if (r.l && wanted.has(r.l)) inflectionIndex.set(r.w, r.l);
  });

  const directHits = hit.size;
  log(`扫描 ECDICT ${fmt(scanned)} 行，直接命中 ${fmt(directHits)} / ${fmt(wanted.size)} lemma`);

  // 大小写兜底。**不静默**：每一条都落进 reports/unmatched/_case-fallback.txt 供人工过目，
  // 因为 polish/Polish 这类词大小写不同义，用错释义比缺词更难发现。
  const caseFallback = [];
  for (const w of wanted) {
    if (hit.has(w)) continue;
    const row = ciIndex.get(w.toLowerCase());
    if (!row) continue;
    // 键仍用词表里的小写拼写（base.json 要的是它），值取 ECDICT 那一行
    hit.set(w, { ...row, w });
    caseFallback.push(`${w}\t← ECDICT: ${row.w}`);
  }
  if (caseFallback.length) {
    warn(`大小写兜底命中 ${fmt(caseFallback.length)} 条（如 core ← CORE）→ reports/unmatched/_case-fallback.txt`);
  }

  // 展开每个命中原型的变位形式，验证覆盖（run → running/ran/runs）
  let inflTotal = 0;
  for (const [w, r] of hit) {
    for (const v of inflectionsOf(r.ex)) { inflectionIndex.set(v, w); inflTotal++; }
  }
  log(`词形覆盖：${fmt(inflectionIndex.size)} 个变位形式指向底座/词包原型`);

  // 未匹配清单，按表分开报（合并报会掩盖问题）
  ensureDirSelf(PATHS.unmatched);
  writeFileSync(join(PATHS.unmatched, '_case-fallback.txt'),
    `# 大小写兜底命中清单（共 ${caseFallback.length} 条）\n` +
    `# 这些词表 lemma 在 ECDICT 里只有大写/首字母大写的条目。\n` +
    `# ⚠️ **必须人工过目**：polish/Polish、pole/Pole 这类词大小写不同义，\n` +
    `#    兜底可能拿到错误的释义。用错释义比缺词更难被发现。\n\n` +
    caseFallback.join('\n') + '\n');

  const unmatched = {};
  for (const l of LISTS) {
    const miss = (lists[l.id] || []).filter((w) => !hit.has(w));
    unmatched[l.id] = miss;
    const f = join(PATHS.unmatched, `${l.id}.txt`);
    writeFileSync(f,
      `# ${l.name} · 词元对齐未匹配清单\n` +
      `# 共 ${miss.length} / ${(lists[l.id] || []).length} 条在 ECDICT 中找不到\n` +
      '# ⚠️ 必须人工过目后才能进 P2（design.md §13.1 · §21.1「词元对齐失败被静默吞掉」）\n' +
      `# 常见原因：连字符写法差异、英式/美式拼写、专有名词、ECDICT 收词缺口\n\n` +
      miss.join('\n') + '\n');
    const rate = pct(miss.length, (lists[l.id] || []).length || 1);
    if (miss.length) warn(`${l.name}: 未匹配 ${fmt(miss.length)} 条（${rate}）→ reports/unmatched/${l.id}.txt`);
    else ok(`${l.name}: 全部匹配`);
  }

  writeJson(P('out/aligned.json'), {
    hit: Object.fromEntries(hit),
    inflectionIndex: Object.fromEntries(inflectionIndex),
    unmatchedCounts: Object.fromEntries(Object.entries(unmatched).map(([k, v]) => [k, v.length])),
  });
  ok('out/aligned.json · reports/unmatched/*.txt');
  return { hit, inflectionIndex, unmatched };
}
