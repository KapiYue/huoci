#!/usr/bin/env node
/**
 * 真实账号的账号关联验收快照工具。
 *
 * 只读：仅以 service role 查询两名由操作者明确提供 UUID 的汇总状态；不登录、
 * 不写库、不读取 token，也不打印学习内容。快照只保存在 gitignored 的 .local/ 且 0600。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './test-accounts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ENV_FILE = path.resolve(ROOT, '../cijing/.env');
const DEFAULT_OUTPUT = path.join(ROOT, '.local/account-link-acceptance.json');
const TABLES = ['words', 'word_contexts', 'review_events', 'daily_activity', 'reading_sessions', 'practice_attempts', 'voice_attempts', 'hc_profiles', 'hc_word_status'];

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
function required(name) {
  const value = option(name);
  if (!value) throw new Error(`缺少 --${name}=UUID`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`--${name} 不是 UUID；请从微信开发者工具控制台执行 wx.getStorageSync('hc.session').userId 后复制。`);
  }
  return value;
}
function config() {
  const envFile = path.resolve(option('env-file') || DEFAULT_ENV_FILE);
  const env = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const baseURL = (process.env.SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY || '';
  if (!baseURL || !secretKey) throw new Error(`缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY（默认读取 ${envFile}）。`);
  return { baseURL, secretKey };
}
async function rest(cfg, table, query, extraHeaders = {}) {
  const response = await fetch(`${cfg.baseURL}/rest/v1/${table}?${new URLSearchParams(query)}`, {
    headers: { apikey: cfg.secretKey, Authorization: `Bearer ${cfg.secretKey}`, ...extraHeaders },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  return { body, headers: response.headers };
}
async function count(cfg, table, userId) {
  const { headers } = await rest(cfg, table, { select: 'user_id', user_id: `eq.${userId}`, limit: '1' }, { Prefer: 'count=exact' });
  const total = headers.get('content-range')?.split('/').at(-1);
  if (!total || total === '*') throw new Error(`${table}: 服务未返回精确总数。`);
  return Number(total);
}
async function wordDigest(cfg, userId) {
  const terms = [];
  for (let start = 0; ; start += 1000) {
    const { body } = await rest(cfg, 'words', { select: 'normalized_term', user_id: `eq.${userId}`, order: 'normalized_term.asc' }, {
      Range: `${start}-${start + 999}`,
      'Range-Unit': 'items',
    });
    if (!Array.isArray(body)) throw new Error('words: 返回体异常。');
    terms.push(...body.map((row) => String(row.normalized_term)));
    if (body.length < 1000) break;
  }
  return crypto.createHash('sha256').update(terms.join('\n')).digest('hex');
}
async function accountSnapshot(cfg, userId) {
  const totals = Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await count(cfg, table, userId)])));
  return { totals, wordSetSha256: await wordDigest(cfg, userId) };
}
async function capture() {
  const stage = option('stage');
  if (!stage || !/^[a-z0-9-]{3,48}$/i.test(stage)) throw new Error('请使用简短的 --stage=名称，例如 g1-before。');
  const cfg = config();
  const wechatUserId = required('wechat-user-id');
  const cijingUserId = required('cijing-user-id');
  if (wechatUserId === cijingUserId) throw new Error('两个 UUID 不能相同。');
  const output = path.resolve(option('output') || DEFAULT_OUTPUT);
  // 账号角色不能只靠操作者记忆：微信独立账号必须拥有微信身份映射。若恰好把两个
  // UUID 对调，下面的快照仍能计算，却会把“谁的数据独立”解释反，直接拒绝更安全。
  const { body: wechatIdentities } = await rest(cfg, 'hc_wechat_identities', {
    select: 'user_id', user_id: `eq.${wechatUserId}`, limit: '1',
  });
  const { body: cijingIdentities } = await rest(cfg, 'hc_wechat_identities', {
    select: 'user_id', user_id: `eq.${cijingUserId}`, limit: '1',
  });
  if (!Array.isArray(wechatIdentities) || wechatIdentities.length === 0) {
    const reversed = Array.isArray(cijingIdentities) && cijingIdentities.length > 0;
    throw new Error(reversed
      ? '两个 UUID 的角色填反了：带微信身份映射的是 --cijing-user-id，请交换两个参数后重新抓取快照。'
      : '--wechat-user-id 没有微信身份映射；请在小程序控制台重新读取微信独立账号的 hc.session.userId。');
  }
  const { body: links } = await rest(cfg, 'hc_account_links', { select: 'wechat_user_id,cijing_user_id', wechat_user_id: `eq.${wechatUserId}` });
  const { body: locks } = await rest(cfg, 'hc_account_data_locks', { select: 'user_id', user_id: `in.(${wechatUserId},${cijingUserId})`, expires_at: `gt.${new Date().toISOString()}` });
  const snapshot = {
    takenAt: new Date().toISOString(),
    wechatUserId,
    cijingUserId,
    linkedToSpecifiedCijing: Array.isArray(links) && links.some((row) => row.cijing_user_id === cijingUserId),
    activeLockCount: Array.isArray(locks) ? locks.length : 0,
    wechat: await accountSnapshot(cfg, wechatUserId),
    cijing: await accountSnapshot(cfg, cijingUserId),
  };
  let state = { schemaVersion: 1, snapshots: {} };
  if (fs.existsSync(output)) state = JSON.parse(fs.readFileSync(output, 'utf8'));
  if (state.snapshots && Object.keys(state.snapshots).length) {
    const first = Object.values(state.snapshots)[0];
    if (first.wechatUserId !== wechatUserId || first.cijingUserId !== cijingUserId) throw new Error('输出文件已属于另一对账号；请指定新的 --output 路径。');
  }
  state.snapshots[stage] = snapshot;
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(output), 0o700);
  fs.writeFileSync(output, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(output, 0o600);
  console.log(`已保存只读快照：${stage}`);
  console.log(`关联=${snapshot.linkedToSpecifiedCijing ? '是' : '否'}；活动锁=${snapshot.activeLockCount}；结果文件=${output}`);
}
function changed(a, b, account) { return a[account].wordSetSha256 !== b[account].wordSetSha256; }
function verdict(ok, text) { console.log(`${ok ? 'PASS' : 'CHECK'}  ${text}`); return ok; }
function report() {
  const output = path.resolve(option('output') || DEFAULT_OUTPUT);
  if (!fs.existsSync(output)) throw new Error(`找不到快照文件：${output}`);
  const snapshots = JSON.parse(fs.readFileSync(output, 'utf8')).snapshots || {};
  const get = (name) => snapshots[name];
  console.log('只读验收报告（不会显示词条或凭据）');
  const g1a = get('g1-before'), g1b = get('g1-after');
  if (g1a && g1b) {
    verdict(!g1a.linkedToSpecifiedCijing && !g1b.linkedToSpecifiedCijing, '组一：两次均不存在关联关系');
    verdict(changed(g1a, g1b, 'wechat') && changed(g1a, g1b, 'cijing'), '组一：两边各自的词集合均发生预期变化');
    verdict(g1b.activeLockCount === 0, '组一：无遗留活动写锁');
  } else console.log('组一待完成：需要 g1-before 和 g1-after。');
  const before = get('g2-before-link'), afterLink = get('g2-after-link'), beforeUnlink = get('g2-before-unlink'), afterUnlink = get('g2-after-unlink'), independent = get('g2-after-independent');
  if (before && afterLink && beforeUnlink && afterUnlink) {
    verdict(!before.linkedToSpecifiedCijing && afterLink.linkedToSpecifiedCijing && beforeUnlink.linkedToSpecifiedCijing && !afterUnlink.linkedToSpecifiedCijing, '组二：关联状态依次为 未关联 → 已关联 → 已关联 → 已解绑');
    verdict(afterUnlink.wechat.wordSetSha256 === afterUnlink.cijing.wordSetSha256, '组二：解绑瞬间微信副本与词鲸账号词集合一致');
    verdict(afterUnlink.activeLockCount === 0, '组二：解绑后无遗留活动写锁');
    if (independent) {
      verdict(changed(afterUnlink, independent, 'wechat') && changed(afterUnlink, independent, 'cijing') && independent.wechat.wordSetSha256 !== independent.cijing.wordSetSha256, '组二：解绑后双方各自写入不同测试词，数据已再次独立');
    } else console.log('组二最后一步待完成：需要 g2-after-independent。');
  } else console.log('组二待完成：需要 g2-before-link、g2-after-link、g2-before-unlink、g2-after-unlink。');
}
function usage() {
  console.log("用法：node tools/account-link-acceptance.mjs <capture|report> [--stage=...] [--wechat-user-id=UUID] [--cijing-user-id=UUID] [--env-file=PATH] [--output=PATH]");
}
const command = process.argv[2];
Promise.resolve(command === 'capture' ? capture() : command === 'report' ? report() : usage()).catch((error) => {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
});
