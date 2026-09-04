#!/usr/bin/env node
// 把 tools/dict-builder/packs/base.json 同步进 miniprogram/assets/。
//
// 为什么要拷一份而不是直接引用：小程序的 miniprogramRoot 之外的文件打不进包。
// 和 sync-shared.mjs 同一个理由、同一个做法。
//
// ⚠️ **署名字段（license / licenseUrl / authors）必须原样带过来**，
// 「我的 → 开源许可」页要显示它们。NGSL/BSL 是 CC BY-SA 4.0，署名是许可证义务不是可选项。
//
// ⚠️ 这是 **T1 的临时形态**。T2 做完之后底座词表的权威来源是词鲸的全局只读表，
// 本地这份降级为离线兜底。见 docs/dev-todo.md。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../../tools/dict-builder/packs/base.json');
const DEST = resolve(here, '../miniprogram/assets/base-words.json');

const pack = JSON.parse(await readFile(SRC, 'utf8'));

const EXPECTED_SCHEMA = ['spelling', 'band(1-6)', 'sourceBits(1=NGSL,2=BSL)', 'frqRank(0=缺值)'];
if (JSON.stringify(pack.schema) !== JSON.stringify(EXPECTED_SCHEMA)) {
  console.error(
    `[sync-wordpack] ✗ base.json 的 schema 变了：\n  期望 ${JSON.stringify(EXPECTED_SCHEMA)}\n  实际 ${JSON.stringify(pack.schema)}\n` +
      `  packages/shared/src/onboarding.ts 的 BaseWordRow 要跟着改，否则会静默读错列。`
  );
  process.exit(1);
}
for (const k of ['license', 'licenseUrl', 'authors']) {
  if (!pack[k]) {
    console.error(`[sync-wordpack] ✗ base.json 缺少署名字段 ${k}。CC BY-SA 4.0 要求署名，不能发。`);
    process.exit(1);
  }
}

await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, JSON.stringify(pack), 'utf8');

const kb = (JSON.stringify(pack).length / 1024).toFixed(0);
console.log(`[sync-wordpack] base.json → miniprogram/assets/base-words.json  ${pack.count} 词  ${kb} KB`);
if (kb > 180) console.warn(`[sync-wordpack] ⚠️ ${kb}KB 偏大，主包有 2MB 上限，留意别再往里塞释义`);
