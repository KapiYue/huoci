# 活词的数据库改动

**这些迁移跑在词鲸的那个 Supabase 项目上** —— 小程序是词鲸的第三个正式端，
同一个 Postgres、同一套 `auth.uid()` RLS（`design.md` §7）。

## 落点规则（§14.1 T7，唯一的护栏）

> **共享 schema 只放「事实」，不放「解释」。**

- 事实（学了什么、何时学、词的上下文）→ 词鲸的 `words` / `word_contexts` / `review_events`
- 解释（活词判据、`level_line`、队列优先级、连击）→ `hc_` 前缀私有表

**加 `hc_` 表不用论证；改词鲸的表要论证。** 对词鲸现有表的改动**只有两处**：

| # | 改动 | 状态 |
|---|---|---|
| ① | `review_events.client_event_id` 幂等键 + `apply_review` 支持 | ✅ **已执行**（`migrations/cijing/202609010002_review_idempotency.sql`，文件已拷进 `cijing/supabase/migrations/`） |
| ② | `daily_activity` 日界改北京时区 | ✅ 已落地（`cijing/supabase/migrations/202609010001_local_day_boundary.sql`） |

若出现第三处，必须先写进`design.md` §9.0 并说明为什么不可避免。

## 执行顺序与状态

| 顺序 | 文件 | 状态 |
|---|---|---|
| 1 | `cijing/.../202609010001_local_day_boundary.sql` | ✅ 已执行 |
| 2 | `migrations/cijing/202609010002_review_idempotency.sql` | ✅ 已执行 |
| 3 | `migrations/202609010003_hc_core_tables.sql` | ✅ **已执行（09-04，`supabase db push`）** |
| 4 | `migrations/202609010004_hc_rpc.sql` | ✅ **已执行（09-04）**（依赖 2，已满足） |
| 5 | `migrations/202609020005_hc_save_onboarding.sql` | ✅ **已执行（09-04）**。`hc_base_words` 已灌 **4553/4553 带释义**（音标 4507） |
| 6 | `migrations/202609020006_hc_words_and_profile.sql` | ✅ **已执行（09-04）**。`hc_list_words`（S6 三个筛选）+ `hc_update_profile`（S8 设置） |

> `0005` 建的 `hc_base_words` 跑完是**空表**，函数会退化成给播种词写「待补充」。
> 灌数据是另一件事，两者互不阻塞。

## 灌 `hc_base_words`

```bash
cd tools/dict-builder && node src/cli.mjs base-meanings   # 产出 packs/base-full.json（重扫 241MB ecdict.csv）
node packages/db/scripts/import-base-words.mjs --dry      # 先看不写
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node packages/db/scripts/import-base-words.mjs
```

- 两份产物各守各的约束：`packs/base.json`（93KB，**不带释义**）打进小程序主包；
  `packs/base-full.json`（660KB，带音标 + 释义）只灌服务端，**永不下发**（§13.2）。
  「底座不存释义」那条约束针对的是主包 90KB 预算，服务端表没有这个预算。
- 脚本用 **service_role 直连 Supabase，不走网关** —— 一次性运维动作，不是产品流量。
  正因为拿的是 service_role，**别把它塞进任何 CI**。
- 幂等：走 PostgREST 的 `resolution=merge-duplicates`，重复跑只覆盖同一批行。
- 验收：`select count(*), count(primary_meaning) from hc_base_words;` 应为 4553 / 4553。

## 怎么跑

⚠️ **编写归属在 huoci，部署通道在 cijing。** `supabase db push` 只读
`cijing/supabase/migrations/`，读不到这个目录。本目录是这些文件的**编写与评审归属地**，
不是执行入口。

`[09-04 改]` **先拷再 push，别再用 Dashboard 手贴**：

```bash
cp packages/db/migrations/2026090*_hc_*.sql \
   /Users/qingmou/Documents/TechFiles/personal/study-ai/cijing/supabase/migrations/
cd /Users/qingmou/Documents/TechFiles/personal/study-ai/cijing
supabase migration list --linked   # 先看远端缺哪几行
supabase db push --dry-run         # 确认只会推你想推的那几份
supabase db push
```

CLI 已 link 到生产（`daudpwwdhdyvfodpwvny`）**且免密**，四份一次按序应用。
这个顺序比「Dashboard 手贴 + 事后回拷」少一步 `migration repair --status applied` ——
手贴的话远端迁移历史里没有记录，下次 push 会重放。

`0003`–`0006` 四份已于 09-04 拷进部署通道并 push 完成，两边内容一致。
