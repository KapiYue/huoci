// AI 额度（Credits）· 状态层。
//
// ══════════════════════════════════════════════════════════════════════════
// `[09-03 裁决]` **不在小程序里卖 Credits。** SELL_ENABLED = false。
//
// 为什么不卖（三条，缺一条都不足以定这个）：
//   ① **iOS 端根本卖不了** —— 微信小程序禁止在 iOS 端销售虚拟商品/服务，
//      连价格、购买入口、「去别处买」的引导都不允许出现。这不是文案问题：
//      改叫「补充能量」「次数包」一样违规，规则看的是实质
//   ② **安卓端也下不了单** —— 微信支付要商户号，而商户号卡在
//      「主体变更 → 微信认证」这条链上（`design.md` §12.1 T6），现在没通
//   ③ **现在卖也没意义** —— P2 的 Exit 是「用户愿不愿意回来复习」，
//      加支付不改变这个结论。为一个还没验证的假设付架构成本是亏的
//
// 所以 Credits 只有三个来源，**全部是送的**：
//   · 每日保底 —— 每天首次进来补足到 DAILY_FREE，用不完不清零，也不会越囤越多
//   · 激励视频 —— 看一条 +AD_REWARD，每天最多 AD_DAILY_LIMIT 条
//     ⚠️ 需要流量主广告位（见下方 adUnitId 注释），**1000 UV 之前拿不到**，所以现在是关的
//   · 连续学习奖励 —— 连续学习满 STREAK_MILESTONE 天 +STREAK_BONUS，每个里程碑只发一次
//
// 售卖那套（CREDIT_PACKS / pay.purchase / M2–M4 四屏）**代码留着没删**，
// 到 P7 商户号通了、且确认只对安卓端开放时，把 SELL_ENABLED 打开即可 ——
// 🔴 打开时**必须同时**按端隐藏：iOS 端不许出现任何充值入口与价格。
// ══════════════════════════════════════════════════════════════════════════

import * as store from './storage';

/** 🔴 小程序内是否销售 Credits。改成 true 之前先读上面那段注释。 */
export const SELL_ENABLED = false;

export interface Membership {
  /** 批量充值档带来的「优惠状态」。SELL_ENABLED=false 时恒为 false */
  isVip: boolean;
  vipExpiry: string | null;
  credits: number;
  /** 激励视频：每天最多 AD_DAILY_LIMIT 条 */
  adWatchedToday: number;
  adDate: string;
  /** 每日保底额度最近一次发放的日期 */
  freeDate: string;
  /** 已经发过奖励的连续学习里程碑，避免重复发 */
  streakClaimed: number[];
}

export interface CreditPack {
  id: string;
  credits: number;
  /** 展示价。**数字是占位**，定价未定 */
  price: string;
  bonus: number;
  label: string;
}

/** 三档充值。SELL_ENABLED=false 时界面不显示它们，代码留着给 P7 */
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'plan_100', credits: 100, price: '¥9.9', bonus: 0, label: '' },
  { id: 'plan_300', credits: 300, price: '¥24.9', bonus: 30, label: '多送 30' },
  { id: 'plan_1000', credits: 1000, price: '¥69.9', bonus: 150, label: '多送 150' },
];

/** 每天保底几次。用不完不清零，但也不会累到 100 —— 是「保底」不是「日结」 */
export const DAILY_FREE = 3;
/** 每天能看几条激励视频 */
export const AD_DAILY_LIMIT = 3;
/** 看一条广告给多少 */
export const AD_REWARD = 5;
/** 连续学习到第几天给奖励 */
export const STREAK_MILESTONE = 7;
/** 每个里程碑给多少 */
export const STREAK_BONUS = 10;

const DEFAULT: Membership = {
  isVip: false,
  vipExpiry: null,
  credits: DAILY_FREE,
  adWatchedToday: 0,
  adDate: '',
  freeDate: '',
  streakClaimed: [],
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** TODO(P4)：换成读服务端账本，本地只留断网兜底 */
export function get(): Membership {
  const m = { ...DEFAULT, ...store.read<Partial<Membership>>(store.SK.MEMBERSHIP, {}) };
  // 跨天了就把广告计数清零。存的是日期不是计数器，避免「跨天没重启小程序」这一档漏掉
  if (m.adDate !== today()) return { ...m, adDate: today(), adWatchedToday: 0 };
  return m;
}

function save(m: Membership): Membership {
  store.write(store.SK.MEMBERSHIP, m);
  return m;
}

/**
 * 每日保底：每天首次进来把余额**补足到** DAILY_FREE。
 *
 * 注意是「补足」不是「累加」：累加会让一个月没用的人攒出 90 次，
 * 那就不是保底了，是囤货。已有余额高于保底时**一分不动**（广告和奖励攒下来的不该被抹掉）。
 * app.ts 的 onLaunch / onShow 各调一次。
 */
export function ensureDailyFree(): Membership {
  const m = get();
  if (m.freeDate === today()) return m;
  return save({ ...m, freeDate: today(), credits: Math.max(m.credits, DAILY_FREE) });
}

export function addCredits(n: number): Membership {
  const m = get();
  return save({ ...m, credits: m.credits + n });
}

/**
 * 扣额度。**余额不足时返回 null 而不是扣成负数** —— 调用方据此引导去拿额度。
 * TODO(P4)：改成服务端扣减并返回余额，客户端不做账。
 */
export function spend(n: number): Membership | null {
  const m = get();
  if (m.credits < n) return null;
  return save({ ...m, credits: m.credits - n });
}

export function canWatchAd(): boolean {
  return get().adWatchedToday < AD_DAILY_LIMIT;
}

export function recordAdWatch(): Membership {
  const m = get();
  return save({ ...m, adDate: today(), adWatchedToday: m.adWatchedToday + 1, credits: m.credits + AD_REWARD });
}

/**
 * 连续学习奖励。每个里程碑（7 / 14 / 21 …天）只发一次，`streakClaimed` 记已发过的。
 * 返回这次发了多少，0 表示没到里程碑或已经发过。
 *
 * ⚠️ 它是**陈述句的延伸，不是打卡奖励**：断了不补发、不弹「别灰心」、不放火苗（§5.5）。
 * 界面上只在「AI 额度」页安静地列一行，不做 toast 轰炸。
 */
export function claimStreakBonus(streakDays: number): number {
  if (streakDays < STREAK_MILESTONE) return 0;
  const milestone = Math.floor(streakDays / STREAK_MILESTONE) * STREAK_MILESTONE;
  const m = get();
  if (m.streakClaimed.indexOf(milestone) >= 0) return 0;
  save({
    ...m,
    credits: m.credits + STREAK_BONUS,
    streakClaimed: m.streakClaimed.concat(milestone),
  });
  return STREAK_BONUS;
}

/** 批量档买完给的「已购态」。SELL_ENABLED=false 时用不到，留给 P7。 */
export function markVip(months: number): Membership {
  const m = get();
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return save({ ...m, isVip: true, vipExpiry: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` });
}

export function reset(): void {
  store.remove(store.SK.MEMBERSHIP);
}
