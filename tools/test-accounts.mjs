#!/usr/bin/env node
/**
 * 创建/查看/清理仅供活词人工 A/B 复查的 Supabase 账号。
 *
 * 安全约束：
 * - 只使用既有 SUPABASE_URL / SUPABASE_SECRET_KEY 命名；管理员密钥绝不输出。
 * - 随机邮箱与强密码，不查找、覆盖或复用真实账号。
 * - cleanup 必须同时匹配 user id、邮箱和本脚本写入的双重 marker 才会删除。
 * - 凭据只写入 gitignored 的 .local/，目录 700、文件 600。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ENV_FILE = path.resolve(ROOT, '../cijing/.env');
const DEFAULT_CREDENTIAL_FILE = path.join(ROOT, '.local/huoci-test-accounts.json');
const CREATED_BY = 'huoci/tools/test-accounts.mjs';
const EMAIL_DOMAIN = 'huoci-test.joy-coder.cn';

export function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    const pairs = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']];
    if (value.length >= 2 && pairs.some(([a, b]) => value.startsWith(a) && value.endsWith(b))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function newCredentialState(now = new Date()) {
  const pairId = `${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(5).toString('hex')}`;
  const password = () => `${crypto.randomBytes(24).toString('base64url')}!aA7`;
  return {
    schemaVersion: 1,
    status: 'creating',
    createdBy: CREATED_BY,
    pairId,
    createdAt: now.toISOString(),
    accounts: [
      { role: 'A', email: `huoci-ab-a-${pairId}@${EMAIL_DOMAIN}`, password: password(), userId: null },
      { role: 'B', email: `huoci-ab-b-${pairId}@${EMAIL_DOMAIN}`, password: password(), userId: null },
    ],
  };
}

export function expectedMetadata(state, role) {
  return {
    display_name: `活词人工复查测试账号 ${role}`,
    huoci_test_account: true,
    huoci_test_pair_id: state.pairId,
    huoci_test_created_by: CREATED_BY,
  };
}

export function isOwnedAccount(user, state, account) {
  const metadata = user?.user_metadata ?? {};
  return Boolean(
    user?.id &&
    (!account.userId || user.id === account.userId) &&
    user.email?.toLowerCase() === account.email.toLowerCase() &&
    metadata.huoci_test_account === true &&
    metadata.huoci_test_pair_id === state.pairId &&
    metadata.huoci_test_created_by === CREATED_BY
  );
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function pathsFromArgs() {
  return {
    envFile: path.resolve(option('env-file') || DEFAULT_ENV_FILE),
    credentialFile: path.resolve(option('credential-file') || DEFAULT_CREDENTIAL_FILE),
  };
}

function readState(credentialFile) {
  if (!fs.existsSync(credentialFile)) throw new Error(`凭据文件不存在：${credentialFile}。请先运行 create。`);
  const mode = fs.statSync(credentialFile).mode & 0o777;
  if (mode !== 0o600) throw new Error(`凭据文件权限必须是 600，当前为 ${mode.toString(8)}：${credentialFile}`);
  const state = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  if (state?.createdBy !== CREATED_BY || !state?.pairId || state?.accounts?.length !== 2) {
    throw new Error('凭据文件不是本脚本生成的合法 A/B 账号记录，拒绝继续。');
  }
  return state;
}

function writeState(credentialFile, state) {
  fs.mkdirSync(path.dirname(credentialFile), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(credentialFile), 0o700);
  const tmp = `${credentialFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, credentialFile);
  fs.chmodSync(credentialFile, 0o600);
}

function config(envFile) {
  const file = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const baseURL = (process.env.SUPABASE_URL || file.SUPABASE_URL || '').replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY || file.SUPABASE_SECRET_KEY || '';
  if (!baseURL || !secretKey) {
    throw new Error(`缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY（默认读取 ${envFile}，也可用同名环境变量）。`);
  }
  return { baseURL, secretKey };
}

async function adminRequest(cfg, apiPath, { method = 'GET', body } = {}) {
  const response = await fetch(`${cfg.baseURL}${apiPath}`, {
    method,
    headers: {
      apikey: cfg.secretKey,
      Authorization: `Bearer ${cfg.secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${apiPath}: HTTP ${response.status} ${JSON.stringify(payload).slice(0, 400)}`);
  return payload;
}

async function findByEmail(cfg, email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const payload = await adminRequest(cfg, `/auth/v1/admin/users?page=${page}&per_page=1000`);
    const users = payload?.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === target);
    if (found) return found;
    if (users.length < 1000) return null;
  }
  throw new Error('管理员用户列表超过 20000 条，脚本停止，避免在不完整结果上做判断。');
}

async function createAccounts(cfg, credentialFile) {
  let state;
  if (fs.existsSync(credentialFile)) {
    state = readState(credentialFile);
    console.log(`检测到既有测试账号记录，将幂等核对：${credentialFile}`);
  } else {
    state = newCredentialState();
    writeState(credentialFile, state);
  }

  const createdThisRun = [];
  try {
    for (const account of state.accounts) {
      let user = await findByEmail(cfg, account.email);
      if (user) {
        if (!isOwnedAccount(user, state, account)) {
          throw new Error(`邮箱 ${account.email} 已存在但 marker/id 不匹配；拒绝覆盖或接管。`);
        }
      } else {
        if (account.userId) throw new Error(`记录中的账号 ${account.role}（${account.userId}）已不在服务器；请先人工核对，拒绝静默重建。`);
        user = await adminRequest(cfg, '/auth/v1/admin/users', {
          method: 'POST',
          body: {
            email: account.email,
            password: account.password,
            email_confirm: true,
            user_metadata: expectedMetadata(state, account.role),
          },
        });
        createdThisRun.push(user.id);
      }
      account.userId = user.id;
      writeState(credentialFile, state);
    }
    state.status = 'ready';
    writeState(credentialFile, state);
  } catch (error) {
    for (const userId of createdThisRun) {
      await adminRequest(cfg, `/auth/v1/admin/users/${userId}`, { method: 'DELETE' }).catch(() => {});
    }
    throw error;
  }

  console.log(`A/B 测试账号已就绪（pair=${state.pairId}）。`);
  console.log(`凭据已写入权限 600 的文件：${credentialFile}`);
  console.log('未输出密码或管理员密钥；需要人工登录时运行 show。');
}

async function cleanupAccounts(cfg, credentialFile) {
  const state = readState(credentialFile);
  const verified = [];
  for (const account of state.accounts) {
    const user = await findByEmail(cfg, account.email);
    if (!user) continue;
    if (!isOwnedAccount(user, state, account)) {
      throw new Error(`账号 ${account.role} 的 marker/id 不匹配；为保护真实账号，本次一个也不删除。`);
    }
    verified.push(user);
  }
  for (const user of verified) {
    await adminRequest(cfg, `/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  }
  fs.unlinkSync(credentialFile);
  console.log(`已删除 ${verified.length} 个由本脚本创建且 marker 完全匹配的账号。`);
  console.log('本机凭据文件已删除，无法从该文件恢复。');
}

function showCredentials(credentialFile) {
  const state = readState(credentialFile);
  if (!process.stdout.isTTY) {
    throw new Error('show 只允许在交互式终端显示，拒绝写入管道、日志或重定向文件。');
  }
  console.log(`活词人工复查测试账号（pair=${state.pairId}）`);
  for (const account of state.accounts) {
    console.log(`${account.role}: ${account.email}`);
    console.log(`   password: ${account.password}`);
  }
}

function dryRun() {
  const state = newCredentialState(new Date('2026-09-11T00:00:00.000Z'));
  console.log('dry-run：不会联网、不会写文件、不会创建或删除账号。');
  console.log(`将创建 2 个独立账号，domain=${EMAIL_DOMAIN}，pair marker=${state.pairId.split('-').slice(0, 2).join('-')}-<random>`);
  console.log('密码分别随机生成（至少 35 字符），凭据文件权限 600；cleanup 需 id + email + 双 marker 全匹配。');
}

async function main() {
  const command = process.argv[2];
  const { envFile, credentialFile } = pathsFromArgs();
  if (command === 'dry-run') return dryRun();
  if (command === 'show') return showCredentials(credentialFile);
  if (command === 'create') return createAccounts(config(envFile), credentialFile);
  if (command === 'cleanup') return cleanupAccounts(config(envFile), credentialFile);
  throw new Error('用法：node tools/test-accounts.mjs <dry-run|create|show|cleanup> [--env-file=PATH] [--credential-file=PATH]');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`失败：${error.message}`);
    process.exitCode = 1;
  });
}
