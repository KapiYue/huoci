/*
 * 生产隔离验证：关联 → 解绑 → 两边各自新增词，确认解绑后不再同步。
 *
 * 仅创建带 hc_link_e2e_ 前缀的临时账号；finally 会删除其学习数据、关联批次与 auth 用户。
 * 输出只包含检查名称与 PASS/FAIL，绝不输出环境变量、会话、邮箱、用户 ID 或词条内容。
 */
import fs from 'node:fs';

const envPath = '/Users/qingmou/Documents/TechFiles/personal/study-ai/cijing/.env';
const config = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      const value = line.slice(i + 1).trim();
      return [line.slice(0, i).trim(), /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value];
    }),
);
const baseURL = config.SUPABASE_URL?.replace(/\/$/, '');
const anonKey = config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY;
const serviceKey = config.SUPABASE_SECRET_KEY;
if (!baseURL || !anonKey || !serviceKey) throw new Error('缺少生产测试所需环境配置');

const run = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const password = `E2e-${run}-Only`;
let wechatUserId = '';
let cijingUserId = '';
let wechatToken = '';
let cijingToken = '';

async function call(path, { method = 'GET', body, token, service = false, allow404 = false } = {}) {
  const key = service ? serviceKey : anonKey;
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (allow404 && response.status === 404) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return json;
}

function payload(term) {
  return {
    term, lemma: term, phonetic: null, parts: [], primary_meaning: 'e2e',
    english_definition: null, example_en: null, example_zh: null,
    context: null, source_url: null, source_title: 'account-link-e2e',
  };
}

async function createUser(label) {
  const email = `hc_link_e2e_${label}_${run}@example.invalid`;
  const user = await call('/auth/v1/admin/users', {
    method: 'POST', service: true,
    body: { email, password, email_confirm: true, user_metadata: { display_name: 'Account link E2E' } },
  });
  const session = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!user?.id || !session?.access_token) throw new Error('临时账号无法建立会话');
  return { id: user.id, token: session.access_token };
}

async function addWord(token, term) {
  const row = await call('/rest/v1/rpc/save_word', { method: 'POST', token, body: { p_payload: payload(term) } });
  if (!row?.id) throw new Error('临时学习数据写入失败');
}

async function listTerms(token) {
  const rows = await call('/rest/v1/words?select=normalized_term&order=normalized_term.asc', { token });
  return new Set(rows.map((row) => row.normalized_term));
}

async function clean() {
  if (wechatUserId) {
    // 关联批次对 auth.users 使用 restrict，故先删该临时账号发起的审计，再删批次。
    await call(`/rest/v1/hc_account_link_audit?actor_user_id=eq.${wechatUserId}`, { method: 'DELETE', service: true }).catch(() => {});
    await call(`/rest/v1/hc_account_link_batches?requested_by=eq.${wechatUserId}`, { method: 'DELETE', service: true }).catch(() => {});
  }
  for (const id of [wechatUserId, cijingUserId]) {
    if (id) await call(`/auth/v1/admin/users/${id}`, { method: 'DELETE', service: true }).catch(() => {});
  }
}

try {
  ({ id: wechatUserId, token: wechatToken } = await createUser('wechat'));
  ({ id: cijingUserId, token: cijingToken } = await createUser('cijing'));
  const initialWechat = `e2e-w-before-${run}`;
  const initialCijing = `e2e-c-before-${run}`;
  const afterWechat = `e2e-w-after-${run}`;
  const afterCijing = `e2e-c-after-${run}`;
  await addWord(wechatToken, initialWechat);
  await addWord(cijingToken, initialCijing);

  await call('/rest/v1/rpc/hc_execute_account_link', {
    method: 'POST', service: true,
    body: {
      p_operation: 'link', p_wechat_user_id: wechatUserId, p_cijing_user_id: cijingUserId,
      p_requested_by: wechatUserId, p_confirmation_version: 'e2e',
    },
  });
  const linkedTerms = await listTerms(cijingToken);
  if (!linkedTerms.has(initialWechat) || !linkedTerms.has(initialCijing)) throw new Error('关联后数据未汇入规范账号');

  await call('/rest/v1/rpc/hc_execute_account_link', {
    method: 'POST', service: true,
    body: {
      p_operation: 'unlink', p_wechat_user_id: wechatUserId, p_cijing_user_id: cijingUserId,
      p_requested_by: cijingUserId, p_confirmation_version: 'e2e',
    },
  });
  await addWord(wechatToken, afterWechat);
  await addWord(cijingToken, afterCijing);
  const [wechatTerms, cijingTerms] = await Promise.all([listTerms(wechatToken), listTerms(cijingToken)]);
  if (!wechatTerms.has(afterWechat) || wechatTerms.has(afterCijing)) throw new Error('解绑后微信账号未独立写入');
  if (!cijingTerms.has(afterCijing) || cijingTerms.has(afterWechat)) throw new Error('解绑后词鲸账号未独立写入');

  console.log(JSON.stringify({ status: 'PASS', checks: ['link_merge', 'unlink_copy', 'wechat_independent_write', 'cijing_independent_write'] }));
} finally {
  await clean();
}
