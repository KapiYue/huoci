import { PATHS, LISTS } from '../config.mjs';
import { exists, writeJson, P, step, ok, warn, log, fmt } from '../lib/io.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadLists() {
  step('02 · 载入五张 CC BY-SA 词表');
  const out = {};
  for (const l of LISTS) {
    const f = join(PATHS.lists, l.file);
    if (!exists(f)) { warn(`${l.file} 缺失，跳过（该包本次不产出）`); out[l.id] = []; continue; }
    const words = readFileSync(f, 'utf8').split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && !s.startsWith('#'));
    out[l.id] = [...new Set(words)];
    log(`${l.name.padEnd(18)} ${fmt(out[l.id].length)} lemma`);
  }
  const baseSet = new Set();
  for (const l of LISTS) if (l.base) for (const w of out[l.id]) baseSet.add(w);
  log(`底座（NGSL ∪ BSL）去重后 ${fmt(baseSet.size)} lemma`);
  writeJson(P('out/lists.json'), { lists: out, base: [...baseSet] });
  ok('out/lists.json');
  return out;
}
