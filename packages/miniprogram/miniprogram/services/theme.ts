// 外观主题（原型 ProfileTab 的「跟随系统 / 浅色 / 深色」三档）。
//
// ⚠️ **小程序没有强制主题的 API**。`app.json` 的 `darkmode:true` 只让 `@media (prefers-color-scheme)`
// 跟随系统；用户想手动锁一个色，只能靠令牌覆盖类（styles/tokens.wxss 的 .hc-theme-*）
// 挂在**每个页面的根节点**上。`page` 元素在根节点之外，所以覆盖类自带 background。
//
// 用法：页面 wxml 根节点写 `class="hc-page {{themeClass}}"`，onShow 里调 `theme.apply(this)`。

import * as store from './storage';

export type ThemeSetting = 'system' | 'light' | 'dark';

const KEY = store.SK.THEME;

export function get(): ThemeSetting {
  const v = store.read<ThemeSetting>(KEY, 'system');
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function set(v: ThemeSetting): void {
  store.write(KEY, v);
}

/** 跟随系统时返回空串，让 @media 说了算 */
export function themeClass(): string {
  const v = get();
  return v === 'system' ? '' : `hc-theme-${v}`;
}

interface ThemedPage {
  setData(d: Record<string, unknown>): void;
}

/** 每个页面 onShow 调一次。用户在「我的」改了主题，切回来立刻生效。 */
export function apply(page: ThemedPage): void {
  page.setData({ themeClass: themeClass(), themeSetting: get() });
}
