#!/usr/bin/env node
// 把 packages/shared/src/*.ts 同步进 miniprogram/shared/。
//
// 为什么是「拷贝」而不是 npm 依赖：小程序的 miniprogramRoot 不允许引用根目录之外的文件，
// 而 devtools 的「构建 npm」对 workspace 的 file: 依赖不稳。拷贝 + 生成头 + 只读，
// 代价是必须跑本脚本，收益是任何一端都不会出现「改了 shared 忘了同步」的静默漂移
// —— typecheck 会先跑 sync，CI 里也一样。
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../shared/src');
const DEST = resolve(here, '../miniprogram/shared');

const BANNER = `// ⚠️ 本文件由 scripts/sync-shared.mjs 从 packages/shared/src 自动生成，**请勿直接编辑**。
// 要改就改 packages/shared/src/，然后跑 \`npm run sync:shared -w @huoci/miniprogram\`。
`;

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });

const files = (await readdir(SRC)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
for (const f of files) {
  let code = await readFile(join(SRC, f), 'utf8');
  // 小程序 TS 用 CommonJS + node 解析，去掉 ESM 的 .js 扩展名后缀
  code = code.replace(/(from\s+'\.\/[^']+)\.js'/g, "$1'");
  await writeFile(join(DEST, f), BANNER + code, 'utf8');
}
console.log(`[sync-shared] ${files.length} 个文件 → miniprogram/shared/：${files.join(', ')}`);
