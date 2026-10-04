const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../miniprogram');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

test('阅读器不程序化读取剪贴板，只引导用户手动粘贴', () => {
  assert.doesNotMatch(read('pages/reader/reader.ts'), /wx\.getClipboardData\s*\(/);
  assert.doesNotMatch(read('pages/reader/reader.wxml'), /bindtap="pasteClipboard"/);
  assert.match(read('pages/reader/reader.wxml'), /长按上方输入框，使用系统菜单粘贴/);
});

test('两个隐私政策入口共用同一事实来源', () => {
  assert.match(read('pages/login/login.ts'), /PRIVACY_SECTIONS/);
  assert.match(read('pages/profile/profile.ts'), /PRIVACY_SECTIONS/);
  assert.doesNotMatch(read('pages/login/login.wxml'), /<block\s+wx:else\s+wx:for=/);
  assert.match(read('services/privacy.ts'), /不会程序化读取剪贴板/);
  assert.match(read('services/privacy.ts'), /功能使用事件/);
});

test('首发包没有未审计的隐私读取 API', () => {
  const source = walk(root)
    .filter((file) => /\.(?:ts|wxml)$/.test(file) && !file.endsWith('.generated.ts'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');

  const forbidden = [
    'getClipboardData',
    'getLocation',
    'getFuzzyLocation',
    'startLocationUpdate',
    'startLocationUpdateBackground',
    'chooseAddress',
    'chooseContact',
    'chooseMedia',
    'chooseImage',
    'chooseVideo',
    'chooseMessageFile',
    'getUserProfile',
    'getUserInfo',
    'getPhoneNumber',
    'getWeRunData',
    'startRecord',
  ];

  forbidden.forEach((api) => assert.doesNotMatch(source, new RegExp(`\\b${api}\\b`), `发现未审计接口 ${api}`));

  // 两个写入型接口均由用户主动点击触发：公开许可链接写入剪贴板；已关闭的排行榜保存海报到相册。
  assert.deepEqual(
    source.match(/wx\.setClipboardData\s*\(/g) ?? [],
    ['wx.setClipboardData('],
    '写剪贴板调用发生变化，需要重新审计',
  );
  assert.deepEqual(
    source.match(/wx\.saveImageToPhotosAlbum\s*\(/g) ?? [],
    ['wx.saveImageToPhotosAlbum('],
    '写相册调用发生变化，需要重新审计',
  );
  assert.match(read('config/release.ts'), /leaderboard:\s*false/);
  assert.match(read('pages/leaderboard/leaderboard.ts'), /guardReleaseFeature\('leaderboard'\)/);
});
