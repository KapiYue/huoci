import { P } from './lib/io.mjs';

export const PATHS = {
  ecdict:   P('data/ecdict.csv'),
  lists:    P('data/lists'),
  out:      P('out'),
  packs:    P('packs'),
  reports:  P('reports'),
  unmatched:P('reports/unmatched'),
};

// 五张 CC BY-SA 4.0 词表（《词包与冷启动方案》§2）
// 每个文件：纯文本，一行一个 lemma，# 开头为注释
export const LISTS = [
  { id: 'ngsl',   file: 'ngsl.txt',        name: '通用底座 NGSL',   base: true,  bit: 1 },
  { id: 'bsl',    file: 'bsl.txt',         name: '职场底座 BSL',    base: true,  bit: 2 },
  { id: 'tsl',    file: 'tsl.txt',         name: '托业职场 TSL',    base: false, bit: 4 },
  { id: 'nawl',   file: 'nawl.txt',        name: '学术论文 NAWL',   base: false, bit: 8 },
  { id: 'spoken', file: 'ngsl-spoken.txt', name: '商务口语 Spoken', base: false, bit: 16 },
];

// ECDICT tag → 应试包。zk/gk 是中高考，与目标人群无关：只统计，不成包。
// （《词包与冷启动方案》§5.2）
export const EXAM_TAGS = [
  { tag: 'cet4',  name: '四级 CET-4',  pack: true },
  { tag: 'cet6',  name: '六级 CET-6',  pack: true },
  { tag: 'ky',    name: '考研',        pack: true },
  { tag: 'ielts', name: '雅思 IELTS',  pack: true },
  { tag: 'toefl', name: '托福 TOEFL',  pack: true },
  { tag: 'gre',   name: 'GRE',         pack: true },
  { tag: 'zk',    name: '中考',        pack: false },
  { tag: 'gk',    name: '高考',        pack: false },
];

export const AUDIO_PREGEN_TOP = 20000; // Top N 预生成音频，之后走实时 TTS（《技术方案》§5.1）
export const DAILY_GOAL = 20;          // 《技术方案》§3.3，用于「可完成天数」

export const ATTRIBUTION = {
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  authors: 'Browne, C., Culligan, B. & Phillips, J.',
  note: '词表来自 ECDICT 聚合数据与 NGSL 系列，非官方考纲',
};
