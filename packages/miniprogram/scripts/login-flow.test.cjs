const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ loginError, storageFull = false, completed = true, malformed = false, initialStorage = [] } = {}) {
  const root = path.resolve(__dirname, '../miniprogram');
  const cache = new Map();
  const stored = new Map(initialStorage);
  const calls = [], logs = [], routes = [];
  let page;
  const wx = {
    getStorageSync: key => stored.get(key) ?? '',
    setStorageSync(key, value) { if (storageFull) throw new Error('storage full'); stored.set(key, value); },
    removeStorageSync: key => stored.delete(key),
    login(opts) {
      calls.push({ stage: 'wx_login', timeout: opts.timeout });
      if (loginError) opts.fail({ errMsg: loginError });
      else opts.success({ code: 'fixture-code' });
    },
    request(opts) {
      calls.push({ stage: 'request', url: opts.url, header: opts.header });
      let data;
      if (opts.url.endsWith('/wx/login')) data = malformed ? { session: {} } : { session: {
        access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600,
        user: { id: 'canonical-account', email: null },
      } };
      else if (opts.url.includes('/rest/v1/hc_profiles')) data = completed
        ? [{ user_id: 'canonical-account', onboarding_done_at: '2026-11-01' }]
        : [{ user_id: 'canonical-account', onboarding_done_at: null }];
      else data = { ok: true };
      opts.success({ statusCode: 200, data });
    },
    redirectTo: opts => routes.push(opts.url),
    reLaunch: opts => routes.push(opts.url),
    switchTab: opts => routes.push(opts.url),
    navigateBack: () => routes.push('back'),
  };
  function load(file) {
    const absolute = path.resolve(root, file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} }; cache.set(absolute, mod);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const req = name => {
      if (name.endsWith('/config/env')) return { ENV: { GATEWAY_BASE_URL: 'https://gateway.test', SUPABASE_ANON_KEY: 'fixture', DEBUG_TIMING: false } };
      if (name.endsWith('baseWords.generated')) return {};
      if (/services\/(tracker|learning|words|theme|privacy)$/.test(name)) return { track() {}, EMPTY_SUMMARY: {}, PRIVACY_SECTIONS: [] };
      return load(path.relative(root, path.resolve(path.dirname(absolute), name + '.ts')));
    };
    vm.runInNewContext(code, {
      module: mod, exports: mod.exports, require: req, wx,
      console: { warn: (...args) => logs.push(args.join(' ')), info() {} },
      Page: definition => { page = definition; }, Date, setTimeout, clearTimeout,
    }, { filename: absolute });
    return mod.exports;
  }
  const auth = load('services/auth.ts');
  const gateway = load('services/gateway.ts');
  const onboarding = load('services/onboarding.ts');
  load('pages/login/login.ts');
  page.data = { ...page.data, agreed: true };
  page.setData = data => Object.assign(page.data, data);
  return { auth, gateway, onboarding, page, stored, calls, logs, routes };
}

test('微信工具凭据缺失：保留明确提示，不发网关请求、不记录原文', async () => {
  const h = harness({ loginError: 'login:fail 需要重新登录,access_token missing [private-identity]' });
  await h.page.confirmWeChatLogin();
  assert.match(h.page.data.error, /开发者工具请重新登录/);
  assert.equal(h.page.data.loading, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].timeout, 15000);
  assert.equal(h.gateway.getSession(), null);
  assert.deepEqual(h.routes, []);
  assert.deepEqual(h.logs, ['[auth] wx_login wechat_auth_unavailable']);
});

test('微信取码超时与普通失败均不是已登录，也不被覆盖成密码错误', async () => {
  for (const reason of ['login:fail timeout', 'login:fail network unavailable']) {
    const h = harness({ loginError: reason });
    await h.page.confirmWeChatLogin();
    assert.match(h.page.data.error, /微信登录超时|未取得微信登录凭证/);
    assert.equal(h.gateway.getSession(), null);
    assert.equal(h.calls.length, 1);
  }
});

test('关联账号登录：保存可刷新会话，恢复服务端首启状态，进入今日并能鉴权读数据', async () => {
  const h = harness();
  await h.page.confirmWeChatLogin();
  assert.equal(h.gateway.getSession().userId, 'canonical-account');
  assert.equal(h.gateway.getSession().refreshToken, 'fixture-refresh');
  assert.deepEqual(h.routes, ['/pages/today/today']);
  assert.equal(h.onboarding.read(), null); // 未伪造新用户播种结果
  assert.equal(h.onboarding.guard(), false);
  await h.gateway.select('words?limit=1');
  assert.equal(h.calls.at(-1).header.Authorization, 'Bearer fixture-access');
  // 重新加载所有模块，仅保留持久化数据，仍维持登录态和首启完成状态。
  const reopened = harness({ initialStorage: h.stored });
  assert.equal(reopened.gateway.getSession().userId, 'canonical-account');
  assert.equal(reopened.onboarding.guard(), false);
  assert.deepEqual(reopened.routes, []);
  assert.equal(h.calls.filter(c => c.url?.includes('/rpc/hc_save_onboarding')).length, 0);
});

test('游客登录返回原现场前也恢复服务端首启完成状态', async () => {
  const h = harness(); h.page._backAfterLogin = true;
  await h.page.confirmWeChatLogin();
  assert.deepEqual(h.routes, ['back']);
  assert.equal(h.onboarding.guard(), false);
});

test('真正未完成首启的微信账号仍进入引导', async () => {
  const h = harness({ completed: false });
  await h.page.confirmWeChatLogin();
  assert.deepEqual(h.routes, ['/pages/onboarding/onboarding']);
});

test('存储失败与不完整会话不能假成功或跳转', async () => {
  for (const opts of [{ storageFull: true }, { malformed: true }]) {
    const h = harness(opts);
    await h.page.confirmWeChatLogin();
    assert.match(h.page.data.error, /无法保存|未返回完整会话/);
    assert.equal(h.gateway.getSession(), null);
    assert.deepEqual(h.routes, []);
  }
});

test('切换与退出账号清除首启完成标记，不串用关联账号状态', async () => {
  const h = harness();
  await h.page.confirmWeChatLogin();
  h.gateway.setSession({ ...h.gateway.getSession(), userId: 'other-account' });
  assert.equal(h.onboarding.isDone(), false);
  h.auth.logout();
  assert.equal(h.stored.has('hc.onboarding.completion'), false);
  assert.equal(h.onboarding.guard(), false);
});

test('邮箱登录按既有产品约定跳过首启，守卫不再把用户送回引导', () => {
  const h = harness();
  h.gateway.setSession({ userId: 'email-account', provider: 'password' });
  assert.equal(h.onboarding.guard(), false);
  assert.deepEqual(h.routes, []);
});
