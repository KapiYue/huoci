// 纯界面偏好 · 只存本地。原型 `ProfileTab.tsx`。
//
// 为什么不进 `hc_profiles`：这两项都不影响调度算法，也不需要跨端一致 ——
// 换台设备重新挑一次的成本，远低于为它们各加一列 + 一个 RPC（§11 ③：写只能走 RPC）。
// ⚠️ `daily_goal` 不在这里，它是**服务端字段**，走 `hc_update_profile`（见 services/profile.ts）。

import * as store from './storage';

/**
 * 学习卡片的两种呈现方式（原型 ProfileTab「学习卡片模式」）：
 *   context —— 正面直接给英文原句、把生词挖空，靠上下文回忆
 *   classic —— 正面给拼写 + 音标，背面给释义与原句
 * ⚠️ 底座词没有原句，`context` 对它自动退化成 `classic`（见 pages/study）。
 */
export type StudyCardMode = 'context' | 'classic';

export interface Prefs {
  studyCardMode: StudyCardMode;
  /** 开了就自己不上榜，也不看别人的榜（原型 L1 的隐私开关） */
  hideFromLeaderboard: boolean;
}

const DEFAULT: Prefs = {
  studyCardMode: 'context',
  hideFromLeaderboard: false,
};

export function get(): Prefs {
  return { ...DEFAULT, ...store.read<Partial<Prefs>>(store.SK.PREFS, {}) };
}

export function set(patch: Partial<Prefs>): Prefs {
  const next = { ...get(), ...patch };
  store.write(store.SK.PREFS, next);
  return next;
}
