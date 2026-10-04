const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadGateway(session, refreshOutcome = 'success') {
  const filename = path.resolve(__dirname, '../miniprogram/services/gateway.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  let storedSession = session;
  const calls = [];
  const storage = {
    SK: { SESSION: 'session' },
    read: (_key, fallback) => storedSession ?? fallback,
    write: (_key, value) => { storedSession = value; },
    remove: () => { storedSession = null; },
  };
  class ApiError extends Error {
    constructor(kind, status, message, detail) {
      super(message); this.kind = kind; this.status = status; this.detail = detail;
    }
  }
  const wx = {
    request(options) {
      calls.push(options);
      setImmediate(() => {
        if (options.url.includes('/auth/v1/token')) {
          if (refreshOutcome === 'network') {
            options.fail({ errMsg: 'request:fail network down' });
            return;
          }
          if (refreshOutcome === 'invalid') {
            options.success({ statusCode: 400, data: { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' } });
            return;
          }
          if (refreshOutcome === 'server') {
            options.success({ statusCode: 503, data: { message: 'upstream temporarily unavailable' } });
            return;
          }
          options.success({
            statusCode: 200,
            data: {
              access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600,
              user: { id: 'user-1', email: 'test@example.com', user_metadata: {} },
            },
          });
          return;
        }
        options.success({ statusCode: 200, data: { ok: true } });
      });
    },
  };
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === './storage') return storage;
    if (request === './types') return { ApiError };
    if (request === '../config/env') {
      return { ENV: { GATEWAY_BASE_URL: 'https://gateway.test', SUPABASE_ANON_KEY: 'anon', DEBUG_TIMING: false } };
    }
    throw new Error(`unexpected import: ${request}`);
  };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: localRequire, wx, console, Date,
    Promise, Number, Error, setImmediate,
  }, { filename });
  return { gateway: module.exports, calls, getSession: () => storedSession };
}

test('过期 session 的并发请求在发送前只刷新一次', async () => {
  const h = loadGateway({
    accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1,
    userId: 'user-1', email: 'test@example.com', displayName: 'tester', avatarUrl: null, provider: 'password',
  });

  await Promise.all([
    h.gateway.request('/rest/v1/rpc/get_home_summary', { method: 'POST', body: {} }),
    h.gateway.request('/rest/v1/rpc/get_study_queue', { method: 'POST', body: {} }),
    h.gateway.request('/rest/v1/words?limit=3'),
  ]);

  const refreshCalls = h.calls.filter((call) => call.url.includes('/auth/v1/token'));
  const businessCalls = h.calls.filter((call) => !call.url.includes('/auth/v1/token'));
  assert.equal(refreshCalls.length, 1);
  assert.equal(businessCalls.length, 3);
  assert.ok(businessCalls.every((call) => call.header.Authorization === 'Bearer fresh-access'));
  assert.equal(h.getSession().accessToken, 'fresh-access');
});

test('刷新遇到临时网络错误时保留原 session，不把用户误登出', async () => {
  const original = {
    accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1,
    userId: 'user-1', email: 'test@example.com', displayName: 'tester', avatarUrl: null, provider: 'password',
  };
  const h = loadGateway(original, 'network');

  await assert.rejects(
    () => h.gateway.request('/rest/v1/words?limit=3'),
    (error) => error.kind === 'network' && error.status === 0,
  );
  assert.equal(h.getSession().refreshToken, 'old-refresh');
  assert.equal(h.getSession().accessToken, 'expired-access');
});

test('Supabase 明确认定 refresh token 无效时清除 session', async () => {
  const h = loadGateway({
    accessToken: 'expired-access', refreshToken: 'invalid-refresh', expiresAt: Date.now() - 1,
    userId: 'user-1', email: 'test@example.com', displayName: 'tester', avatarUrl: null, provider: 'password',
  }, 'invalid');

  await assert.rejects(
    () => h.gateway.request('/rest/v1/words?limit=3'),
    (error) => error.kind === 'unauthorized' && error.status === 401,
  );
  assert.equal(h.getSession(), null);
});

test('刷新遇到网关 5xx 时保留原 session', async () => {
  const h = loadGateway({
    accessToken: 'expired-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1,
    userId: 'user-1', email: 'test@example.com', displayName: 'tester', avatarUrl: null, provider: 'password',
  }, 'server');

  await assert.rejects(
    () => h.gateway.request('/rest/v1/words?limit=3'),
    (error) => error.kind === 'server' && error.status === 503,
  );
  assert.equal(h.getSession().refreshToken, 'old-refresh');
  assert.equal(h.getSession().accessToken, 'expired-access');
});
