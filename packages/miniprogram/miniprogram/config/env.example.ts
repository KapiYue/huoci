// 复制本文件为 `env.ts`（已 gitignore）后填入真实值。**不要把真实值提交进仓库。**
//
// 域名分工见《执行方案》§14.1 T4：
//   开发期 https://cijing.joy-coder.com（个人主体，已备案）
//   生产期 https://api.joy-coder.cn（个体户主体，备案中）
// ⚠️ 服务器域名每月只能改 5 次，开发期一律靠开发者工具「不校验合法域名」开关，别去改后台。

export const ENV = {
  /** nginx 网关的根地址，**结尾不要带斜杠**。所有请求都经它，不直连 *.supabase.co */
  GATEWAY_BASE_URL: 'https://cijing.joy-coder.com',

  /** Supabase 的 anon key。它是公开密钥，可以进客户端；service_role 永远只在网关。 */
  SUPABASE_ANON_KEY: 'REPLACE_ME',

  /** 打开后所有网关请求会在 console 打印耗时，用来测 T9 说的 p95 */
  DEBUG_TIMING: true,
} as const;
