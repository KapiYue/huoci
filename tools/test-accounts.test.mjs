import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedMetadata, isOwnedAccount, newCredentialState, parseEnv } from './test-accounts.mjs';

test('解析既有环境变量命名且不误吞注释', () => {
  assert.deepEqual(parseEnv("SUPABASE_URL='https://example.supabase.co'\n# x\nSUPABASE_SECRET_KEY=secret\n"), {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'secret',
  });
});

test('生成两个独立测试账号与随机强密码', () => {
  const state = newCredentialState(new Date('2026-09-11T00:00:00.000Z'));
  assert.equal(state.accounts.length, 2);
  assert.notEqual(state.accounts[0].email, state.accounts[1].email);
  assert.notEqual(state.accounts[0].password, state.accounts[1].password);
  for (const account of state.accounts) {
    assert.match(account.email, /^huoci-ab-[ab]-/);
    assert.ok(account.password.length >= 35);
    assert.match(account.password, /[a-z]/);
    assert.match(account.password, /[A-Z]/);
    assert.match(account.password, /\d/);
    assert.match(account.password, /!/);
  }
});

test('cleanup 所有权判据必须同时匹配 id、邮箱和 marker', () => {
  const state = newCredentialState();
  const account = { ...state.accounts[0], userId: 'user-a' };
  const user = { id: 'user-a', email: account.email, user_metadata: expectedMetadata(state, 'A') };
  assert.equal(isOwnedAccount(user, state, account), true);
  assert.equal(isOwnedAccount({ ...user, id: 'real-user' }, state, account), false);
  assert.equal(isOwnedAccount({ ...user, user_metadata: {} }, state, account), false);
  assert.equal(isOwnedAccount({ ...user, email: 'real@example.com' }, state, account), false);
});
