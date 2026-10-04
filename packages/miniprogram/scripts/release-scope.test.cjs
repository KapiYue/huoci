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

test('审核修复版冷启动直接进入游客查词', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.pages[0], 'pages/search/search');

  const search = `${read('pages/search/search.ts')}\n${read('pages/search/search.wxml')}`;
  assert.doesNotMatch(search, /onboarding\.guard/);
  assert.match(search, /登录后加入生词/);
  assert.match(search, /auth\.isLoggedIn\(\)/);

  const lookup = read('services/lookup.ts');
  assert.match(lookup, /\/functions\/v1\/dictionary-lookup/);
  assert.match(lookup, /anonymous:\s*true/);
});

test('未开放能力与生成页面不进入首发包路由', () => {
  const app = JSON.parse(read('app.json'));
  assert.doesNotMatch(app.pages.join('\n'), /aiscene|\/vip|wordpacks|packdetail|leaderboard|settings/);

  const visible = [
    'pages/search/search.wxml',
    'pages/login/login.wxml',
    'pages/today/today.wxml',
    'pages/profile/profile.wxml',
    'pages/reader/reader.wxml',
    'pages/onboarding/onboarding.wxml',
  ].map(read).join('\n').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visible, /AI|人工智能|智能生成|AI\s*问答|AI\s*场景/);
  assert.doesNotMatch(visible, />\s*生成[^<]*</);
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

test('发布基线关闭调试日志与临时验收入口', () => {
  const env = read('config/env.example.ts');
  assert.match(env, /DEBUG_TIMING:\s*false/);

  const releaseFiles = [
    'services/prefs.ts',
    'services/learning.ts',
    'pages/today/today.ts',
    'pages/today/today.wxml',
    'pages/study/study.ts',
    'pages/study/study.wxml',
  ].map(read).join('\n');
  assert.doesNotMatch(releaseFiles, /TEMP_|backlogTest|卡片模式测试|临时积压测试/);
});

test('核心异步页面区分 Loading、Error 与 Empty', () => {
  const cases = [
    ['pages/today/today.ts', 'pages/today/today.wxml', 'retryLoad'],
    ['pages/study/study.ts', 'pages/study/study.wxml', 'retryLoad'],
    ['pages/words/words.ts', 'pages/words/words.wxml', 'retryLoad'],
    ['pages/search/search.ts', 'pages/search/search.wxml', 'onConfirm'],
    ['pages/reader/reader.ts', 'pages/reader/reader.wxml', 'retryLookup'],
  ];

  for (const [tsFile, viewFile, retry] of cases) {
    const source = `${read(tsFile)}\n${read(viewFile)}`;
    assert.match(source, /loading|phase === 'loading'/, `${viewFile} 缺少 Loading 状态`);
    assert.match(source, /error|phase === 'error'/, `${viewFile} 缺少 Error 状态`);
    assert.match(source, new RegExp(`bindtap="${retry}"|${retry}\\s*\\(`), `${viewFile} 的 Error 状态不可重试`);
  }
});

test('首发版不暴露未完成功能入口', () => {
  const profile = read('pages/profile/profile.wxml');
  assert.match(profile, /wx:if="\{\{releaseFeatures\.leaderboard\}\}"[^>]*bindtap="openLeaderboard"/);
  assert.doesNotMatch(profile, /aiPractice|openAiScene|AI\s*真实场景/);
  assert.match(profile, /wx:if="\{\{releaseFeatures\.leaderboard\}\}"[^>]*>[\s\S]*?不参与排行榜/);
  assert.doesNotMatch(read('custom-tab-bar/index.wxml'), /词包/);
});
