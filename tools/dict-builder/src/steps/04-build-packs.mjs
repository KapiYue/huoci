import { LISTS, EXAM_TAGS, ATTRIBUTION, PATHS } from '../config.mjs';
import { assignBands, BAND_COUNT } from '../lib/bands.mjs';
import { readNdjson, readJson, writeJson, P, step, ok, log, warn, fmt } from '../lib/io.mjs';
import { join } from 'node:path';

const VERSION = '1.0.0';

export async function buildPacks() {
  step('04 · 产出词包');
  const { lists, base } = readJson(P('out/lists.json'));
  const aligned = readJson(P('out/aligned.json'));
  const hit = aligned.hit;

  // ---------- base.json（主包，NGSL ∪ BSL）----------
  const baseItems = base.filter((w) => hit[w]).map((w) => ({ spelling: w, frq: hit[w].f || Number.POSITIVE_INFINITY }));
  const bands = assignBands(baseItems);

  const bitOf = {};
  for (const l of LISTS) if (l.base) for (const w of lists[l.id] || []) bitOf[w] = (bitOf[w] || 0) | l.bit;

  // 第 4 列 frqRank：首启播种要「按 frq 升序取前 20」（`design.md` §5.3），band 只有 6 档，
  // 段内还得再排一次序，所以排名必须随包发下去。缺值写 0，消费侧按「排到最后」处理。
  const baseWords = baseItems
    .map((it) => [
      it.spelling,
      bands.get(it.spelling),
      bitOf[it.spelling] || 0,
      Number.isFinite(it.frq) ? it.frq : 0,
    ])
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  const basePack = {
    id: 'base', name: '通用底座 + 职场底座', version: VERSION,
    generatedAt: new Date().toISOString().slice(0, 10),
    bandCount: BAND_COUNT,
    schema: ['spelling', 'band(1-6)', 'sourceBits(1=NGSL,2=BSL)', 'frqRank(0=缺值)'],
    ...ATTRIBUTION,
    count: baseWords.length,
    words: baseWords,
  };
  writeJson(join(PATHS.packs, 'base.json'), basePack, false);
  const kb = (JSON.stringify(basePack).length / 1024).toFixed(0);
  log(`base.json  ${fmt(baseWords.length)} 词  ${kb} KB（主包预算 ~120KB，含 frqRank 列）`);
  if (kb > 180) warn(`base.json 体积 ${kb}KB 超出预期，检查是否误存了释义`);

  // ---------- pro-*.json（分包 A：TSL / NAWL / Spoken）----------
  const baseSet = new Set(base);
  for (const l of LISTS.filter((x) => !x.base)) {
    const words = (lists[l.id] || []).filter((w) => hit[w]);
    const net = words.filter((w) => !baseSet.has(w)); // 净增：扣掉底座
    writeJson(join(PATHS.packs, `pro-${l.id}.json`), {
      id: `pro-${l.id}`, name: l.name, version: VERSION,
      schema: ['spelling', 'frqRank'], ...ATTRIBUTION,
      rawCount: words.length, count: net.length,
      words: net.map((w) => [w, hit[w].f || 0]).sort((a, b) => (a[1] || 1e9) - (b[1] || 1e9)),
    }, false);
    log(`pro-${l.id}.json  原始 ${fmt(words.length)} → 净增 ${fmt(net.length)}`);
  }

  // ---------- exam-*.json（分包 A：按 ECDICT tag 切，lemma 归并）----------
  const tagged = [];
  await readNdjson(P('out/tagged.ndjson'), (r) => tagged.push(r));

  const examOut = {};
  for (const e of EXAM_TAGS) {
    const rows = tagged.filter((r) => r.t.includes(e.tag));
    // lemma 归并：abandon 与 abandoned 都带 cet4，包里不能同时出现原型和变位
    const lemmas = new Map();
    for (const r of rows) {
      const key = r.l || r.w;
      const prev = lemmas.get(key);
      if (!prev || (r.f > 0 && (prev.f === 0 || r.f < prev.f))) lemmas.set(key, r);
    }
    const net = [...lemmas.keys()].filter((w) => !baseSet.has(w));
    examOut[e.tag] = { raw: rows.length, lemma: lemmas.size, net: net.length, words: net, rows: lemmas };

    if (e.pack) {
      writeJson(join(PATHS.packs, `exam-${e.tag}.json`), {
        id: `exam-${e.tag}`, name: e.name, version: VERSION,
        schema: ['spelling', 'frqRank'],
        source: 'ECDICT tag 聚合数据',
        disclaimer: '词表来自 ECDICT 聚合数据，非官方考纲。四六级大纲改过版，考研大纲每年微调，雅思托福本无官方词表。',
        rawCount: rows.length, lemmaCount: lemmas.size, count: net.length,
        words: net.map((w) => [w, lemmas.get(w).f || 0]).sort((a, b) => (a[1] || 1e9) - (b[1] || 1e9)),
      }, false);
    }
    log(`${e.name.padEnd(12)} 原始 ${String(fmt(rows.length)).padStart(7)} → lemma ${String(fmt(lemmas.size)).padStart(7)} → 净增 ${String(fmt(net.length)).padStart(7)}${e.pack ? '' : '  (只统计，不成包)'}`);
  }

  writeJson(P('out/exam-summary.json'),
    Object.fromEntries(Object.entries(examOut).map(([k, v]) => [k, { raw: v.raw, lemma: v.lemma, net: v.net, words: v.words }])));
  ok(`packs/ 产出完成`);
  return { basePack, examOut, baseSet };
}
