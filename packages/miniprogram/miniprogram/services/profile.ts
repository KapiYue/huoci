// ⑤ 我的 · 数据层。`design.md` §5.4 S8。
//
// 读 `hc_profiles` 走 REST GET（只读没问题），写走 `hc_update_profile` RPC（`0006`）——
// 又一次：`wx.request` 没有 PATCH，不是自律是物理限制（§11 ③）。

import * as gw from './gateway';
import * as store from './storage';
import type { HcProfile } from '../shared/types';

export const DEFAULT_PROFILE: HcProfile = {
  user_id: '',
  level_line: null,
  daily_goal: 20,
  active_pack_ids: ['base'],
  onboarding_done_at: null,
  updated_at: '',
};

/** 每日目标的可选档位。§5.4 S4 的默认是 20 个词 / 约 8 分钟。 */
export const GOAL_OPTIONS = [10, 20, 30, 50];

export async function fetchProfile(): Promise<HcProfile> {
  try {
    const rows = await gw.select<HcProfile[]>('hc_profiles?select=*&limit=1');
    const row = rows[0];
    if (row) {
      store.write(store.SK.HC_PROFILE, row);
      return row;
    }
  } catch {
    /* 落到本地缓存 */
  }
  return store.read<HcProfile>(store.SK.HC_PROFILE, DEFAULT_PROFILE);
}

export async function setDailyGoal(goal: number): Promise<HcProfile> {
  const row = await gw.rpc<HcProfile>('hc_update_profile', { p_daily_goal: goal });
  store.write(store.SK.HC_PROFILE, row);
  // 今日概览里的 daily_goal 变了，缓存作废，否则「上限 N 词」会停在旧值
  store.remove(store.SK.PLAN_CACHE);
  return row;
}

export function cachedProfile(): HcProfile {
  return store.read<HcProfile>(store.SK.HC_PROFILE, DEFAULT_PROFILE);
}
