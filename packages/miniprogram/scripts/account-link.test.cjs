const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function functionBody(source, name, declaration = `export async function ${name}`) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `缺少 ${name}`);
  const open = source.indexOf('{', start + declaration.length);
  assert.notEqual(open, -1, `${name} 缺少函数体`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} 函数体未闭合`);
}

test('普通词鲸邮箱登录不会调用旧版微信映射补齐', () => {
  const auth = read('services/auth.ts');
  const login = functionBody(auth, 'loginWithPassword');
  assert.doesNotMatch(login, /attachOpenid\s*\(/);
  assert.match(login, /saveSession\(session\)/);
});
test('关联失败显示网关提供的脱敏原因，而不一概归为密码错误', () => {
  const profile = read('pages/profile/profile.ts');
  const confirm = functionBody(profile, 'confirmBind', '  async confirmBind()');
  assert.match(confirm, /err\.message \|\| '关联失败，请稍后重试'/);
  assert.doesNotMatch(confirm, /邮箱或密码不对/);
});

// End of account-link contract tests.
// EOF
