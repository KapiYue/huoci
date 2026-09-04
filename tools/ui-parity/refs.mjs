// 文档引用体检 —— 代码注释里的 §编号 还指得着 `design.md` 里的东西吗？
//
// 起因：09-02 三份旧文档合并成 `design.md` 时全文重编号（旧 §3.x → §8、§4.x → §9、
// §6.x → §5.4、§7 → §15、§14.1 → §12.1）。注释里那些编号不会自己跟着变，
// 变成一堆看起来还挺权威、点进去却是别的章节的引用 —— 比手写错还坏。
//
// 判据：代码里出现的每个 §编号，都必须在 `design.md` 里有对应标题。
// 例外：同一行里点了名的其它文档（`wordpacks-and-cold-start.md` §2.1 之类）不算。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCAN = ['packages', 'tools'];
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.wxml', '.wxss', '.sql', '.py', '.md'];
const SKIP = ['node_modules', '/dist/', '/shared/', 'dict-builder/reports', 'dict-builder/packs', 'ui-parity/report.md'];

/** design.md 里所有 `## 5.` / `### 5.3` 形式的标题编号，外加一级 `## 5.` 的 `5`。 */
export function designSections(designPath) {
  const ids = new Set();
  for (const line of readFileSync(designPath, 'utf8').split('\n')) {
    const m = line.match(/^#{2,4}\s+(?:`\[[^\]]*\]`\s+)?(\d+(?:\.\d+[a-z]?)*)[.\s]/);
    if (m) {
      ids.add(m[1]);
      // 「§9」这种只写大节的引用，只要该节存在就算有效
      ids.add(m[1].split('.')[0]);
    }
  }
  return ids;
}

export function checkRefs(root) {
  const designPath = join(root, 'docs/design.md');
  if (!existsSync(designPath)) return [];
  const valid = designSections(designPath);

  const stale = [];
  for (const dir of SCAN) {
    for (const file of walk(join(root, dir))) {
      const rel = file.replace(root, '');
      if (SKIP.some((s) => file.includes(s))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // 同一行点了别的文档的名字，这行的 § 归它管：
        //   `wordpacks-and-cold-start.md` §2.1 / 《词包与冷启动方案》§7.1 / 「报告 §0」
        if (/[a-z-]+\.md/.test(line) && !/design\.md/.test(line)) return;
        if (/《[^》]+》/.test(line)) return;
        if (/报告\s*§/.test(line)) return;
        for (const m of line.matchAll(/§\s?(\d+(?:\.\d+[a-z]?)*)/g)) {
          if (valid.has(m[1])) continue;
          stale.push({ file: rel, line: i + 1, ref: `§${m[1]}`, text: line.trim().slice(0, 110) });
        }
      });
    }
  }
  return stale;
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      out.push(...walk(p));
    } else if (EXTS.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
