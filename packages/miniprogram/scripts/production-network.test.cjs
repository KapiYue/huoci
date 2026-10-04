const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(packageRoot, relative), 'utf8');

test('微信共享工程配置开启 request 合法域名校验', () => {
  const config = JSON.parse(read('project.config.json'));
  assert.equal(config.setting.urlCheck, true);
});

test('可提交的环境模板只指向生产网关', () => {
  const source = read('miniprogram/config/env.example.ts');
  const match = source.match(/GATEWAY_BASE_URL:\s*'([^']+)'/);

  assert.ok(match, '环境模板缺少 GATEWAY_BASE_URL');
  assert.equal(match[1], 'https://api.joy-coder.cn');
  assert.doesNotMatch(source, /api\.joy-coder\.com|localhost|127\.0\.0\.1/);
});

test('开发说明不再引导关闭合法域名校验', () => {
  const source = read('README.md');
  assert.match(source, /不校验合法域名[^\n]*未勾选/);
  assert.doesNotMatch(source, /勾上「\*\*不校验合法域名/);
});
