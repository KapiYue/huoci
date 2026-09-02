// 生成合成样本数据，让整条管线在拿到真实 ECDICT 之前就能跑通并验证。
// ⚠️ 产出的词包是假的，只用于验证管线，不得进 P2。
import { PATHS, LISTS } from '../config.mjs';
import { ensureDirSelf, step, ok, log } from '../lib/io.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEMMAS = [
  'the','be','and','of','to','in','have','it','for','not','on','with','as','you','do','at','this','but','his','by',
  'implement','deploy','feature','commit','release','mitigate','retention','revenue','stakeholder','deliverable',
  'incident','rollback','downtime','throughput','latency','compliance','procurement','invoice','reconcile','forecast',
  'hypothesis','methodology','empirical','paradigm','coefficient','substantiate','delineate','ubiquitous','ephemeral','quintessential',
];
const INFL = {
  implement:{s:'implements',d:'implemented',p:'implemented',i:'implementing'},
  deploy:{s:'deploys',d:'deployed',p:'deployed',i:'deploying'},
  mitigate:{s:'mitigates',d:'mitigated',p:'mitigated',i:'mitigating'},
  commit:{s:'commits',d:'committed',p:'committed',i:'committing'},
  be:{s:'is',d:'been',p:'was',i:'being'},
};
const TAGS = ['cet4','cet6','ky','ielts','toefl','gre','zk','gk'];

const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';

export function makeFixture() {
  step('生成合成样本（demo）');
  ensureDirSelf(PATHS.lists);
  ensureDirSelf('data');

  const rows = [['word','phonetic','definition','translation','pos','collins','oxford','tag','bnc','frq','exchange','detail','audio']];
  let frq = 1;

  for (const w of LEMMAS) {
    const inf = INFL[w];
    const ex = inf ? Object.entries(inf).map(([k, v]) => `${k}:${v}`).join('/') : '';
    // 刻意制造缺口，让报告的「缺值率 / 空缺率」不是全 0：
    const hasPhon = frq % 7 !== 0;
    const hasTr   = frq % 11 !== 0;
    const hasFrq  = frq % 13 !== 0;   // GRE 段故意多缺
    const tag = frq > 20 ? [TAGS[frq % TAGS.length], TAGS[(frq + 3) % TAGS.length]].join(' ') : '';
    rows.push([w, hasPhon ? `/ˈ${w.slice(0,3)}/` : '', `def of ${w}`, hasTr ? `${w} 的中文释义，含，逗号` : '',
               'n:50/v:50', '3', '1', tag, String(frq * 3), hasFrq ? String(frq * 2) : '0', ex, '', '']);
    // 变位形式作为独立词形写入，带 0: 指回原型
    if (inf) for (const [k, v] of Object.entries(inf)) {
      rows.push([v, '', `${k} of ${w}`, '', '', '', '', tag, '0', '0', `0:${w}/1:${k}`, '', '']);
    }
    frq++;
  }
  // 几个 ECDICT 里查不到的词，用来验证 unmatched 报告不为空
  writeFileSync('data/ecdict.csv', rows.map((r) => r.map(esc).join(',')).join('\n') + '\n');
  log(`data/ecdict.csv  ${rows.length - 1} 行（含变位形式）`);

  const write = (f, arr) => writeFileSync(join(PATHS.lists, f), arr.join('\n') + '\n');
  write('ngsl.txt',        LEMMAS.slice(0, 20).concat(['nonexistentword1']));
  write('bsl.txt',         LEMMAS.slice(20, 30).concat(['nonexistentword2']));
  write('tsl.txt',         LEMMAS.slice(20, 26));
  write('nawl.txt',        LEMMAS.slice(30, 40).concat(['nonexistentword3']));
  write('ngsl-spoken.txt', LEMMAS.slice(0, 10));
  for (const l of LISTS) log(`data/lists/${l.file}`);
  ok('合成样本就绪');
}
