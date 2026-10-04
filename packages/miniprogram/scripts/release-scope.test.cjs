const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function releaseFlag(source, name) {
  const match = source.match(new RegExp(`\\b${name}:\\s*(true|false)\\b`));
  assert.ok(match, `缺少发布开关 ${name}`);
  return match[1] === 'true';
}

test('微信首发版只开启真实核心闭环', () => {
  const source = read('config/release.ts');
  const enabled = ['lookup', 'savedWords', 'review', 'reader'];
  const disabled = ['membership', 'payment', 'aiPractice', 'aiQuota', 'leaderboard', 'friendPk', 'wordPacks'];

  enabled.forEach((name) => assert.equal(releaseFlag(source, name), true, `${name} 应开启`));
  disabled.forEach((name) => assert.equal(releaseFlag(source, name), false, `${name} 应关闭`));
});

test('微信首发版底部导航不暴露词包', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(
    app.tabBar.list.map((item) => item.pagePath),
    ['pages/today/today', 'pages/words/words', 'pages/search/search', 'pages/profile/profile'],
  );
  assert.match(read('custom-tab-bar/index.ts'), /RELEASE_FEATURES\.wordPacks/);
});

test('首发可见页面不展示内部阶段编号', () => {
  const publicViews = [
    'pages/today/today.wxml',
    'pages/login/login.wxml',
    'pages/profile/profile.wxml',
    'pages/reader/reader.wxml',
  ];
  const internalLabel = /\b(?:P3|P4|P7|L1(?:–L4)?|A1(?:–A3)?)\b/;

  publicViews.forEach((file) => {
    const visible = read(file).replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(visible, internalLabel, `${file} 仍含内部阶段编号`);
  });
});

test('隐藏页面均有首发版直达保护', () => {
  const guards = {
    'pages/vip/vip.ts': 'aiQuota',
    'pages/wordpacks/wordpacks.ts': 'wordPacks',
    'pages/packdetail/packdetail.ts': 'wordPacks',
    'pages/leaderboard/leaderboard.ts': 'leaderboard',
    'pages/aiscene/aiscene.ts': 'aiPractice',
  };

  Object.entries(guards).forEach(([file, feature]) => {
    assert.match(read(file), new RegExp(`guardReleaseFeature\\('${feature}'\\)`), `${file} 缺少直达保护`);
  });
});
