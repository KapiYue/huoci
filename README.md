# 活词（Huoci）

> 从真实阅读中收集生词，通过语境保留与间隔复习，将「见过」变成「会用」。

活词是一款帮助用户在真实语境中学习英语词汇的微信小程序，也是「词鲸」的一个客户端。

## 产品演示

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <a href="https://youtu.be/IdWqfZYdRFw">
        <img src="https://github.com/user-attachments/assets/371d574a-9789-45db-ad8c-6148bebaec7d" alt="活词完整产品演示">
      </a><br>
      <b>完整产品演示</b><br>
      <sub>阅读、查词、收词、复习与词库管理</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <a href="https://youtu.be/LVROVUE4__I">
        <img src="https://github.com/user-attachments/assets/1d0e068f-6eca-499b-b244-272d730cd963" alt="词鲸与活词跨端互通演示">
      </a><br>
      <b>词鲸 × 活词：跨端生词闭环</b><br>
      <sub>词鲸查词收藏 → 自动同步 → 活词激活复习</sub>
    </td>
  </tr>
</table>

*点击封面观看 YouTube 演示。*

## 为什么做它

背词常常脱离真实语境：查过的词散落在搜索记录中，读到的原句也很快被遗忘。活词将查词、原句收录、复习调度和词汇管理连成一个学习闭环，让每一个在阅读中遇到的词都有机会沉淀为真正会用的词汇。

## 核心体验

- **在语境中收词**：粘贴英文文章即可阅读；点按单词自动收录，并保留原句和来源。
- **查词即入库**：支持单词释义、音标和发音；新词可直接加入个人词库。
- **按掌握度复习**：通过「不认识 / 模糊 / 掌握」反馈，动态安排下一次复习。
- **管理今日学习**：将到期复习与新词学习整合为清晰的今日队列。
- **沉淀个人词库**：集中查看已收录、待复习和已激活的词，追溯它们出现的语境。

## 核心交互

<p align="center">
  <img src="https://github.com/user-attachments/assets/8596674a-b044-4b34-b675-ab63b470b99a" width="300" alt="粘贴文章、阅读点词并查看词义的核心交互演示">
</p>
<p align="center"><sub>从文章导入到语境点词：让每个生词保留它出现的地方。</sub></p>

## 产品界面

<table>
  <tr>
    <td width="33%" align="center"><a href="https://github.com/user-attachments/assets/06090995-4271-480e-ad73-b00a8720ee19"><img src="https://github.com/user-attachments/assets/06090995-4271-480e-ad73-b00a8720ee19" width="180" alt="精准查词入口"></a><br><sub>精准查词</sub></td>
    <td width="33%" align="center"><a href="https://github.com/user-attachments/assets/2b187143-d866-4c37-a52c-073668dbba15"><img src="https://github.com/user-attachments/assets/2b187143-d866-4c37-a52c-073668dbba15" width="180" alt="掌握度复习卡片"></a><br><sub>按掌握度复习</sub></td>
    <td width="33%" align="center"><a href="https://github.com/user-attachments/assets/89e569ee-3f0c-49e0-a593-f06cead15050"><img src="https://github.com/user-attachments/assets/89e569ee-3f0c-49e0-a593-f06cead15050" width="180" alt="粘贴文章并开始收词"></a><br><sub>粘贴文章收词</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/user-attachments/assets/4a6f7dc4-2b44-499f-9e0b-6d6a39f7f6fe"><img src="https://github.com/user-attachments/assets/4a6f7dc4-2b44-499f-9e0b-6d6a39f7f6fe" width="180" alt="阅读时点词收录"></a><br><sub>在阅读中点词</sub></td>
    <td align="center"><a href="https://github.com/user-attachments/assets/f43c8da1-ef98-4678-8ad9-d602d254d847"><img src="https://github.com/user-attachments/assets/f43c8da1-ef98-4678-8ad9-d602d254d847" width="180" alt="个人词库"></a><br><sub>个人词库</sub></td>
    <td></td>
  </tr>
</table>

## 技术实现

| 层级 | 技术 |
| --- | --- |
| 客户端 | 原生微信小程序、TypeScript |
| 服务层 | Flask 网关、微信登录、内容安全与 AI 审核代理 |
| 数据层 | Supabase、PostgreSQL、数据库迁移 |
| 工程化 | npm workspaces、共享 TypeScript 领域模型、界面与数据校验工具 |

## 项目组成

| 目录 | 说明 |
| --- | --- |
| `packages/miniprogram` | 原生微信小程序（TypeScript） |
| `packages/gateway` | 微信登录、内容安全检测与 AI 函数审核代理（Flask） |
| `packages/db` | Supabase / PostgreSQL 迁移与数据导入脚本 |
| `packages/shared` | 小程序共享类型和业务模型 |
| `tools` | 词库构建、界面校验与数据校验工具 |

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- 微信开发者工具（运行小程序）
- Python 3.10 或更高版本（需要本地运行网关时）

## 快速开始

先安装 JavaScript 依赖并同步共享代码：

```bash
npm ci
npm run sync:shared
```

然后完成小程序本地配置：

```bash
cp packages/miniprogram/miniprogram/config/env.example.ts \
   packages/miniprogram/miniprogram/config/env.ts
```

编辑 `packages/miniprogram/miniprogram/config/env.ts`，至少填入可用的 `SUPABASE_ANON_KEY`。`env.ts` 已被忽略，不会提交到仓库；不要把任何密钥写进示例文件。

最后在微信开发者工具中导入 `packages/miniprogram` 目录即可预览和调试。项目配置默认开启合法域名校验，因此本地调试请使用已配置的 HTTPS 网关；不要关闭该校验来替代网关配置。

## 启动本地网关

网关负责微信登录、内容安全检查以及 AI 接口的审核代理。首次使用时创建 Python 虚拟环境、安装 Flask，并配置环境变量：

```bash
python3 -m venv packages/gateway/.venv
source packages/gateway/.venv/bin/activate
python -m pip install -r packages/gateway/requirements.txt
cp packages/gateway/.env.example packages/gateway/.env
```

活词与相邻的词鲸主项目共用认证与数据服务。开发时从词鲸项目读取权威私有配置，而不是使用本仓库 `packages/gateway/.env.example` 的占位值。启动本地网关：

```bash
npm run dev:gateway
```

需要停止网关时运行 `npm run stop:gateway`；它只会停止监听该端口的活词本地 Flask 进程。若启动时设置了自定义 `HUOCI_GATEWAY_PORT`，停止时也传入相同的端口值。

默认地址为 `http://127.0.0.1:5001`；可通过 `HUOCI_GATEWAY_PORT` 调整。这个本地入口只供网关代码联调；真机测试统一走已登记的线上 HTTPS 网关，不把局域网 HTTP 地址作为真机测试入口。

另开一个终端确认服务已经启动：

```bash
curl --noproxy '*' http://127.0.0.1:5001/healthz
# {"status":"ok"}
```

> 本地入口仅用于开发和联调。生产环境由 nginx 分流流量，并将蓝图挂载到词鲸的 Flask 进程中；请参阅 [网关说明](packages/gateway/README.md)。

## 本地联调范围

- 小程序可继续在微信开发者工具中以开发模式编译、预览和调试；请求仍指向已配置的线上 HTTPS 网关。
- 只有单独调试网关 Python 代码时才启动上面的本地服务，并使用 `.env` 中完整的 Supabase 和微信配置；这不替代小程序的线上网关联调。
- 真机测试不使用 `127.0.0.1`、局域网 HTTP 或本地 Flask；统一使用微信公众平台已登记的线上 HTTPS 网关。

## 常用检查

```bash
# 类型检查（会先同步共享代码和词包）
npm run typecheck

# 执行工作区测试
npm test

# 小程序静态检查与类型检查
npm run verify -w @huoci/miniprogram
```

## 数据库迁移

数据库迁移文件位于 `packages/db/migrations`。该项目与词鲸共用 Supabase 项目，迁移的执行入口和上线顺序见 [数据库说明](packages/db/README.md)。执行生产迁移前请先确认目标项目和待执行文件，避免直接在控制台粘贴 SQL。

## 进一步阅读

- [小程序开发说明](packages/miniprogram/README.md)
- [网关端点与部署说明](packages/gateway/README.md)
- [数据库迁移说明](packages/db/README.md)
