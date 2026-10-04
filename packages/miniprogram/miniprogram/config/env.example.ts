// 复制本文件为 `env.ts`（已 gitignore）后填入真实值。**不要把真实值提交进仓库。**
//
// 域名分工见 `design.md` §12.1 T4 与 `docs/gateway-deployment.md` §1.1：
//   当前唯一网关 https://api.joy-coder.cn（备案、DNS、证书、nginx 与公网七条验收均已完成）
// `.com` 临时网关于 09-09 下线，不再作为运行或测试目标。

export const ENV = {
  /**
   * nginx 网关的根地址，**结尾不要带斜杠**。所有请求都经它，不直连 *.supabase.co
   *
   * [09-09] 生产网关已迁到 api.joy-coder.cn；服务端路径完全不变。
   * 证书与七条公网验收记录见 docs/gateway-deployment.md §8。
   */
  GATEWAY_BASE_URL: 'https://api.joy-coder.cn',

  /** Supabase 的 anon key。它是公开密钥，可以进客户端；service_role 永远只在网关。 */
  SUPABASE_ANON_KEY: 'REPLACE_ME',

  /** 流量主激励视频的广告位 id。**空串 = 还没开通流量主**，界面自动隐藏「看广告换额度」。
   *  开通条件（历史规则）：累计独立访客 ≥ 1000 且小程序已认证。拿到后填这里，代码不用改。 */
  AD_UNIT_ID: '',

  /** 仅本地性能排查时临时打开；发布基线必须保持关闭。 */
  DEBUG_TIMING: false,
} as const;
