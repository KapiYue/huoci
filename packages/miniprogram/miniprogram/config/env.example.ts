// 复制本文件为 `env.ts`（已 gitignore）后填入真实值。**不要把真实值提交进仓库。**
//
// 域名分工见 `design.md` §12.1 T4 与 `docs/gateway-deployment.md` §1.1：
//   开发期 https://api.joy-coder.com（个人主体，已备案，[09-04] 已配进 request 合法域名）
//   生产期 https://api.joy-coder.cn（个体户主体，备案中）
// ⚠️ 服务器域名每月只能改 5 次。开发期已经配好了域名，所以真机/体验版可以直接跑；
//    开发者工具里仍建议勾「不校验合法域名」，省得改后台。
// 🔴 .com 是个人备案，个人备案不得承载经营性服务 —— 开卖 Credits 前必须迁到 .cn。

export const ENV = {
  /**
   * nginx 网关的根地址，**结尾不要带斜杠**。所有请求都经它，不直连 *.supabase.co
   *
   * [09-04] 开发期用 api.joy-coder.com（已备案、已配进 request 合法域名、T5 已结案）。
   * joy-coder.cn 备案下号后改成 https://api.joy-coder.cn —— 那时只改这一行，
   * 服务端路径完全不变（见 docs/gateway-deployment.md §8）。
   */
  GATEWAY_BASE_URL: 'https://api.joy-coder.com',

  /** Supabase 的 anon key。它是公开密钥，可以进客户端；service_role 永远只在网关。 */
  SUPABASE_ANON_KEY: 'REPLACE_ME',

  /** 流量主激励视频的广告位 id。**空串 = 还没开通流量主**，界面自动隐藏「看广告换额度」。
   *  开通条件（历史规则）：累计独立访客 ≥ 1000 且小程序已认证。拿到后填这里，代码不用改。 */
  AD_UNIT_ID: '',

  /** 打开后所有网关请求会在 console 打印耗时，用来测 T9 说的 p95 */
  DEBUG_TIMING: true,
} as const;
