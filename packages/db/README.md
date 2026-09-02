# 活词的数据库改动

**这些迁移跑在词鲸的那个 Supabase 项目上** —— 小程序是词鲸的第三个正式端，
同一个 Postgres、同一套 `auth.uid()` RLS（《执行方案》§14.0）。

## 落点规则（§14.1 T7，唯一的护栏）

> **共享 schema 只放「事实」，不放「解释」。**

- 事实（学了什么、何时学、词的上下文）→ 词鲸的 `words` / `word_contexts` / `review_events`
- 解释（活词判据、`level_line`、队列优先级、连击）→ `hc_` 前缀私有表

**加 `hc_` 表不用论证；改词鲸的表要论证。** 对词鲸现有表的改动**只有两处**：

| # | 改动 | 状态 |
|---|---|---|
| ① | `review_events.client_event_id` 幂等键 + `apply_review` 支持 | ✅ **已执行**（`migrations/cijing/202609010002_review_idempotency.sql`，文件已拷进 `cijing/supabase/migrations/`） |
| ② | `daily_activity` 日界改北京时区 | ✅ 已落地（`cijing/supabase/migrations/202609010001_local_day_boundary.sql`） |

若出现第三处，必须先写进《执行方案》§4.0 并说明为什么不可避免。

## 执行顺序与状态

| 顺序 | 文件 | 状态 |
|---|---|---|
| 1 | `cijing/.../202609010001_local_day_boundary.sql` | ✅ 已执行 |
| 2 | `migrations/cijing/202609010002_review_idempotency.sql` | ✅ 已执行 |
| 3 | `migrations/202609010003_hc_core_tables.sql` | 🔴 待执行 |
| 4 | `migrations/202609010004_hc_rpc.sql` | 🔴 待执行（**依赖 2**：要调带 `p_client_event_id` 的新签名） |

## 怎么跑

Supabase Dashboard → SQL Editor 贴进去执行，**按上表顺序**。

⚠️ **编写归属在 huoci，部署通道在 cijing。** `supabase db push` 只读
`cijing/supabase/migrations/`，读不到这个目录。想要可复现，跑完之后把
`0003` / `0004` 也各拷一份进那个目录 —— 就像 `0002` 已经做的那样。
本目录是这些文件的**编写与评审归属地**，不是执行入口。
