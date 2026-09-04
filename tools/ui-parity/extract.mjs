// 文案抽取器 —— 把三种源码里「用户看得见的中文」抽成可比对的字符串集合。
//
// 为什么用正则而不是 AST：三种语法（TSX / WXML / TS）只需要同一件东西 —— 含 CJK 的
// 字面量。上 AST 要三套 parser，而这里的判据（出现 / 不出现）不需要精确到节点。
// 误差方向也是安全的：宁可多抽（人看一眼就能排掉），不可漏抽（漏抽 = 假绿）。

import { readFileSync } from 'node:fs';

const CJK = /[一-鿿]/;

// Tailwind / 工具类字符串长得像文案，必须排掉，否则 must 判据会在 className 里假绿。
const CLASSY = /(^|\s)(flex|grid|hidden|absolute|relative|rounded|shadow|border|opacity|transition|cursor|overflow|justify|items|space-[xy]|gap-\d|[wh]-\d|[wh]-full|[mp][tblrxy]?-\d|text-(xs|sm|base|lg|xl|\[)|bg-|from-|via-|to-|dark:)/;

/**
 * 把一串文本切成「候选文案」：按换行切，去空白。
 * onlyCjk=true 时只留含中文的 —— 用于「原型有、实现没有」的差集（Latin 噪声太多）。
 * onlyCjk=false 时含中文的和纯英文的都留（如 GitHub / CC BY-SA 4.0），但排掉 class 串。
 */
function harvest(raw, onlyCjk) {
  const out = new Set();
  for (const piece of raw.split(/\n+/)) {
    const s = piece.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (CJK.test(s)) { out.add(s); continue; }
    if (onlyCjk) continue;
    if (s.length < 2 || s.length > 60) continue;
    if (CLASSY.test(s)) continue;
    out.add(s);
  }
  return out;
}

/** 去掉注释 —— 注释里的中文不是界面文案，混进来会让「不得出现」类判据假红。 */
export function stripComments(src, kind) {
  if (kind === 'wxml') return src.replace(/<!--[\s\S]*?-->/g, '');
  // ts / tsx：先摘掉 /* */ 与 //，注意别误伤 URL 里的 //
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** TSX：JSX 文本节点 + 字符串字面量（含 placeholder / 数组里的提示语）。 */
export function extractTsx(file, onlyCjk = true) {
  const src = stripComments(readFileSync(file, 'utf8'), 'tsx');
  const found = new Set();

  // 1) JSX 文本节点：>...< 之间，剔除 {表达式} 与标签
  for (const m of src.matchAll(/>([^<>{}]+)</g)) {
    for (const s of harvest(m[1], onlyCjk)) found.add(s);
  }
  // 2) 字符串字面量（单/双引号、模板串）
  for (const m of src.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)) {
    for (const s of harvest(m[1] ?? m[2] ?? m[3] ?? '', onlyCjk)) found.add(s);
  }
  return found;
}

/** WXML：标签间文本 + placeholder 属性 + {{ }} 里的字符串字面量（三元的两个分支）。 */
export function extractWxml(file, onlyCjk = true) {
  const src = stripComments(readFileSync(file, 'utf8'), 'wxml');
  const found = new Set();

  for (const m of src.matchAll(/>([^<>]+)</g)) {
    // 先把 {{...}} 里的字面量单独抽出来，再把整段 {{}} 抹掉
    for (const q of (m[1].match(/\{\{[\s\S]*?\}\}/g) || [])) {
      for (const lit of q.matchAll(/'([^']*)'|"([^"]*)"/g)) {
        for (const s of harvest(lit[1] ?? lit[2] ?? '', onlyCjk)) found.add(s);
      }
    }
    for (const s of harvest(m[1].replace(/\{\{[\s\S]*?\}\}/g, ' '), onlyCjk)) found.add(s);
  }
  for (const m of src.matchAll(/(?:placeholder|title|confirm-text|cancel-text)="([^"]*)"/g)) {
    for (const s of harvest(m[1], onlyCjk)) found.add(s);
  }
  return found;
}

/** 页面 .ts：只要含中文的字符串字面量（toast / 错误文案 / data 里的默认值）。 */
export function extractTs(file, onlyCjk = true) {
  const src = stripComments(readFileSync(file, 'utf8'), 'ts');
  const found = new Set();
  for (const m of src.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)) {
    for (const s of harvest(m[1] ?? m[2] ?? m[3] ?? '', onlyCjk)) found.add(s);
  }
  return found;
}

export function extractAny(file, onlyCjk = true) {
  if (file.endsWith('.wxml')) return extractWxml(file, onlyCjk);
  if (file.endsWith('.tsx')) return extractTsx(file, onlyCjk);
  return extractTs(file, onlyCjk);
}

/** 合并多个文件的抽取结果。 */
export function extractAll(files, onlyCjk = true) {
  const all = new Set();
  for (const f of files) for (const s of extractAny(f, onlyCjk)) all.add(s);
  return all;
}
