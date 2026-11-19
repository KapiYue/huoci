# 设计：关联后微信登录会话

> 以下为旧模型的历史实现设计，并非已确认的 V1 目标。当前 change 暂停验收与归档；V1 的产品规则见 `docs/account-relationship.md` 和 `docs/learning-data-lifecycle.md`。须先只读审计旧模型实际数据与权限，再另行设计迁移。

## 账号模型

| 名称 | 身份 | 数据归属 | 微信登录结果 |
| --- | --- | --- | --- |
| 微信独立账号 W | `openid → W` 映射存在，无关联关系 | W | 返回 W session |
| 词鲸邮箱账号 C | 邮箱与密码认证 | C | 邮箱登录返回 C session |
| 已关联状态 W → C | `openid → W` 与 `hc_account_links(W, C)` 同时存在 | C 为规范账号 | 微信登录返回 C session |
| 已解绑状态 | `openid → W` 仍存在，`hc_account_links(W, C)` 已删除 | W 与 C 各自独立 | 微信登录返回 W session |

关联不是把微信身份改绑到 C，也不是删除 W。它保留 `openid → W` 认证映射，并单独用关联表决定微信登录应最终签发谁的会话。

## 正常登录路径

```text
wx.login code
  → 微信 code2session
  → 查询 openid 对应的 W
  → 查询 W 是否关联到 C
  ├─ 未关联：以 W 的派生凭据换取 W session
  └─ 已关联：服务端为 C 生成一次性凭据并立即验证，返回 C session
```

一次性凭据只存在于单次服务器内存调用中；客户端只接收标准 session。

## 当前故障点与诊断原则

当前生产响应表明故障发生于已关联分支的 `admin/generate_link` 阶段，尚未进入 `/auth/v1/verify`。修复必须将失败分为以下非敏感阶段：

1. `linked_target_lookup`：关联目标不存在或没有可用认证邮箱；
2. `generate_link`：仅记录 HTTP 状态与上游稳定错误码；
3. `verify_link`：仅记录 HTTP 状态与上游稳定错误码；
4. `session_subject_check`：返回用户与目标用户不一致。

日志禁止输出账号邮箱、用户 ID、openid、code、token、hash、响应原文或请求头。

## 修复决策规则

| 诊断结果 | 修复动作 |
| --- | --- |
| `401` / `not_admin` | 核对生产环境中的当前 Supabase server key；不写入仓库，不在聊天中暴露密钥。 |
| `422` / `otp_disabled` | 在 Supabase Auth 配置启用该服务端会话签发所需能力；重新验证后再部署。 |
| `429` | 确认认证限流范围并调整限额或等待窗口；不通过重试风暴绕过。 |
| 成功但字段位置不同 | 兼容当前 Auth 返回结构，仍要求 token hash、verification type 和目标用户校验完整存在。 |
| 其他状态 | 保持脱敏错误给客户端，保留阶段名、HTTP 状态和安全错误码供运维定位。 |

## 验证矩阵

| 场景 | 预期 |
| --- | --- |
| 新微信登录 | 建立 W 并返回 W session。 |
| 既有未关联微信登录 | 返回同一 W session。 |
| 关联后微信登录 | 返回 C session，且不写关联/学习数据。 |
| 关联后邮箱登录 | 返回 C session。 |
| 解绑 | 复制流程成功后返回 W session。 |
| 解绑后微信登录 | 返回 W session。 |
| 解绑后邮箱登录 | 返回 C session；两者停止同步。 |
