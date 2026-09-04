import { EXAM_TAGS, LISTS, AUDIO_PREGEN_TOP, DAILY_GOAL, PATHS } from '../config.mjs';
import { histogram, BAND_COUNT } from '../lib/bands.mjs';
import { readNdjson, readJson, writeJson, P, step, ok, log, warn, fmt, pct } from '../lib/io.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 《词包与冷启动方案》§7.1 的 8 项统计。
// 原则：只统计会改变某个决策的数字。第 3/4/5/6 项会真正改设计。
export async function report() {
  step('05 · 统计报告');

  const ingest = readJson(P('out/ingest-stats.json'));
  const { lists, base } = readJson(P('out/lists.json'));
  const aligned = readJson(P('out/aligned.json'));
  const exam = readJson(P('out/exam-summary.json'));
  const basePack = readJson(join(PATHS.packs, 'base.json'));

  const tagged = [];
  await readNdjson(P('out/tagged.ndjson'), (r) => tagged.push(r));
  const byTag = (t) => tagged.filter((r) => r.t.includes(t));

  const J = { generatedAt: new Date().toISOString(), ingest, exam: {}, overlap: {}, base: {} };
  const L = [];
  const push = (s = '') => L.push(s);

  push('# 词包统计报告 · pack-stats');
  push('');
  push(`生成时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  push('');
  push('> 口径依据《词包与冷启动方案》§7.1。**对外展示一律用净增词量，不用原始词量。**');
  push('');
  push('---');
  push('');

  // ---- 0. ECDICT 概况 ----
  push('## 0. ECDICT 概况');
  push('');
  push('| 项 | 值 |');
  push('|---|---|');
  push(`| 有效词条 | ${fmt(ingest.rows)} |`);
  push(`| 剔除畸形条目 | ${fmt(ingest.malformed)} |`);
  push(`| 带音标 | ${pct(ingest.withPhonetic, ingest.rows)} |`);
  push(`| 带中文释义 | ${pct(ingest.withTranslation, ingest.rows)} |`);
  push(`| 带 frq（COCA） | ${pct(ingest.withFrq, ingest.rows)} |`);
  push(`| 带 bnc | ${pct(ingest.withBnc, ingest.rows)} |`);
  push(`| 可回溯原型（exchange 含 \`0:\`） | ${fmt(ingest.withExchange0)} |`);
  push('');
  push('> ⚠️ **ECDICT 只有一个 `phonetic` 字段，没有 uk/us 之分。**');
  push('> `design.md` §9 的 `phonetic_uk` / `phonetic_us` 需要另找来源，或在 TTS 批处理时一并产出（见 §22.2 ④）。');
  push('> 这是一个已知的数据缺口，P2 的卡片先只显示单一音标。');
  push('');

  // ---- 1&2&3. 原始 / lemma / 净增 ----
  push('## 1–3. 各 tag 原始词量 → lemma 归并 → 对底座净增 ⭐');
  push('');
  push('| 包 | 原始（词形） | lemma 归并 | 缩水率 | **净增（扣底座）** | 净增/lemma | 可完成天数 |');
  push('|---|---|---|---|---|---|---|');
  for (const e of EXAM_TAGS) {
    const v = exam[e.tag]; if (!v) continue;
    const shrink = v.raw ? pct(v.raw - v.lemma, v.raw) : '—';
    const days = Math.ceil(v.net / DAILY_GOAL);
    push(`| ${e.name}${e.pack ? '' : '（不成包）'} | ${fmt(v.raw)} | ${fmt(v.lemma)} | ${shrink} | **${fmt(v.net)}** | ${pct(v.net, v.lemma || 1)} | ${fmt(days)} 天 |`);
    J.exam[e.tag] = { ...v, words: undefined, days };
  }
  push('');
  push(`> **可完成天数** = 净增 ÷ ${DAILY_GOAL}（\`design.md\` §5.4 S4 每日目标）。`);
  push('> ⚠️ 超过 200 天的包，UI 上直接显示会吓退用户，不显示是欺骗 —— **需要专门定文案口径**。');
  push('');

  // ---- 4. 重叠矩阵 ----
  push('## 4. 包间重叠矩阵（净增口径）⭐');
  push('');
  const packTags = EXAM_TAGS.filter((e) => e.pack);
  push('| | ' + packTags.map((e) => e.tag).join(' | ') + ' |');
  push('|---|' + packTags.map(() => '---').join('|') + '|');
  for (const a of packTags) {
    const A = new Set(exam[a.tag]?.words || []);
    const row = [a.tag];
    for (const b of packTags) {
      if (a.tag === b.tag) { row.push('—'); continue; }
      const B = exam[b.tag]?.words || [];
      const inter = B.filter((w) => A.has(w)).length;
      row.push(A.size ? pct(inter, A.size) : '—');
      J.overlap[`${a.tag}->${b.tag}`] = { inter, of: A.size };
    }
    push('| ' + row.join(' | ') + ' |');
  }
  push('');
  push('> 读法：**行包中有多大比例的词也出现在列包里**（不对称）。');
  push('> 决定两件事：① 包做成**独立**还是**增量**（选了 cet6 要不要跳过 cet4 已有的）；');
  push('> ② UI 要不要提示「你选的两个包有 68% 重叠」。');
  push('');

  // ---- 5. frq 缺值率 + 频段直方图 ----
  push('## 5. frq / bnc 缺值率 + 频段直方图 ⭐');
  push('');
  push('| 包 | frq 缺值率 | bnc 缺值率 | 投放排序是否可用 |');
  push('|---|---|---|---|');
  for (const e of EXAM_TAGS) {
    const rows = byTag(e.tag); if (!rows.length) continue;
    const noFrq = rows.filter((r) => !r.f).length;
    const noBnc = rows.filter((r) => !r.b).length;
    const rate = noFrq / rows.length;
    const verdict = rate > 0.5 ? '🔴 **退化成乱序，需单独设计**' : rate > 0.2 ? '🟡 部分乱序' : '✅ 可用';
    push(`| ${e.name} | ${pct(noFrq, rows.length)} | ${pct(noBnc, rows.length)} | ${verdict} |`);
    J.exam[e.tag] && (J.exam[e.tag].frqMissing = noFrq / rows.length);
  }
  push('');
  push('> 《词包与冷启动方案》§4 第 3 层的新词投放是**按 frq 升序**。');
  push('> 🔴 的包必须回头改投放逻辑，否则用户拿到的是随机顺序。');
  push('');
  const bandHist = histogram(basePack.words.map((w) => w[1]));
  push('**底座频段分布**（首启 30 词抽样的依据）：');
  push('');
  push('| 频段 | 1 | 2 | 3 | 4 | 5 | 6 |');
  push('|---|---|---|---|---|---|---|');
  push('| 词数 | ' + bandHist.map(fmt).join(' | ') + ' |');
  push('');
  J.base = { count: basePack.count, bandHist };

  // ---- 6. 数据完整度三项 ----
  push('## 6. 数据完整度三项 ⭐');
  push('');
  push('| 包 | ① 释义空缺 | ② 音标空缺 | ③ 落在 Top ' + fmt(AUDIO_PREGEN_TOP) + ' 之外 |');
  push('|---|---|---|---|');
  for (const e of EXAM_TAGS) {
    const rows = byTag(e.tag); if (!rows.length) continue;
    const noTr = rows.filter((r) => !r.tr).length;
    const noPh = rows.filter((r) => !r.ph).length;
    const outOfTop = rows.filter((r) => !r.f || r.f > AUDIO_PREGEN_TOP).length;
    push(`| ${e.name} | ${pct(noTr, rows.length)} | ${pct(noPh, rows.length)} | ${pct(outOfTop, rows.length)} |`);
  }
  push('');
  push('> ① 释义空缺 = **卡片开天窗**，必须补或从包里剔除。');
  push('> ② 影响展示。 ③ **直接等于实时 TTS 的触发率与这个包的音频成本** —— §5.1「长尾词实时 TTS」的成本在这里第一次有数。');
  push('');

  // ---- 7. 对齐失败 ----
  push('## 7. 词元对齐失败清单 ⚠️');
  push('');
  push('| 词表 | 总数 | 未匹配 | 失败率 | 清单 |');
  push('|---|---|---|---|---|');
  for (const l of LISTS) {
    const total = (lists[l.id] || []).length;
    const miss = aligned.unmatchedCounts[l.id] ?? 0;
    if (!total) continue;
    push(`| ${l.name} | ${fmt(total)} | ${fmt(miss)} | ${pct(miss, total)} | \`reports/unmatched/${l.id}.txt\` |`);
  }
  push('');
  push('> ⚠️ **必须人工过目，不允许静默丢弃**（`design.md` §21.1 风险清单）。');
  push('> 按表分开报，合并报会把 GRE 的高失败率掩盖在 CET4 的低失败率里。');
  push('> **人工过完这份清单才算 P1 收尾**（`design.md` §21.1「词元对齐失败被静默吞掉」）。');
  push('');

  // ---- 结论 ----
  push('---');
  push('');
  push('## 结论与待办');
  push('');
  const todos = [];
  for (const e of EXAM_TAGS.filter((x) => x.pack)) {
    const rows = byTag(e.tag); if (!rows.length) continue;
    if (rows.filter((r) => !r.f).length / rows.length > 0.5) todos.push(`\`${e.tag}\` 的 frq 缺值率过半 → 投放排序需单独设计`);
    const days = Math.ceil((exam[e.tag]?.net || 0) / DAILY_GOAL);
    if (days > 200) todos.push(`\`${e.tag}\` 净增 ${fmt(exam[e.tag].net)} 词 = ${days} 天 → UI 文案口径待定`);
    if (rows.filter((r) => !r.tr).length / rows.length > 0.05) todos.push(`\`${e.tag}\` 释义空缺 >5% → 补齐或剔除`);
  }
  for (const l of LISTS) {
    const total = (lists[l.id] || []).length;
    const miss = aligned.unmatchedCounts[l.id] ?? 0;
    if (total && miss / total > 0.05) todos.push(`${l.name} 对齐失败率 ${pct(miss, total)} → 人工过 \`unmatched/${l.id}.txt\``);
  }
  todos.push('ECDICT 无 uk/us 双音标 → 决定是否由 TTS 侧补 `phonetic_uk` / `phonetic_us`');
  if (todos.length) { for (const t of todos) push(`- [ ] ${t}`); } else push('- 无阻塞项。');
  push('');

  writeFileSync(join(PATHS.reports, 'pack-stats.md'), L.join('\n'));
  writeJson(join(PATHS.reports, 'pack-stats.json'), J);
  ok('reports/pack-stats.md · reports/pack-stats.json');
  log(`待办 ${todos.length} 项，见报告末尾`);
}
