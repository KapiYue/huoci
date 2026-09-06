#!/usr/bin/env node
// 小程序静态检查。`npm run check -w @huoci/miniprogram`
//
// 它补的是 `tsc --noEmit` 管不到的那一半：**wxml 与 ts 之间没有类型系统**，
// 绑错一个方法名、写错一个 data 字段，编译器一声不吭，真机上就是「点了没反应」或者一片空白。
// 09-03 这一轮加了 6 个页面，正是靠它把「起不来」的范围从「代码」缩到「工程配置」。
//
// 查五件事：
//   ① 所有 json 能不能解析
//   ② wxml 里 bind*/catch* 绑的方法，ts 里存不存在
//   ③ wxml 里 {{变量}} 在不在 data（或 wx:for 的 item / 组件 properties）
//   ④ wxml 标签闭合
//   ⑤ app.json 里的页面四件套齐不齐、tabBar 项在不在 pages 里、组件注册了没
//   ⑥ 红线词（剥掉注释之后再查，否则满屏都是「不要加 X」的注释命中）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../miniprogram');
const problems = [];
const add = (f, m) => problems.push(`${f}: ${m}`);

/** wxml 里可以自闭合、不需要结束标签的内置组件 */
const SELF_CLOSING = new Set([
  'image', 'input', 'icon', 'import', 'include', 'wxs', 'progress', 'slot',
  'video', 'audio', 'camera', 'live-player', 'live-pusher', 'ad', 'open-data',
  'official-account', 'navigation-bar', 'page-meta', 'match-media',
  'switch', 'checkbox', 'radio', 'slider',
]);

const BUILTIN_TAGS = new Set([
  'view', 'text', 'button', 'input', 'textarea', 'image', 'scroll-view', 'swiper', 'swiper-item',
  'block', 'navigator', 'form', 'switch', 'slider', 'picker', 'picker-view', 'checkbox', 'radio',
  'checkbox-group', 'radio-group', 'label', 'icon', 'progress', 'rich-text', 'video', 'audio',
  'canvas', 'camera', 'map', 'web-view', 'movable-view', 'movable-area', 'cover-view', 'cover-image',
  'open-data', 'ad', 'official-account', 'editor', 'match-media', 'page-container', 'share-element',
  'page-meta', 'navigation-bar', 'slot', 'template', 'import', 'include', 'wxs', 'keyboard-accessory',
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f);

// ① json 合法性
for (const f of files.filter((f) => f.endsWith('.json'))) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    add(rel(f), `JSON 解析失败 — ${e.message}`);
  }
}

for (const w of files.filter((f) => f.endsWith('.wxml'))) {
  const wxml = fs.readFileSync(w, 'utf8');
  const noComment = wxml.replace(/<!--[\s\S]*?-->/g, '');
  const tsPath = w.replace(/\.wxml$/, '.ts');
  if (!fs.existsSync(tsPath)) {
    add(rel(w), '没有同名 .ts');
    continue;
  }
  const ts = fs.readFileSync(tsPath, 'utf8');

  // ② 事件处理函数
  for (const m of noComment.matchAll(/\b(?:bind|catch):?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g)) {
    const h = m[1].trim();
    if (!new RegExp(`(^|[\\s,{])(async\\s+)?${h}\\s*\\(`, 'm').test(ts)) {
      add(rel(w), `绑定了 ${h}(...)，但 ${path.basename(tsPath)} 里没有这个方法`);
    }
  }

  // ③ {{变量}}
  const declared = new Set(['item', 'index', 'true', 'false', 'null', 'undefined']);
  for (const m of noComment.matchAll(/wx:for-(?:item|index)\s*=\s*"([^"]+)"/g)) declared.add(m[1].trim());
  // 组件的 properties 也算已声明
  for (const m of ts.matchAll(/^\s{4}([a-zA-Z_$][\w$]*)\s*:\s*\{\s*type:/gm)) declared.add(m[1]);
  // data: { ... } 里的顶层字段
  const dataStart = ts.indexOf('data: {');
  if (dataStart >= 0) {
    let depth = 0;
    let end = -1;
    for (let i = dataStart + 6; i < ts.length; i++) {
      if (ts[i] === '{') depth++;
      else if (ts[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    for (const m of ts.slice(dataStart, end).matchAll(/^\s{4}([a-zA-Z_$][\w$]*)\s*:/gm)) declared.add(m[1]);
  }
  for (const m of noComment.matchAll(/\{\{([^}]*)\}\}/g)) {
    // 先把字符串字面量抠掉：'is-on' 里的 on 不是变量
    const expr = m[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    for (const id of expr.matchAll(/(^|[^.\w'"])([a-zA-Z_$][\w$]*)/g)) {
      const name = id[2];
      if (/^(true|false|null|undefined)$/.test(name)) continue;
      if (!declared.has(name)) add(rel(w), `{{${name}}} 在 data 里找不到（拼错或忘了初始化，会渲染成空）`);
    }
  }

  // ④ 标签闭合
  const stack = [];
  let tagErr = null;
  for (const m of noComment.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, , selfClose] = m;
    if (close) {
      const top = stack.pop();
      if (top !== tag) { tagErr = `</${tag}> 对不上，栈顶是 <${top ?? '空'}>`; break; }
    } else if (!selfClose && !SELF_CLOSING.has(tag)) {
      stack.push(tag);
    }
  }
  if (!tagErr && stack.length) tagErr = `有未闭合的标签：${stack.join(' > ')}`;
  if (tagErr) add(rel(w), tagErr);

  // ⑤ 自定义组件注册
  const jsonPath = w.replace(/\.wxml$/, '.json');
  if (fs.existsSync(jsonPath)) {
    let reg = [];
    try {
      reg = Object.keys(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).usingComponents ?? {});
    } catch { /* ① 已经报过了 */ }
    for (const m of noComment.matchAll(/<([a-z][a-z0-9-]*)\b/g)) {
      const tag = m[1];
      if (BUILTIN_TAGS.has(tag) || reg.includes(tag)) continue;
      add(rel(w), `用了 <${tag}>，但同名 json 的 usingComponents 里没注册`);
    }
  }
}

// ⑤ app.json
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
for (const p of app.pages) {
  for (const ext of ['wxml', 'ts', 'json', 'wxss']) {
    if (!fs.existsSync(path.join(ROOT, `${p}.${ext}`))) add('app.json', `${p}.${ext} 不存在`);
  }
}
for (const t of app.tabBar?.list ?? []) {
  if (!app.pages.includes(t.pagePath)) add('app.json', `tabBar 的 ${t.pagePath} 不在 pages 里`);
}
// ⚠️ 开了 lazyCodeLoading 之后，每个页面 json 都要有 usingComponents（可以是空对象），
//    缺了在部分基础库上会按「未声明组件」处理 —— 09-03 首启页正是栽在这里
if (app.lazyCodeLoading === 'requiredComponents') {
  for (const p of app.pages) {
    const jsonPath = path.join(ROOT, `${p}.json`);
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (!j.usingComponents) add(`${p}.json`, '开了 lazyCodeLoading，但没有 usingComponents 字段（空对象也要写）');
    } catch { /* 已报 */ }
  }
}

// 跳转目标存不存在
for (const f of files.filter((f) => f.endsWith('.ts'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/url:\s*[`'"]\/(pages\/[a-zA-Z0-9_/-]+)/g)) {
    if (!fs.existsSync(path.join(ROOT, `${m[1]}.ts`))) add(rel(f), `跳转到 /${m[1]}，但这个页面不存在`);
  }
}

// ⑥ 红线词。`design.md` §5.0 第 2/3 条 + §5.5：界面上不许出现这些字样。
//    ⚠️ **必须剥注释再查** —— 仓库里到处写着「不要加 X」，直接 grep 全是注释命中，
//    噪音大到没人看，等于没有这道检查。
const REDLINES = [
  ['加油', '课堂语气'],
  ['棒棒', '课堂语气'],
  ['打卡成功', '课堂语气'],
  ['等级', '不做等级/星级/段位'],
  ['星级', '不做等级/星级/段位'],
  ['段位', '不做等级/星级/段位'],
  ['英语水平测试', 'S2 不许有测评感'],
  ['数据同步', '伪命题，要做的是「绑定」'],
  ['立即开通', '不是工具口吻'],
  ['解锁全部功能', '不是工具口吻'],
];
/** 允许出现在正文里的例外：这两行是规格要求的纯文字 */
const REDLINE_ALLOW = [/词鲸 App（iOS）已上架 App Store/, /词鲸网页端与 Chrome 扩展已上线/];

/** 把 wxml 注释、ts 的 // 与 块注释 全部剥掉，只留真正会渲染/执行的部分 */
function stripComments(src, ext) {
  let out = src.replace(/<!--[\s\S]*?-->/g, '');
  if (ext === '.ts') {
    out = out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  return out;
}

for (const f of files.filter((f) => /\.(wxml|ts)$/.test(f))) {
  if (f.includes('/scripts/')) continue;
  const ext = path.extname(f);
  const body = stripComments(fs.readFileSync(f, 'utf8'), ext);
  body.split('\n').forEach((line, i) => {
    if (REDLINE_ALLOW.some((re) => re.test(line))) return;
    for (const [word, why] of REDLINES) {
      if (line.includes(word)) add(rel(f), `第 ${i + 1} 行出现红线词「${word}」（${why}）`);
    }
  });
}

if (problems.length === 0) {
  console.log('✅ 静态检查全过');
} else {
  console.log(`❌ ${problems.length} 处：\n`);
  problems.forEach((p) => console.log('  ' + p));
  process.exit(1);
}
