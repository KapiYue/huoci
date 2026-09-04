#!/usr/bin/env node
// 活词 P1 词典管线 CLI。零依赖，Node >= 20 直接跑。
import { doctor } from './steps/00-doctor.mjs';
import { ingestEcdict } from './steps/01-ingest-ecdict.mjs';
import { loadLists } from './steps/02-load-lists.mjs';
import { alignLemma } from './steps/03-align-lemma.mjs';
import { buildPacks } from './steps/04-build-packs.mjs';
import { report } from './steps/05-report.mjs';
import { baseMeanings } from './steps/06-base-meanings.mjs';
import { makeFixture } from './steps/demo-fixture.mjs';
import { ensureDirSelf } from './lib/io.mjs';
import { PATHS } from './config.mjs';

const HELP = `
活词 · dict-builder（P1 词典管线）

  node src/cli.mjs <command>

  doctor     检查输入是否齐全，缺什么就告诉你去哪拿
  demo       生成合成样本数据并跑完整条管线（不需要真实 ECDICT）
  ingest     01 清洗导入 ECDICT
  lists      02 载入五张 CC BY-SA 词表
  align      03 词元对齐（⚠️ 主要风险步骤）
  packs      04 产出词包
  report     05 统计报告
  all        01 → 05 全跑

  base-meanings  06 给底座词补音标+释义，产出 packs/base-full.json（服务端用，**不进 all**）
                 灌库脚本见 packages/db/scripts/import-base-words.mjs

产出：
  packs/base.json            主包，NGSL ∪ BSL，只存 拼写 + 频段 + 来源位
  packs/base-full.json       服务端用，额外带音标与释义，**永不下发**（base-meanings 才产）
  packs/pro-*.json           分包 A：TSL / NAWL / Spoken
  packs/exam-*.json          分包 A：cet4 / cet6 / ky / ielts / toefl / gre
  reports/pack-stats.md      人看的统计报告（§7.1 八项）
  reports/pack-stats.json    机器读的同一份数据
  reports/unmatched/*.txt    ⚠️ 词元对齐失败清单，必须人工过目
`;

async function all() {
  for (const d of [PATHS.out, PATHS.packs, PATHS.reports, PATHS.unmatched]) ensureDirSelf(d);
  await ingestEcdict();
  loadLists();
  await alignLemma();
  await buildPacks();
  await report();
  console.log('\n\x1b[32m完成。\x1b[0m 下一步：人工过 reports/unmatched/*.txt，然后读 reports/pack-stats.md 末尾的待办。\n');
}

const cmd = process.argv[2];
try {
  switch (cmd) {
    case 'doctor': doctor(); break;
    case 'demo':   makeFixture(); await all(); break;
    case 'ingest': await ingestEcdict(); break;
    case 'lists':  loadLists(); break;
    case 'align':  await alignLemma(); break;
    case 'packs':  await buildPacks(); break;
    case 'report': await report(); break;
    case 'base-meanings': await baseMeanings(); break;
    case 'all':    if (!doctor()) process.exit(1); await all(); break;
    default: console.log(HELP);
  }
} catch (e) {
  console.error('\n\x1b[31m✗ 失败：\x1b[0m', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
}
