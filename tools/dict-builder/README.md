# dict-builder · 活词 P1 词典管线

零依赖，Node ≥ 20 直接跑，**不需要 `npm install`**。

```bash
node src/cli.mjs doctor   # 检查输入齐不齐，缺什么告诉你去哪拿
node src/cli.mjs demo     # 用合成样本跑通整条管线（不需要真实 ECDICT）
node src/cli.mjs all      # 真实数据全流程
```

## 为什么是 `.mjs` 而不是 TypeScript

这是**一次性的离线数据脚本**，跑完产出 JSON 就完事，不进任何端的运行时。
零依赖意味着今天就能跑，不用等 `npm install`、不用配 build。
`packages/shared` 那边仍然是 TypeScript——那些类型三端都要用。

## 输入（放 `data/`，已 gitignore）

| 文件 | 从哪拿 |
|---|---|
| `data/ecdict.csv` | Release 页**没有 CSV 包**，见下方「ECDICT 怎么拿」 |
| `data/lists/ngsl.txt` | <https://www.newgeneralservicelist.com/new-general-service-list> `NGSL_12_lemmatized_for_research.csv` |
| `data/lists/bsl.txt` | <https://www.newgeneralservicelist.com/business-service-list> `BSL_120_lemmatized_for_research.csv` |
| `data/lists/tsl.txt` | <https://www.newgeneralservicelist.com/toeic-service-list> `TSL_12_lemmatized_for_research.csv` |
| `data/lists/nawl.txt` | <https://www.newgeneralservicelist.com/new-academic-word-list> `NAWL_12_lemmatized_for_research.csv` |
| `data/lists/ngsl-spoken.txt` | <https://www.newgeneralservicelist.com/ngsl-spoken> `NGSL-Spoken_12_lemmatized_for_research.csv` |

⚠️ 一律走 **newgeneralservicelist.com**。`.org` 那个域名已经是停放页，
BSL 页面被插了赌博站外链，且只挂着旧版 BSL 1.01。

### 一条命令备齐

```bash
bash scripts/fetch-ecdict.sh                          # ECDICT → data/ecdict.csv
bash scripts/fetch-lists.sh && python3 scripts/make-lists.py   # 五张表 → data/lists/*.txt
node src/cli.mjs doctor                               # 验收
```

**ECDICT**：Release 1.0.28 的附件只有 mdx / eudic / stardict / mobi / sqlite，**没有 csv**。
仓库根目录那个 `ecdict.csv` 是 77 万词的基础版，管线要的是 340 万词的完整版，
所以 `fetch-ecdict.sh` 下 sqlite 包再 `sqlite3 -header -csv` 转出
（3,402,564 词条，241MB）。转完 `data/ecdict-sqlite/` 和那个 zip 可以删，占 1GB。

**五张词表**：原件是 CSV，每行 `headword,词形1,词形2,...`，`##` 开头是说明。
`make-lists.py` 取第一列即 lemma，转小写去重，重音折成 ASCII
（`café → cafe`，否则对不上 ECDICT 的纯 ASCII 词形表）。

当前规模：NGSL 2809 / BSL 1744 / TSL 1249 / NAWL 959 / Spoken 721。

**不做网页抓取**：`fetch-lists.sh` 只按固定文件名取原件，不解析页面。
官网改版时宁可 404 报错，也不要静默抓错——抓错比抓不到危险。

## 产出

```
packs/base.json          主包 · NGSL ∪ BSL · 只存 [拼写, 频段1-6, 来源位] · 目标 ~90KB
packs/pro-*.json         分包A · TSL / NAWL / Spoken（净增口径）
packs/exam-*.json        分包A · cet4 cet6 ky ielts toefl gre
reports/pack-stats.md    §7.1 八项统计，末尾是待办清单
reports/pack-stats.json  同一份数据，机器读
reports/unmatched/*.txt  ⚠️ 词元对齐失败清单，按表分开
```

> `packs/` 与 `reports/` 里的内容由脚本生成。仓库里只保留 `.gitkeep`，
> 真实数据跑出来后再决定哪些产出物入库。

## 五个步骤

| 步 | 做什么 |
|---|---|
| 01 ingest | 流式清洗 ECDICT（剔畸形条目）→ `out/word-lite.ndjson` + `lemma-map` + `tagged` |
| 02 lists | 载入五张 CC BY-SA 表，算出底座（NGSL ∪ BSL）|
| 03 align | ⚠️ **词元对齐**。用 `exchange` 字段把 running/ran/runs 归到 run |
| 04 packs | 产出 base / pro / exam 词包，exam 做 lemma 归并 + 扣底座 |
| 05 report | 八项统计 + 待办 |

## ⚠️ 第 03 步是这条管线的主要风险

NGSL 系列是 **lemma 列表**，ECDICT 是**词形表**。一定会有对不上的。

**规则：不允许静默丢弃。** 失败清单按表分开写进 `reports/unmatched/`，
合并报会把 GRE 的高失败率掩盖在 CET4 的低失败率里。

**人工过完这份清单才算 P1 收尾**（`design.md` §21.1「词元对齐失败被静默吞掉」）。

## 已知数据缺口

ECDICT 只有一个 `phonetic` 字段，**没有 uk/us 之分**，
而 `design.md` §9 的 `word` 表设计了 `phonetic_uk` / `phonetic_us`（来源待定，见 §22.2 ④）。
需要另找来源，或在 `tools/tts-batch` 生成音频时一并产出。报告 §0 会提醒。

## 许可证义务

底座词表来自 NGSL 系列（CC BY-SA 4.0），产出的 `packs/*.json` 属于**改编物**，
按 ShareAlike 须以同协议公开共享 → **单独开一个公开仓库放词表文件**。
词表是独立作品，**不使 app 本体变成衍生作品**（《词包与冷启动方案》§2.1）。

署名：**Browne, C., Culligan, B. & Phillips, J.** — 已写进每个 pack 的 JSON 头，
「我的 → 关于 → 开源许可」页需同步展示。

🔴 **红线**：ECDICT 的 `oxford` / `collins` 字段来自专有词典，
**只能当内部排序信号，不得切出来发布成「牛津3000词包」**。
