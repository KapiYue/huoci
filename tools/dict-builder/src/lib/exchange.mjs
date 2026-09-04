// ECDICT `exchange` 字段解析。
//
// 格式： p:过去式/d:过去分词/i:现在分词/3:三单/r:比较级/t:最高级/s:复数/0:原型/1:原型变换
// 例：  abandoned  ->  "0:abandon/1:p"
//       abandon    ->  "d:abandoned/p:abandoned/i:abandoning/3:abandons"
//
// ⚠️ 这是整条管线的核心：NGSL/BSL 是 **lemma 列表**，ECDICT 是 **词形表**。
//    `run` 必须覆盖 running / ran / runs，靠的就是这个字段。
//    对不上的必须进 unmatched 报告，不允许静默丢弃（`design.md` §13.1）。

export const INFLECTION_KEYS = ['p', 'd', 'i', '3', 'r', 't', 's'];

/** @param {string} raw @returns {Record<string,string>} */
export function parseExchange(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of raw.split('/')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1).trim();
    if (v) out[k] = v;
  }
  return out;
}

/** 这个词形指向的原型；没有则返回 null（说明它自己可能就是原型） */
export function lemmaOf(raw) {
  const ex = parseExchange(raw);
  return ex['0'] || null;
}

/** 从一个原型展开它的所有变位形式 */
export function inflectionsOf(raw) {
  const ex = parseExchange(raw);
  const out = [];
  for (const k of INFLECTION_KEYS) {
    if (!ex[k]) continue;
    for (const w of ex[k].split(',')) {
      const t = w.trim();
      if (t) out.push(t);
    }
  }
  return out;
}
