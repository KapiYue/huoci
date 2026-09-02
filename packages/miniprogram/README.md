# 活词 · 微信小程序

原生小程序 + TypeScript。**不用 Taro / uni-app**（《项目上下文》§6）。

## 跑起来

```bash
npm run sync:shared -w @huoci/miniprogram   # 把 packages/shared 同步进来（首次必跑）
```

1. 微信开发者工具 → 导入项目 → 目录选 `packages/miniprogram`
2. 把 `project.config.json` 的 `appid` 换成真实 AppID
3. 复制 `miniprogram/config/env.example.ts` → `miniprogram/config/env.ts`，填网关地址
4. 详情 → 本地设置 → 勾上「**不校验合法域名**」（开发期必需，见《执行方案》§14.1 T4）

## 目录

```
miniprogram/
  shared/      ← 自动生成，勿改。源头是 packages/shared/src
  config/      ← env.ts 是本地私有文件（已 gitignore）
  services/    ← 网关请求、鉴权、离线写队列、埋点
  pages/       ← 页面
  components/  ← 自定义 tabBar 与通用组件
  styles/      ← 设计令牌（从原型的 Tailwind 抽出）
```

## 硬约束（《执行方案》§14.4，违反会踩到已知的坑）

1. **禁止裸 REST 写 `words`**，一律走 RPC
2. **不做硬删除**（`review_events.word_id ON DELETE CASCADE` 会连坐删掉复习史）
3. **不引入 device 维度**
4. **每次 review 必带 `client_event_id`**（写队列补发的幂等键）
5. **AI 返回的文本必须过 `msgSecCheck`**，在网关做
6. **禁止裸写 `daily_activity`**
