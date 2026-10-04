// 三方比对的执行体。产出结构化 findings，渲染交给 cli.mjs。
//
// findings 的严重度，对应 `spec.mjs` 顶部的权威关系：
//   RED    实现没有满足 React 原型或四项硬约束 —— 必须改实现
//   SKIN   实现与原型在视觉/文案细节上不一致 —— 必须改实现（UI 还原）
//   DOC    注释里的 §编号在 design.md 里找不着 —— 引用失效

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractAll } from './extract.mjs';
import { SCREENS, RED_LINES, TABBAR, PROTO, IMPL } from './spec.mjs';
import { hexToTailwind } from './palette.mjs';
import { checkRefs } from './refs.mjs';

export const ROOT = new URL('../..', import.meta.url).pathname;
const abs = (p) => join(ROOT, p);

const finding = (sev, screen, title, detail, why = '') => ({ sev, screen, title, detail, why });

/** 页面是不是还只是个占位空壳 —— 有 .placeholder 类或渲染的正文只有一个 note 字段。 */
function isShell(wxmlPath) {
  if (!existsSync(wxmlPath)) return true;
  const src = readFileSync(wxmlPath, 'utf8');
  return /class="[^"]*placeholder/.test(src) && /\{\{\s*note\s*\}\}/.test(src);
}

function has(set, needle) {
  for (const s of set) if (s.includes(needle)) return true;
  return false;
}

/** mustNot 命中时，看看是不是落在白名单短语里（例如「不提供邮箱注册」里的「注册」）。 */
function hitsIgnoringAllow(set, needle, allow = []) {
  const out = [];
  for (const s of set) {
    if (!s.includes(needle)) continue;
    if (allow.some((a) => s.includes(a))) continue;
    out.push(s);
  }
  return out;
}

export function runChecks() {
  const findings = [];
  const screenRows = [];
  const groups = [];

  for (const sc of SCREENS) {
    const implFiles = sc.impl.map((f) => abs(f.startsWith('../') ? join(IMPL, f) : IMPL + f)).filter(existsSync);
    const protoFiles = sc.proto.map((f) => abs(PROTO + f)).filter(existsSync);

    const wxml = implFiles.find((f) => f.endsWith('.wxml'));
    const shell = !wxml || isShell(wxml);

    // must / mustNot 用「全量」集合（含 GitHub、CC BY-SA 4.0 这类纯英文文案）；
    // 「原型有、实现没有」的差集用「只含中文」集合，否则 Latin 噪声淹没结论。
    const implText = shell ? new Set() : extractAll(implFiles, false);
    const protoText = extractAll(protoFiles, false);
    const implCjk = shell ? new Set() : extractAll(implFiles, true);
    const protoCjk = extractAll(protoFiles, true);
    // 结构判据要看全部实现文件：防抖常量在 .ts 里，来源三列在 service 里，
    // 只扫 wxml 会把「代码里有、模板里没有」的事实误判成缺失。
    const implSrc = shell ? '' : implFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

    let redCount = 0;
    let protoCount = 0;
    let skinCount = 0;

    if (shell) {
      findings.push(
        finding('RED', sc.id, '页面尚未实现（空壳）',
          `${sc.impl[0]} 只有占位文案`,
          `${sc.ref} —— 九屏还原缺这一屏，MVP-1 的第 ① 条腿不成立`)
      );
      redCount++;
    } else {
      // 1) 规格要求的文案，实现里必须有
      for (const [text, why] of sc.must) {
        if (!has(implText, text)) {
          findings.push(finding('RED', sc.id, `缺文案「${text}」`, sc.impl.join(' / '), `${sc.ref}：${why}`));
          redCount++;
        }
      }
      // 2) 本屏禁止的文案
      for (const [text, why] of sc.mustNot) {
        const hits = hitsIgnoringAllow(implText, text, (sc.allowIn || {})[text] || []);
        if (hits.length) {
          findings.push(finding('RED', sc.id, `出现禁止文案「${text}」`, hits.join(' ⏐ '), `${sc.ref}：${why}`));
          redCount++;
        }
      }
      // 3) 结构判据
      for (const s of sc.shape || []) {
        if (!s.test(implSrc)) {
          findings.push(finding('RED', sc.id, '结构判据未通过', s.why, sc.ref));
          redCount++;
        }
      }
    }

    // 4) 视觉/文案还原的差集**推迟到分组之后**再算 —— 原型把 S0–S3 画在同一个
    //    OnboardingFlow.tsx 里，逐屏算会把同一批文案报三遍。
    groups.push({ sc, shell, implCjk, protoCjk });

    screenRows.push({
      id: sc.id, name: sc.name, ref: sc.ref,
      state: shell ? '空壳' : redCount === 0 ? '通过' : '不符',
      red: redCount, proto: protoCount, skin: 0,
    });
  }

  // ── 视觉/文案还原差异：共用同一批原型文件的屏合并成一组 ─────────
  const byProto = new Map();
  for (const g of groups) {
    if (g.shell) continue;
    const key = [...g.sc.proto].sort().join('+');
    if (!byProto.has(key)) byProto.set(key, []);
    byProto.get(key).push(g);
  }
  for (const [, gs] of byProto) {
    const ids = gs.map((g) => g.sc.id).join('/');
    const banned = new Set(gs.flatMap((g) => g.sc.mustNot.map(([t]) => t)));
    const impl = new Set(gs.flatMap((g) => [...g.implCjk]));
    const proto = new Set(gs.flatMap((g) => [...g.protoCjk]));
    const missing = [...proto].filter((s) => {
      if (s.length < 4 || s.length > 40) return false;        // 太短噪声大，太长多是整段说明
      if (/[([{]'|'\)|=>|\);$/.test(s)) return false;          // 漏进来的代码片段
      if ([...banned].some((b) => s.includes(b))) return false;
      if ([...impl].some((i) => i.includes(s) || s.includes(i))) return false;
      return true;
    });
    if (!missing.length) continue;
    findings.push(
      finding('SKIN', ids, `原型有、实现没有的文案 ${missing.length} 条`,
        missing.join('\n'),
        'React 原型是唯一 UI 标准；逐条补齐实现')
    );
    for (const g of gs) {
      const row = screenRows.find((r) => r.id === g.sc.id);
      if (row) row.skin = missing.length;
    }
  }

  // ── 全局：红线词 ─────────────────────────────────────────────
  const implAll = walk(abs(IMPL), ['.wxml', '.wxss', '.ts', '.json']).filter((f) => !f.includes('/shared/'));
  const protoAll = walk(abs(PROTO), ['.tsx']);
  for (const { word, why } of RED_LINES) {
    for (const [label, files, sev] of [['实现', implAll, 'RED']]) {
      const hits = [];
      for (const f of files) {
        const src = stripCommentsForRedline(f);
        if (src.includes(word)) hits.push(f.replace(ROOT, ''));
      }
      if (hits.length) {
        findings.push(finding(sev, '全局', `${label}出现红线词「${word}」`, hits.join(' ⏐ '), why));
      }
    }
  }

  // ── 全局：React 完整产品的五项 tabbar ──────────────────────
  const appJson = JSON.parse(readFileSync(abs(IMPL + 'app.json'), 'utf8'));
  const tabs = (appJson.tabBar?.list || []).map((t) => t.text);
  if (tabs.join('/') !== TABBAR.join('/')) {
    findings.push(finding('RED', '全局', 'tabbar 与 React 原型不一致', `实际 ${tabs.join(' / ')}`, `应为 ${TABBAR.join(' / ')}`));
  }

  // ── 全局：设计令牌能否追溯到原型 ─────────────────────────────
  findings.push(...checkTokens(protoAll));

  // ── 全局：注释里的 §编号还指得着 design.md 吗 ────────────────
  for (const r of checkRefs(ROOT)) {
    findings.push(finding('DOC', '全局', `${r.ref} 在 design.md 里不存在`, `${r.file}:${r.line}  ${r.text}`,
      '09-02 三份旧文档合并进 design.md 时全文重编号，注释里的编号不会自己跟着变'));
  }

  return { findings, screenRows };
}

/** 红线扫描要避开注释 —— 规格红线常被原样抄进注释里当提醒，那不是界面文案。 */
function stripCommentsForRedline(file) {
  const src = readFileSync(file, 'utf8');
  if (file.endsWith('.wxml')) return src.replace(/<!--[\s\S]*?-->/g, '');
  if (file.endsWith('.json')) return src;
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function checkTokens(protoFiles) {
  const out = [];
  const tokensPath = abs(IMPL + 'styles/tokens.wxss');
  if (!existsSync(tokensPath)) return out;

  const protoSrc = protoFiles.map((f) => readFileSync(f, 'utf8')).join('\n').toLowerCase();
  const tokens = readFileSync(tokensPath, 'utf8');

  const orphans = [];
  for (const m of tokens.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    const [, name, hex] = m;
    const h = hex.toLowerCase();
    if (protoSrc.includes(h)) continue;                       // 原型里写了字面 hex
    const classes = hexToTailwind(h);
    if (classes.some((c) => protoSrc.includes(c))) continue;  // 原型里用了对应的 Tailwind 类
    orphans.push(`${name}: ${hex}${classes.length ? `（= ${classes.join('/')}，但原型没用过）` : '（不是 Tailwind 取值）'}`);
  }
  if (orphans.length) {
    out.push(finding('SKIN', '全局', `tokens.wxss 有 ${orphans.length} 个色值追溯不到原型`,
      orphans.join(' ⏐ '),
      'tokens.wxss 自称「从原型的 Tailwind 类抽出，是原型配色的唯一事实来源」；追不到就说明这句话不成立'));
  }
  return out;
}

function walk(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
