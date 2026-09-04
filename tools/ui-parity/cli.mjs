#!/usr/bin/env node
// 原型一致性对照。用法：
//   npm run parity            终端输出 + 写 tools/ui-parity/report.md，有 RED 就 exit 1
//   npm run parity -- --soft  同上但恒 exit 0（用于只想看报告的时候）

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChecks, ROOT } from './check.mjs';

const soft = process.argv.includes('--soft');
const { findings, screenRows } = runChecks();

const SEV = {
  RED: { icon: '🔴', label: '实现违反规格', order: 0 },
  PROTO: { icon: '🟡', label: '原型越界（实现不要抄）', order: 1 },
  SKIN: { icon: '🎨', label: 'UI 还原差异', order: 2 },
  DOC: { icon: '📎', label: '注释里的 §编号失效', order: 3 },
};

const count = (s) => findings.filter((f) => f.sev === s).length;
const sorted = [...findings].sort((a, b) => SEV[a.sev].order - SEV[b.sev].order || a.screen.localeCompare(b.screen));

// ── 终端 ────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
console.log(`${C.bold}活词 · 九屏还原对照${C.reset}  ${C.dim}规格 design.md §5 ↔ 原型 docs/prototype ↔ 小程序${C.reset}\n`);
console.log('屏   页面            规格        状态    🔴  🟡  🎨');
for (const r of screenRows) {
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (/[一-鿿·（）]/.test(c) ? 2 : 1), 0)));
  console.log(
    `${pad(r.id, 5)}${pad(r.name, 16)}${pad(r.ref, 12)}${pad(r.state, 8)}${String(r.red).padStart(2)}  ${String(r.proto).padStart(2)}  ${String(r.skin).padStart(2)}`
  );
}
console.log(
  `\n${C.red}🔴 ${count('RED')} 实现违反规格${C.reset}   ` +
  `${C.yellow}🟡 ${count('PROTO')} 原型越界${C.reset}   ` +
  `${C.cyan}🎨 ${count('SKIN')} UI 还原差异${C.reset}   ` +
  `${C.dim}📎 ${count('DOC')} §编号失效${C.reset}\n`
);

// ── report.md ───────────────────────────────────────────────
const L = [];
L.push('# 九屏还原对照报告');
L.push('');
L.push('> 由 `npm run parity` 生成，**不要手改**。判据在 `tools/ui-parity/spec.mjs`。');
L.push('>');
L.push('> **权威关系**：功能 / 结构 / 文案以 `design.md` §5 为准；视觉 / 效果以 `docs/prototype/` 为准。');
L.push('');
L.push(`生成时间：${new Date().toISOString().slice(0, 10)}`);
L.push('');
L.push('## 总览');
L.push('');
L.push('| 屏 | 页面 | 规格 | 状态 | 🔴 实现违规格 | 🟡 原型越界 | 🎨 UI 差异 |');
L.push('|---|---|---|---|---|---|---|');
for (const r of screenRows) L.push(`| ${r.id} | ${r.name} | \`${r.ref}\` | ${r.state} | ${r.red} | ${r.proto} | ${r.skin} |`);
L.push('');
L.push(`**合计**：🔴 ${count('RED')} · 🟡 ${count('PROTO')} · 🎨 ${count('SKIN')} · 📎 ${count('DOC')}`);
L.push('');

for (const sev of ['RED', 'PROTO', 'SKIN', 'DOC']) {
  const rows = sorted.filter((f) => f.sev === sev);
  if (!rows.length) continue;
  L.push(`## ${SEV[sev].icon} ${SEV[sev].label}（${rows.length}）`);
  L.push('');
  for (const f of rows) {
    L.push(`### ${f.screen} · ${f.title}`);
    L.push('');
    if (f.why) L.push(`**判据**：${f.why}`);
    if (f.detail) L.push(`\n\`\`\`\n${f.detail}\n\`\`\``);
    L.push('');
  }
}

const out = join(ROOT, 'tools/ui-parity/report.md');
writeFileSync(out, L.join('\n'));
console.log(`报告 → tools/ui-parity/report.md`);

process.exit(!soft && count('RED') > 0 ? 1 : 0);
