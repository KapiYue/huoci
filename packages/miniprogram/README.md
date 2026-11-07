# 活词 · 微信小程序

原生小程序 + TypeScript。**不用 Taro / uni-app**（《项目上下文》§6）。

## 跑起来

```bash
npm run sync:shared -w @huoci/miniprogram   # 把 packages/shared 同步进来（首次必跑）
```

1. 微信开发者工具 → 导入项目 → 目录选 `packages/miniprogram`
2. 把 `project.config.json` 的 `appid` 换成真实 AppID
3. 复制 `miniprogram/config/env.example.ts` → `miniprogram/config/env.ts`，保持生产网关为 `https://api.joy-coder.cn`
4. 详情 → 本地设置 → 确认「**不校验合法域名**」未勾选；共享工程配置已开启合法域名校验

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

## 硬约束（`design.md` §14，违反会踩到已知的坑）

1. **禁止裸 REST 写 `words`**，一律走 RPC
2. **不做硬删除**（`review_events.word_id ON DELETE CASCADE` 会连坐删掉复习史）
3. **不引入 device 维度**
4. **每次 review 必带 `client_event_id`**（写队列补发的幂等键）
5. **AI 返回的文本必须过 `msgSecCheck`**，在网关做
6. **禁止裸写 `daily_activity`**

## 账号关联与隐私文案

小程序内《个人信息保护政策》的单一事实来源是 `miniprogram/services/privacy.ts`（版本 2026-11-07）。微信账号与词鲸邮箱账号默认独立；普通“使用词鲸账号登录”不会自动关联或合并数据。

关联必须由用户主动发起，重新验证微信与词鲸账号并勾选确认。关联后两个入口访问同一份规范词鲸数据；解绑时服务端把解除瞬间的当前数据复制回微信账号，保留微信认证映射，之后双方停止同步并独立演进。

微信授权仅用于登录、关联身份核验和必要的内容安全校验。密码、微信登录凭据和服务端会话凭据不返回或保存在小程序本地，也不写入日志或业务文档。微信与 Supabase 只处理提供功能所必需的数据，学习数据不出售给第三方。

小程序当前不提供删除账号入口；已关联账号须先解绑。随后删除词鲸账号不会自动删除解绑产生的微信账号副本，需要分别处理。
