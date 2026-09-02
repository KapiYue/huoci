// 频段切分。《词包与冷启动方案》§4 第 2 层：把底座按 frq 重排后切成 6 段。
export const BAND_COUNT = 6;

/** ECDICT 的 frq/bnc 是排名，越小越常见；0 或空表示缺值 → 排到最后 */
export function rankOf(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/**
 * 按 frq 升序切成等量的 N 段，返回 spelling -> band(1..N)
 * @param {{spelling:string, frq:number}[]} items
 */
export function assignBands(items, bandCount = BAND_COUNT) {
  const sorted = [...items].sort((a, b) => {
    if (a.frq !== b.frq) return a.frq - b.frq;
    return a.spelling.localeCompare(b.spelling); // 缺值段内保持确定性，避免每次跑结果不同
  });
  const map = new Map();
  const per = Math.ceil(sorted.length / bandCount);
  sorted.forEach((it, i) => map.set(it.spelling, Math.min(bandCount, Math.floor(i / per) + 1)));
  return map;
}

/** 频段直方图（报告 §7.1 第 5 项） */
export function histogram(bands, bandCount = BAND_COUNT) {
  const h = new Array(bandCount).fill(0);
  for (const b of bands) if (b >= 1 && b <= bandCount) h[b - 1]++;
  return h;
}
