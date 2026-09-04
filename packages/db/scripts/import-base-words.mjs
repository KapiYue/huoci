#!/usr/bin/env node
// 把 packs/base-full.json 灌进 hc_base_words。dev-todo T2。
//
//   node packages/db/scripts/import-base-words.mjs [--dry]
//
// 前置：
//   1. `202609020005_hc_save_onboarding.sql` 已在 Supabase 执行（表得先存在）
//   2. `cd tools/dict-builder && node src/cli.mjs base-meanings` 已产出 packs/base-full.json
//   3. 环境变量 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY
//
// ⚠️ **用 service_role 直连 Supabase，不走网关。** 这是一次性的运维动作，
// 不是产品流量：走网关只会给 nginx 和 Flask 平白压 4,500 行的批量写。
// 也正因为拿的是 service_role，这个脚本**只在你自己的机器上跑**，别塞进任何 CI。
//
// 幂等：走 PostgREST 的 upsert（Prefer: resolution=merge-duplicates），
// 重复跑只会覆盖同一批行，不会长出重复。词表更新了直接重跑。

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, '../../../tools/dict-builder/packs/base-full.json');

// PostgREST 单请求别塞太大：4,500 行一次约 400KB，多数网关的 body 上限在 1–2MB，
// 切成 500 一批既安全又能看见进度。
const BATCH = 500;

function env(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ 缺少环境变量 ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const pack = JSON.parse(readFileSync(PACK, 'utf8'));
  if (!Array.isArray(pack.words) || pack.words.length === 0) {
    console.error('✗ base-full.json 是空的，先跑 `node src/cli.mjs base-meanings`');
    process.exit(1);
  }

  const rows = pack.words.map(([spelling, band, bits, frq, phonetic, meaning]) => ({
    spelling: String(spelling).toLowerCase(),
    band,
    source_bits: bits,
    frq_rank: frq,
    phonetic: phonetic || null,
    primary_meaning: meaning || null,
  }));

  console.log(`读到 ${rows.length} 行（${pack.name}，version ${pack.version}）`);
  if (dry) {
    console.log('--dry：只看不写。前 3 行 ——');
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    return;
  }

  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await fetch(`${url}/rest/v1/hc_base_words`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error(`✗ 第 ${i / BATCH + 1} 批失败：${res.status} ${await res.text()}`);
      process.exit(1);
    }
    done += chunk.length;
    process.stdout.write(`\r  已写入 ${done} / ${rows.length}`);
  }
  console.log(`\n✓ 完成。抽查一下：select count(*), count(primary_meaning) from hc_base_words;`);
}

main().catch((e) => {
  console.error('\n✗ 失败：', e.message);
  process.exit(1);
});
