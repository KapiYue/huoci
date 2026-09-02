import { PATHS, LISTS } from '../config.mjs';
import { exists, step, ok, fail, warn, log } from '../lib/io.mjs';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCES = {
  // Release 1.0.28 没有 csv 附件，只能从 sqlite 转。步骤见 README「ECDICT 怎么拿」
  ecdict: 'bash scripts/fetch-ecdict.sh   （下 sqlite 包再转 csv，约 1GB 中间文件）',
  // 五张表一律走 .com；.org 已是停放页，BSL 页面被插了外链且版本陈旧
  ngsl:   'bash scripts/fetch-lists.sh && python3 scripts/make-lists.py',
  bsl:    'bash scripts/fetch-lists.sh && python3 scripts/make-lists.py',
  tsl:    'bash scripts/fetch-lists.sh && python3 scripts/make-lists.py',
  nawl:   'bash scripts/fetch-lists.sh && python3 scripts/make-lists.py',
  spoken: 'bash scripts/fetch-lists.sh && python3 scripts/make-lists.py',
};

export function doctor() {
  step('输入检查');
  let missing = 0;

  if (exists(PATHS.ecdict)) {
    const mb = (statSync(PATHS.ecdict).size / 1048576).toFixed(1);
    ok(`ecdict.csv  ${mb} MB`);
  } else { fail('data/ecdict.csv  缺失 →', SOURCES.ecdict); missing++; }

  for (const l of LISTS) {
    const f = join(PATHS.lists, l.file);
    if (exists(f)) ok(`lists/${l.file}`);
    else { fail(`lists/${l.file}  缺失 →`, SOURCES[l.id]); missing++; }
  }

  console.log('');
  if (missing) {
    warn(`${missing} 个输入缺失。`);
    log('五张词表原件是 CSV（headword,词形1,词形2,...），取第一列即 lemma。');
    log('fetch-lists.sh 只按固定文件名取原件；make-lists.py 负责转换，不解析网页。');
    log('官网表格结构会变——若 fetch 拿到 404，先去 README 里的页面确认文件名。');
    log('');
    log('想先验证管线跑不跑得通，不必等真实数据：');
    log('  node src/cli.mjs demo      # 生成合成样本数据并跑完整条管线');
  } else {
    ok('输入齐全，可以 node src/cli.mjs all');
  }
  return missing === 0;
}
