// 额度的获取通道。
//
// `[09-03 裁决]` **小程序内不卖 Credits**（理由见 services/membership.ts 抬头）。
// 所以这里现在只剩一条真通道：**激励视频**。购买那条留着代码，被 SELL_ENABLED 关着。
//
// 🔴 激励视频要「流量主」广告位，而流量主有开通门槛（历史规则：累计独立访客 ≥ 1000，
//    且小程序已认证）。**拿到 adUnitId 之前这个入口是关的** —— 这跟 `design.md` §18
//    「首版 1000 UV 前不开广告」正好是同一件事，不是两个约束。
//    拿到之后：把广告位 id 填进 `config/env.ts` 的 `AD_UNIT_ID`，入口自动出现，代码不用改。

import * as membership from './membership';
import type { CreditPack } from './membership';
import { ENV } from '../config/env';

/** 商户号通了、且确认只对安卓端开放时，改 membership.SELL_ENABLED */
export const PAY_ENABLED = membership.SELL_ENABLED;

/** 流量主广告位 id。空串 = 还没开通，界面隐藏「看广告」入口 */
export const AD_UNIT_ID: string = (ENV as { AD_UNIT_ID?: string }).AD_UNIT_ID || '';

export function adReady(): boolean {
  return AD_UNIT_ID.length > 0;
}

export interface PayResult {
  ok: boolean;
  /** true = 演示单，没有真实扣款 / 没有真实广告。界面必须说出来 */
  demo: boolean;
  credited: number;
  message?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 断网判断。演示单靠它产出失败态，否则「支付失败」那一屏永远走不到 */
function online(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (r) => resolve(r.networkType !== 'none'),
      fail: () => resolve(true), // 问不出来就当在线，别拦住用户
    });
  });
}

/**
 * 购买。**当前恒不可用**（SELL_ENABLED=false，界面也不显示入口）。
 * TODO(P7)：接 `hc_create_order` 拿 prepay_id → `wx.requestPayment` → `hc_confirm_order`。
 * 失败要分「用户取消」和「支付失败」两种 —— §5.8 M4 的三个结果态里它们是不同的两个。
 */
export async function purchase(pack: CreditPack): Promise<PayResult> {
  if (!PAY_ENABLED) {
    return { ok: false, demo: false, credited: 0, message: '小程序内暂不支持购买额度' };
  }
  const credited = pack.credits + pack.bonus;
  try {
    if (!(await online())) {
      return { ok: false, demo: false, credited: 0, message: '当前没有网络，订单没有提交，没有扣费。' };
    }
    // const order = await gw.rpc('hc_create_order', { p_pack_id: pack.id });
    // await requestPayment(order);
    return { ok: false, demo: false, credited: 0, message: '支付通道还没接通' };
  } catch (e) {
    return { ok: false, demo: false, credited: 0, message: (e as Error).message || '支付未能完成' };
  }
}

/**
 * 激励视频。**看完才给额度** —— `onClose(res.isEnded)` 是唯一的判据，
 * 中途关掉不给，这是激励视频的平台规则，也是我们不该绕的地方。
 *
 * 没配 adUnitId 时返回一个明确的失败（界面本来就不该显示入口，这是兜底）。
 */
export async function watchRewardedAd(): Promise<PayResult> {
  if (!membership.canWatchAd()) {
    return { ok: false, demo: false, credited: 0, message: `今天的 ${membership.AD_DAILY_LIMIT} 条已经看完了，明天再来` };
  }
  if (!adReady()) {
    return { ok: false, demo: false, credited: 0, message: '广告位还没开通' };
  }

  const finished = await new Promise<boolean>((resolve) => {
    // 类型定义里 createRewardedVideoAd 在部分基础库版本上缺失，做一次窄化
    const create = (wx as unknown as {
      createRewardedVideoAd?: (o: { adUnitId: string }) => WechatMiniprogram.RewardedVideoAd;
    }).createRewardedVideoAd;
    if (!create) {
      resolve(false);
      return;
    }
    const ad = create({ adUnitId: AD_UNIT_ID });
    ad.onError(() => resolve(false));
    ad.onClose((res) => resolve(!!res && res.isEnded));
    ad.show().catch(() => ad.load().then(() => ad.show()).catch(() => resolve(false)));
  });

  if (!finished) {
    return { ok: false, demo: false, credited: 0, message: '广告没看完，这次不算' };
  }
  membership.recordAdWatch();
  return { ok: true, demo: false, credited: membership.AD_REWARD };
}

/** 让「没广告位」这件事在界面上有个统一说法 */
export function adUnavailableHint(): string {
  return '看广告换额度还没开放（要先开通流量主）。现在每天有保底额度，够用的。';
}
