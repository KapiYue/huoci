#!/usr/bin/env node
// 吉祥物逐像素核对稿生成器。用法：node tools/ui-parity/mascot-check.mjs
//
// 为什么要它：`components/mascot/` 是用 view + border-radius 把原型的 SVG「摆」出来的
// （小程序 image 对 SVG data-uri 的支持跨基础库不一致，不值得赌）。这种「同一形状两套
// 画法」没法靠比字符串验，只能并排看。
//
// 做法：把 mascot.wxss 按 1rpx = 0.5px 换算成等价 CSS（750rpx 设计宽 = 375pt，与小程序
// 换算一致），和从 CuteMascot.tsx 里原样抠出来的基准 SVG 并排放进一张 HTML。
// **生成而不是手抄** —— 手抄的换算稿在 wxss 改动后会静默过期，那比没有更坏。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = join(ROOT, 'tools/ui-parity/mascot-check.html');

const wxss = readFileSync(join(ROOT, 'packages/miniprogram/miniprogram/components/mascot/mascot.wxss'), 'utf8');
// 组件用了 --r-full 这类令牌，令牌定义在 page 选择器上；不一起搬进来，
// 圆角会静默退化成直角 —— 那就成了工具自己造出来的「差异」。
const tokens = readFileSync(join(ROOT, 'packages/miniprogram/miniprogram/styles/tokens.wxss'), 'utf8');
const wxml = readFileSync(join(ROOT, 'packages/miniprogram/miniprogram/components/mascot/mascot.wxml'), 'utf8');
const tsx = readFileSync(join(ROOT, 'docs/prototype/src/components/CuteMascot.tsx'), 'utf8');

/** 1rpx = 0.5px。同时丢掉小程序独有的选择器（:host / page）。 */
const rpx2px = (s) => s.replace(/(\d+(?:\.\d+)?)rpx/g, (_, n) => `${Number(n) * 0.5}px`);
const css = rpx2px(wxss).replace(/^\s*:host[^{]*\{[^}]*\}/gm, '');
// 只取亮色那一份令牌（page { … }），深色在 @media 里，核对形状用不上
const tokenCss = rpx2px((tokens.match(/^page\s*\{[\s\S]*?\n\}/m) || [''])[0]).replace(/^page/, ':root');

/** wxml → HTML：view/text 换成 div/span，去掉 wx: 指令与 {{}} 插值。 */
const html = wxml
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\swx:[a-z-]+="[^"]*"/g, '')
  .replace(/\s(?:bind|catch)[a-z:]+="[^"]*"/g, '')
  .replace(/\{\{[^}]*\}\}/g, '')
  .replace(/<view/g, '<div').replace(/<\/view>/g, '</div>')
  .replace(/<text/g, '<span').replace(/<\/text>/g, '</span>');

// React 的驼峰属性名 → SVG 属性名。逐条列而不是通配 camel→kebab：
// `linearGradient` 是**标签名**，通配会把它也拆成 linear-gradient，渐变整个失效。
const SVG_ATTRS = {
  stopColor: 'stop-color', stopOpacity: 'stop-opacity',
  strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin', strokeDasharray: 'stroke-dasharray',
  fillOpacity: 'fill-opacity', fillRule: 'fill-rule', clipPath: 'clip-path',
};

/** 从 TSX 里抠出基准 SVG。 */
let svg = (tsx.match(/<svg[\s\S]*?<\/svg>/) || [''])[0]
  .replace(/\sclassName="[^"]*"/g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  // 只摘根 <svg> 上的 width/height（尺寸交给 CSS）；子元素的 width/height 是几何，摘了就没了
  .replace(/^<svg[^>]*>/, (t) => t.replace(/\s(?:width|height)="[^"]*"/g, ''));
for (const [from, to] of Object.entries(SVG_ATTRS)) svg = svg.replaceAll(`${from}=`, `${to}=`);

writeFileSync(OUT, `<meta charset="utf-8">
<title>活词吉祥物 · 换算稿 vs 原型 SVG</title>
<style>
  /* zoom 只为看清，不参与换算；两侧同倍数，所以差异是真差异 */
  body{zoom:4;margin:0;padding:40px;display:flex;gap:40px;
       background:linear-gradient(180deg,#e8eefd,#f1edfe 45%,#faf8ff);
       font-family:-apple-system,BlinkMacSystemFont,sans-serif}
  .col{text-align:center;width:120px}
  h3{font:600 13px sans-serif;color:#334155;margin:0 0 8px}
  p{font:400 7px/1.5 sans-serif;color:#64748b;margin:8px 0 0}
  .base svg{width:80px;height:80px}
  .bubble{display:none}          /* 气泡是文字容器，不参与形状核对 */
${tokenCss}
${css}
</style>
<div class="col"><h3>WXSS 换算稿（1rpx = 0.5px）</h3>${html}
  <p>components/mascot/mascot.wxss + styles/tokens.wxss（亮色）</p></div>
<div class="col base"><h3>原型 SVG（基准）</h3>${svg}
  <p>CuteMascot.tsx 里的 &lt;svg&gt;。<b>光晕不在 SVG 里</b> ——
  原型那圈是 SVG 外面一个 blur-xl 的 div，这一栏没有它，
  所以只比形状与配色，不比光晕强度。</p></div>
`);

console.log(`✓ tools/ui-parity/mascot-check.html —— 浏览器打开，两个形状应当重合`);
