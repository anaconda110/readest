# Readest Fork 产品化评估

日期：2026-11-12
评估对象：`readest-recovery-ai-stats`（`recovery/ai-stats`，HEAD `c168591b`）
评估口径：代码与构建证据优先；不含真实用户测试、性能基准和法律意见。

---

## 0. 结论

**技术底子 A-，产品化就绪度 C，许可证风险 S（决定性）。**

- Readest 本体是成熟产品级阅读器：跨平台、格式全、阅读体验完整、CI 和测试体系健全。这部分不需要你从零证明。
- 你的 fork 已经形成差异化资产：AI 分析栏、结构化知识工作区、本地中文语义检索、阅读统计、全书连续滚动。156 个文件、+31,070 行，不是小补丁。
- 但它现在**不是一件可以直接卖的产品**：许可证是 AGPL-3.0，自动更新指向上游，品牌、包名、IAP、云服务全部绑在 Readest 官方基础设施上。
- **推荐路线：先做「内部自用 + 自托管内测」（Route B），不要直接商业发行。** 商业发行（Route C）的前置条件不是写代码，而是先解决 AGPL 和商标。

三条硬阻塞，按严重度排序：

1. **AGPL-3.0**：对外分发或提供网络服务，必须开源对应源码；闭源商用基本不可行。
2. **更新通道指向上游**：装上的 fork 会被 Readest 官方更新覆盖。
3. **云服务绑定**：默认 API、认证、同步、支付、统计全部指向 `readest.com` 体系。

---

## 1. 评估范围与方法

本评估基于以下证据：

- Git 状态与改动面：`git diff --shortstat upstream/main...HEAD`、`git log`。
- 构建与分发配置：`apps/readest-app/src-tauri/tauri.conf.json`、`.github/workflows/*`、`Dockerfile`。
- 运行时配置：`apps/readest-app/src/services/environment.ts`、`runtimeConfig.ts`、`constants.ts`。
- 功能实现：`apps/readest-app/src/services/ai/knowledge/*`、`KnowledgeWorkspace.tsx`。
- 测试：本地实跑 4 个测试文件 / 25 条测试，全部通过。
- 上游活跃度：`git log upstream/main` 按月统计。

未覆盖：

- 真实用户可用性测试与留存数据。
- 大书库（>1000 本）性能基准。
- 法律意见（AGPL 边界、商标、应用商店条款）。
- iOS / Android 真机发布链路。

---

## 2. 资产盘点

### 2.1 代码与工程规模

| 项目 | 数值 | 说明 |
|---|---|---|
| 版本 | `0.12.16` | `apps/readest-app/package.json` |
| 前端源码 | 43 MB | `apps/readest-app/src` |
| TS/TSX 文件 | 2,738 | 不含测试配置 |
| Rust 文件 | 68 | `src-tauri` |
| 测试文件 | 1,331 | `*.test.ts(x)` |
| 语言 | 35 个 locale | `public/locales` |
| 技术栈 | Next.js 16 + Tauri v2 | 跨 macOS/Windows/Linux/Android/iOS/Web |
| 包管理 | pnpm 11.1.1 | `packageManager` 字段 |

### 2.2 Fork 增量

| 指标 | 数值 |
|---|---|
| 领先上游 | 35 commits，0 behind |
| 改动文件 | 156 |
| 新增行 | 31,070 |
| 删除行 | 811 |
| 触及 reader 核心的提交 | 15 |
| AI knowledge 模块 | 1,998 行（aggregate/graph/schema/types/extract + KnowledgeWorkspace） |

核心提交：

- `c168591b feat(ai): add structured reading knowledge workspace`（4,006 行，23 文件）
- `585cbcb4 feat(reader): add full-book continuous scrolling`
- 阅读统计与自然周期洞察若干提交
- `1918687b feat(ai): harden local retrieval and analysis rail`

### 2.3 质量信号

- 4 个 AI 相关测试文件、25 条测试实跑通过（5.12s）。
- `MIGRATION_HANDOFF.md` 记录 Windows x64 NSIS 构建、静默覆盖安装、实机验收。
- 上游 CI 完整：`pull-request.yml`、`release.yml`、`codeql.yml`、`nightly.yml`、`docker-image.yml`。
- 但 fork 自己的验证边界仍有限，见 `MIGRATION_HANDOFF.md:297`：真实问答质量、模型切换、缓存清理、暗色/RTL/窄窗口、跨章节跳转一致性都未覆盖。

### 2.4 就绪度评分

| 维度 | 分数（1–5） | 依据 |
|---|---:|---|
| 阅读体验 | 5 | TTS、Read-Along、双书并行、无障碍、KOReader 同步 |
| 格式覆盖 | 5 | EPUB/PDF/MOBI/AZW3/FB2/CBZ/TXT/HTML/MD |
| 跨平台 | 5 | 六端代码与分发流程齐备 |
| 工程质量 | 4 | 1,331 测试文件 + 完整 CI，但 fork 验证面窄 |
| AI 能力 | 3.5 | 有差异化，但数据孤岛、无真实质量基线 |
| 数据同步 | 2 | AI 知识不参与同步，无导出 |
| 品牌独立性 | 1 | 包名、Scheme、IAP、域名全绑上游 |
| 许可证自由度 | 1 | AGPL-3.0 |
| 运维就绪 | 2.5 | 有 Docker 与自托管模式，但需自建 Supabase/对象存储 |
| 商业化就绪 | 1.5 | Stripe/IAP 是上游体系，fork 未接管 |

**技术均分约 4.3，产品化均分约 2.2。**

---

## 3. 产品化差距分析

### 3.1 P0：AGPL-3.0 许可证

证据：`LICENSE:1` 为 GNU AFFERO GENERAL PUBLIC LICENSE Version 3。

四种场景，义务完全不同：

| 场景 | 是否触发源码义务 | 说明 |
|---|---|---|
| 自己本机用，不分发 | 基本不触发 | 最安全的起点 |
| 自己服务器自用 | 有争议，按严格解释可能触发 §13 | 若“用户”只有你自己，风险低；若有他人远程交互，必须提供源码 |
| 分发给他人（安装包、镜像） | 触发 | 必须提供对应源码，且衍生作品仍为 AGPL |
| 闭源商业发行 | 不可行 | 不能把 AGPL 代码并入闭源产品 |

关键点：

- **可以收费**，但买到的人同时获得 AGPL 权利（再分发、看源码）。
- **商标不随许可证授予**：Readest 名称、Logo、域名不能默认沿用。
- **应用商店条款需要律师确认**：AGPL 的再分发自由与 Apple App Store 的 DRM/条款存在已知张力，不能凭经验拍板。
- 上游是单一版权人（90 天内 508 次提交来自 Huang Xin），**商业授权（双许可）在理论上有谈判空间**，但没有任何公开承诺，必须直接联系版权人。

建议动作：

1. 明确产品是「内部工具」「自托管服务」还是「对外发行」。
2. 对外发行前取得法律意见，或与上游谈商业授权。
3. 在仓库补 `license` 字段、NOTICE、版权归属说明。

### 3.2 P0：自动更新指向上游

证据：`apps/readest-app/src-tauri/tauri.conf.json:257-258`

```text
https://download.readest.com/releases/latest.json
https://github.com/readest/readest/releases/latest/download/latest.json
```

后果：

- 已安装的 fork 会检查并下载**上游**更新。
- 如果沿用上游签名公钥，上游签名能通过校验，你的 fork 会被静默替换成官方版。
- 这不是“以后再说”的问题，是第一次对外发版就会踩的坑。

修复清单：

1. `tauri signer generate` 生成**自己的**密钥对。
2. 更新 `updater.pubkey`，私钥只放 CI Secret。
3. 自建 `latest.json` 与安装包托管（对象存储 / GitHub Releases）。
4. 改掉两个 endpoint，并移除上游兜底地址。
5. 在 CI 中验证：安装旧版 → 触发更新 → 版本号与签名均指向自有通道。

工作量：3–5 人日（不含托管搭建）。

### 3.3 P0：品牌与身份未脱钩

证据：

- `tauri.conf.json:5`：`com.bilingify.readest`
- `mainBinaryName: readest`
- deep-link scheme：`readest://`
- `apps/readest-app/src/hooks/useAvailablePlans.ts:8-13`：IAP 产品 ID 全部是 `com.bilingify.readest.*`
- `constants.ts:964`：`READEST_WEB_BASE_URL = 'https://web.readest.com'`
- `constants.ts:962`：下载引导指向 `readest.com`

必须一次性替换：

| 项 | 影响 |
|---|---|
| Bundle identifier | 安装、签名、钥匙串、更新、商店 |
| 应用名 / 二进制名 | 安装目录、进程名、快捷方式 |
| Deep link scheme | 分享链接、登录回调、剪贴板导入 |
| IAP 产品 ID | iOS/macOS 内购 |
| 图标与启动图 | 商标与视觉 |
| 分享域名 | `web.readest.com/s/{token}` |
| 下载/更新域名 | 见 3.2 |

工作量：1–2 人周（含图标、文案、截图、商店素材）。

### 3.4 P0：云服务绑定

证据：

- `environment.ts:16`：`getBaseUrl()` 默认 `READEST_WEB_BASE_URL`。
- `constants.ts:965`：`READEST_NODE_BASE_URL = 'https://node.readest.com'`。
- `constants.ts:1002`：`READEST_PUBLIC_STORAGE_BASE_URL = 'https://storage.readest.com'`。
- `runtimeConfig.ts:1` 暴露的配置面：`supabaseUrl`、`supabaseAnonKey`、`apiBaseUrl`、`objectStorageType`、`selfHosted`、配额、字体 CDN。

依赖的上游服务面：

- Supabase：认证、数据库、部分存储。
- 对象存储 / R2：分享、Send to Readest 收件箱、公共资源。
- Stripe / Apple IAP：订阅与存储扩容。
- PostHog：产品分析。
- Sentry：错误上报。
- Readest Voice：GPU TTS 服务。
- `node.readest.com`：Node 专属 API。

好消息：**自托管模式是官方支持的**。`runtimeConfig.ts` 中 `selfHosted=true` 会解锁全部高级功能，`Dockerfile` + `docker-image.yml` 提供 standalone 镜像，配置可通过环境变量注入，无需重新构建。

坏消息：你要自建的不只是 Next.js，还包括 Supabase、对象存储，以及可选的支付/邮件/推送。工作量取决于你要保留多少云功能。

最小自托管集合（Route B）：

1. Next.js standalone 容器（官方 Dockerfile）。
2. Supabase（Postgres + Auth + Storage）。
3. 一个 S3 兼容对象存储（MinIO 即可）。
4. 关闭 Stripe/IAP、PostHog、Sentry，或替换为自建。
5. 配置 `API_BASE_URL`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`OBJECT_STORAGE_TYPE`、`SELF_HOSTED=true`。

工作量：3–6 人周（首次打通），之后每月 0.2–0.5 人周运维。

### 3.5 P1：AI 数据是孤岛

证据：

- `docs/ai-reader-v2-port.md:43`：所有知识库数据只写入本机 IndexedDB，不参与 Readest 同步。
- `KnowledgeWorkspace.tsx:55`：工作区直接读本地索引。

产品后果：

- 换设备、清缓存、重装即丢。
- 多端无法共享同一本书的知识图谱。
- 无法做“跨书知识库”这类增值功能。
- 用户无法导出，迁移成本高，反过来伤害留存。

三条可选路径：

| 方案 | 成本 | 适用 |
|---|---|---|
| 本地导出/导入（JSON/zip） | 3–5 人日 | Route A/B 最低要求 |
| 走现有文件同步（S3/WebDAV） | 1–2 人周 | 不想自建后端 |
| 服务端知识库（Supabase 表 + API） | 2–4 人周 | Route C |

建议：**先做导出/导入**，这是任何路线的通用底座。

### 3.6 P1：上游跟随成本

证据：

- 上游近三个月提交：2026-08 286、2026-09 260、2026-10 267（截至 10-24）。
- 90 天内 508 次提交来自 Huang Xin，项目实质是**单核心维护者高频推进**。
- 你的 fork 改动 156 个文件，其中 15 个提交触及 reader 核心。

三种策略：

| 策略 | 优点 | 缺点 | 适合 |
|---|---|---|---|
| 硬分叉，停止跟随 | 完全自主，无冲突 | 失去格式修复、平台适配、安全补丁 | 产品形态已稳定 |
| 定期 merge（月度） | 拿到上游修复 | 每月 1–2 周冲突处理，reader 核心最痛 | Route B/C 默认 |
| 上游优先，功能回馈 | 冲突最小，社区受益 | 差异化被上游吸收，且需接受 AGPL 协作 | 不想做商业产品 |

现实估算：按当前改动面，**每次月度 merge 约 3–5 人日**；遇到 reader 重构会翻倍。一年 8–15 人周。

### 3.7 P1：构建与分发

已有：

- `tauri.conf.json:45`：`targets: "all"`。
- `tauri.conf.json:195`：`createUpdaterArtifacts: true`。
- `release.yml` 覆盖 macOS 签名/公证、Windows 签名、Android 签名、GitHub Release。
- Windows x64 NSIS 已实机验证（`MIGRATION_HANDOFF.md:223`）。

缺口：

- Windows 代码签名证书（EV/OV）未接管。
- macOS Developer ID + 公证未接管。
- Linux 的 AppImage/deb/rpm 未做自有渠道验证。
- Android keystore、iOS 证书与 TestFlight 未接管。
- 商店素材、隐私标签、年龄分级未准备。

工作量：2–4 人周（不含证书采购等待时间）。

### 3.8 P1：可观测与运维

- 上游默认接 PostHog/Sentry，fork 不应把用户数据发到上游项目。
- 需要决定：完全关闭、自建 Sentry、或只保留本地日志。
- 自托管需要备份、升级、监控、日志轮转、证书续期。
- 当前 fork 只有单一健康工作树，`node_modules` 还是指向另一个工作树的 symlink（见 3.9），发布链路脆弱。

工作量：1–2 人周建立最小运维基线。

### 3.9 P1：仓库与构建环境脆弱

证据：

- `readest/`、`readest-codex-ai-analysis-rail/`、`readest-feat-full-book-scroll/` 的 git 元数据或对象库损坏。
- 唯一健康的 `readest-recovery-ai-stats` 中，`apps/readest-app/node_modules` 是指向 `readest-codex-ai-analysis-rail/...` 的 symlink。

风险：一旦清理坏工作树，构建立即失败；CI 无法复现本地状态。

修复动作：

1. 在健康工作树内重新 `pnpm install`，去掉跨工作树 symlink。
2. 归档或删除损坏工作树，避免误用。
3. 用 CI 作为唯一可信构建源，本地只做开发。

工作量：0.5–1 人日。

### 3.10 P2：隐私与合规

阅读类产品天然敏感：

- 书库内容、阅读时长、批注、搜索词。
- AI 请求可能包含原文片段。

必须明确：

- 哪些数据本地、哪些上云。
- AI 请求发往哪个提供商，是否保留、是否训练。
- 隐私政策、数据删除、账号注销、导出。
- 若面向欧盟/加州，GDPR/CCPA 的最小实现。

本地优先是 Readest fork 的卖点，**不要在商业化过程中把它弄丢**。

### 3.11 P2：本地化与中文体验

- 35 个 locale 是资产，但 fork 新增文案需要补 i18n。
- BGE Small ZH 模型默认从 `huggingface.co` 下载（`LocalEmbeddingModel.ts:93`），中国大陆网络不可直连，需要镜像或内置。
- AI 中文问答质量没有基线，需要固定书单做回归。

---

## 4. 产品定位建议

不要正面拼「书城 + 社交 + 推荐」。那不是这个 fork 的强项，也会把 AGPL 和内容版权问题放大。

推荐定位：

> **本地优先的深度阅读工作台：把你的书库变成可检索、可分析、可积累的私人知识库。**

差异化三件事：

1. **本地优先**：书和 AI 知识默认不出设备。
2. **中文语义检索**：BGE Small ZH + 结构化知识图谱。
3. **跨格式**：EPUB/PDF/MOBI/AZW3 同一套阅读与笔记体验。

目标用户：

- 长篇网文 / 系列小说读者（人物、关系、时间线）。
- 研究者、学生（跨章节检索、证据定位）。
- 自建书库用户（Calibre/WebDAV/S3/KOReader）。

明确不做：

- 不做书城。
- 不做社交 feed。
- 不做云端模型训练。
- 不在第一版做移动端全量功能。

---

## 5. 三条路线

### Route A：内部自用（1–2 周）

目标：你自己和少量可信用户稳定使用。

必做：

- 换掉更新通道（否则会被上游覆盖）。
- 改 bundle id / 应用名（避免与官方版冲突）。
- 本地导出 AI 知识。
- 关闭 PostHog/Sentry 上报。

不做：自托管后端、商店发行、支付。

成本：3–5 人日。
风险：低。

### Route B：自托管内测（4–8 周）

目标：10–100 个用户通过你自己的域名使用 Web 版或桌面版。

必做：

- Route A 全部。
- 自建 Next.js + Supabase + MinIO。
- 自建更新通道与安装包托管。
- 账号、备份、隐私政策、删除账号。
- 固定书单的 AI 质量回归。

可选：文件同步（S3/WebDAV）替代自建云同步。

成本：8–12 人周。
风险：中（运维、Supabase 升级、对象存储）。

### Route C：商业发行（3–5 个月 + 法务）

目标：对外收费、上架商店。

前置条件（缺一不可）：

1. AGPL 方案落定：开源发行 / 商业授权 / 换基座。
2. 商标与品牌脱钩完成。
3. 支付体系（Stripe 或 IAP）自有。
4. 商店签名、公证、隐私标签完成。
5. 客服、退款、SLA、数据删除流程。

成本：25–40 人周 + 法务费用。
风险：高（许可证是生死项）。

### 决策矩阵

| 维度 | Route A | Route B | Route C |
|---|---|---|---|
| 成本 | 极低 | 中 | 高 |
| 时间 | 1–2 周 | 4–8 周 | 3–5 月 |
| 许可证风险 | 低 | 中 | 高 |
| 可收费 | 否 | 可选 | 是 |
| 可上架 | 否 | 否 | 是 |
| 运维负担 | 无 | 中 | 高 |
| 推荐度 | ★★★★ | ★★★★★ | ★★（先解法务） |

---

## 6. 工作量估算

假设：1 名高级全栈 + 0.5 名设计 + 法务外部支持。

| 工作流 | Route B | Route C 追加 |
|---|---:|---:|
| 许可证与法务 | 0（内部） | 2–6 周（外部） |
| 品牌与身份脱钩 | 3–5 人日 | +1 人周（商店素材） |
| 更新通道 | 3–5 人日 | +2 人日（多平台） |
| 自托管后端 | 3–6 人周 | +2 人周（扩容/备份） |
| AI 数据导出/同步 | 3–5 人日 | +2–4 人周（服务端知识库） |
| 支付 | 0 | 3–5 人周 |
| 签名/公证/商店 | 0–2 人日 | 2–4 人周 |
| QA 与回归 | 1–2 人周 | 3–4 人周 |
| 文档/客服/隐私 | 3–5 人日 | 1–2 人周 |
| 上游 merge（一次性） | 3–5 人日 | 同左，之后每月 3–5 人日 |
| **合计** | **8–12 人周** | **25–40 人周 + 法务** |

---

## 7. 里程碑

### M0：合规与品牌冻结（1 周）

验收：

- 明确路线（A/B/C）。
- 明确许可证策略。
- 确定产品名、包名、Scheme、域名。
- 更新通道切换到自有密钥与自有 endpoint。

### M1：自托管可运行（2–3 周）

验收：

- 一条命令起完整栈（Next.js + Supabase + MinIO）。
- 注册/登录/同步/分享可用。
- `SELF_HOSTED=true` 下无付费墙。
- 无任何请求发往 `readest.com`。

### M2：数据可携带（2 周）

验收：

- AI 知识库可导出/导入。
- 换设备后知识图谱不丢。
- 有固定书单的检索与问答回归集。

### M3：内测发布（2 周）

验收：

- 自有安装包 + 自有更新通道。
- 10 个真实用户完成“导入书 → 阅读 → 提问 → 导出”闭环。
- 崩溃率、AI 失败率有基线。

### M4：商业发行（另议）

仅在 AGPL 与商标问题解决后启动。

---

## 8. 风险登记

| 级别 | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| P0 | AGPL 导致无法闭源商用 | 高 | 致命 | 先定许可证策略；必要时谈商业授权或换基座 |
| P0 | 上游更新覆盖 fork | 高 | 致命 | 立即轮换签名密钥与更新 endpoint |
| P0 | 品牌侵权 | 中 | 高 | 全面改名、换图标、换域名 |
| P1 | 上游高频推进导致 merge 失控 | 高 | 中高 | 月度 merge + 核心文件冲突预案 |
| P1 | 自托管 Supabase 运维复杂 | 中 | 中 | 用托管 Postgres 或收敛功能 |
| P1 | AI 数据丢失 | 高 | 中高 | 先做导出/导入 |
| P1 | 构建环境依赖坏工作树 | 高 | 中 | 重新安装依赖，CI 为唯一构建源 |
| P1 | HuggingFace 下载失败 | 中 | 中 | 模型镜像/内置 |
| P2 | 隐私合规缺口 | 中 | 中 | 最小隐私政策与删除流程 |
| P2 | 商店审核/公证失败 | 中 | 中 | 提前准备证书与素材 |

---

## 9. 需要人类 Owner 拍板的 6 件事

1. **许可证路线**：AGPL 开源发行、谈商业授权、还是换基座？
2. **分发形态**：自托管 Web、桌面优先、还是全平台？
3. **云同步**：保留上游式云同步，还是只做文件同步（S3/WebDAV）？
4. **AI 数据**：只存本地，还是上云做跨设备知识库？
5. **品牌**：新名字、域名、图标谁定，何时冻结？
6. **上游策略**：硬分叉还是月度 merge？

---

## 10. 与 novel_reader 的关系

- **Readest fork** 适合做长期产品壳：成熟阅读体验 + 跨平台 + 本地 AI 工作区。
- **novel_reader** 适合做短期验证切片：轻、改动半径小、G0 契约已围绕它成型。
- 不建议现在静默换基座。若决定以 Readest 为主，应回 `#proj-reader` 让 `Tao`/`Tenny` 重开基座评估。
- 可行组合：`novel_reader` 继续 G0 验证交互假设；Readest 走 M0–M1，验证自托管与更新通道。两条线在“AI 知识如何呈现”上共享结论。

---

## 11. 检验问题

1. 如果产品要闭源收费，AGPL 具体要求你交付什么？为什么“只卖二进制”不行？
2. 为什么自动更新指向上游是 P0，而不是一个配置小问题？
3. 你的 AI 知识库现在存在哪里？换设备后为什么可能全部丢失？

---

## 12. 附录：证据索引

| 主题 | 文件 / 命令 |
|---|---|
| 许可证 | `LICENSE:1` |
| 应用身份 | `apps/readest-app/src-tauri/tauri.conf.json:5` |
| 更新通道 | `apps/readest-app/src-tauri/tauri.conf.json:257-258` |
| 默认 API 地址 | `apps/readest-app/src/services/environment.ts:16` |
| Web/Node/存储域名 | `apps/readest-app/src/services/constants.ts:964-1002` |
| 自托管配置 | `apps/readest-app/src/services/runtimeConfig.ts:1` |
| AI Provider | `apps/readest-app/src/services/ai/providers/index.ts:8` |
| OpenRouter 自定义 baseUrl | `apps/readest-app/src/services/ai/constants.ts:36` |
| 本地嵌入模型来源 | `apps/readest-app/src/services/ai/rag/LocalEmbeddingModel.ts:93` |
| 知识工作区 | `apps/readest-app/src/app/reader/components/notebook/KnowledgeWorkspace.tsx:55` |
| 数据不参与同步 | `docs/ai-reader-v2-port.md:43` |
| 验证边界 | `MIGRATION_HANDOFF.md:297` |
| Windows 构建 | `MIGRATION_HANDOFF.md:223` |
