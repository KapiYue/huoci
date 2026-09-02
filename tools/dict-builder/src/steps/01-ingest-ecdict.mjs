import { PATHS } from '../config.mjs';
import { readCsv } from '../lib/csv.mjs';
import { lemmaOf } from '../lib/exchange.mjs';
import { NdjsonWriter, writeJson, P, step, ok, log, warn, fmt, pct } from '../lib/io.mjs';
import { rankOf as _r } from '../lib/bands.mjs';

// ECDICT 列：word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
export async function ingestEcdict() {
  step('01 · 清洗并导入 ECDICT');

  const wordOut  = new NdjsonWriter(P('out/word-lite.ndjson'));
  const lemmaOut = new NdjsonWriter(P('out/lemma-map.ndjson'));
  const taggedOut= new NdjsonWriter(P('out/tagged.ndjson'));

  const stats = {
    rows: 0, malformed: 0, withPhonetic: 0, withTranslation: 0,
    withFrq: 0, withBnc: 0, withExchange0: 0, tagged: 0,
  };

  await readCsv(PATHS.ecdict, async (r) => {
    const spelling = (r.word || '').trim();
    // 清洗：去畸形条目（空词、含空格的词组、非 ASCII 主体）
    if (!spelling || /\s/.test(spelling) || !/^[a-zA-Z][a-zA-Z'.-]*$/.test(spelling)) {
      stats.malformed++; return;
    }
    stats.rows++;

    const phonetic = (r.phonetic || '').trim();
    const translation = (r.translation || '').trim();
    const tag = (r.tag || '').trim().split(/\s+/).filter(Boolean);
    const frq = _r(r.frq);
    const bnc = _r(r.bnc);
    const lem = lemmaOf(r.exchange);

    if (phonetic) stats.withPhonetic++;
    if (translation) stats.withTranslation++;
    if (Number.isFinite(frq)) stats.withFrq++;
    if (Number.isFinite(bnc)) stats.withBnc++;
    if (tag.length) stats.tagged++;
    if (lem) stats.withExchange0++;

    // word-lite：后续步骤唯一需要的字段，压到最小以便 3.4M 行也能反复流式扫
    // ⚠️ 三个 write 都要 await —— 不 await 就等于关掉背压，整份数据会先堆进内存
    await wordOut.write({
      w: spelling,
      f: Number.isFinite(frq) ? frq : 0,
      b: Number.isFinite(bnc) ? bnc : 0,
      t: tag,
      l: lem || '',
      ph: phonetic ? 1 : 0,
      tr: translation ? 1 : 0,
      ex: r.exchange || '',
    });

    if (lem) await lemmaOut.write({ variant: spelling, lemma: lem });
    if (tag.length) {
      await taggedOut.write({ w: spelling, t: tag, f: Number.isFinite(frq) ? frq : 0,
                        b: Number.isFinite(bnc) ? bnc : 0, l: lem || '',
                        ph: phonetic ? 1 : 0, tr: translation ? 1 : 0 });
    }
  });

  await Promise.all([wordOut.close(), lemmaOut.close(), taggedOut.close()]);

  log(`有效词条 ${fmt(stats.rows)}，剔除畸形 ${fmt(stats.malformed)}`);
  log(`带音标 ${pct(stats.withPhonetic, stats.rows)} · 带中文释义 ${pct(stats.withTranslation, stats.rows)}`);
  log(`带 frq ${pct(stats.withFrq, stats.rows)} · 带 bnc ${pct(stats.withBnc, stats.rows)}`);
  log(`可回溯原型（exchange 含 0:）${fmt(stats.withExchange0)} · 带应试 tag ${fmt(stats.tagged)}`);
  warn('ECDICT 只有一个 phonetic 字段，没有 uk/us 之分 —— 《技术方案》§2.1 的 phonetic_uk/phonetic_us 需要另找来源或由 TTS 侧补。已记入报告。');

  writeJson(P('out/ingest-stats.json'), stats);
  ok('out/word-lite.ndjson · out/lemma-map.ndjson · out/tagged.ndjson');
  return stats;
}
