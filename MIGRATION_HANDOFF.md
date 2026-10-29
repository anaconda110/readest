# Readest AI 分析侧栏复现：迁移交接

- 更新日期：2026-10-26
- 工作树：`/home/oraw/projects/00.Program/readest-codex-ai-analysis-rail`
- 分支：`feat/ai-analysis-rail`
- 功能提交：`1918687b feat(ai): harden local retrieval and analysis rail`
- 交接文档：本次 `docs: update AI analysis rail handoff` 提交
- 基线：`origin/main`
- 当前领先：26 个本地提交
- 提交策略：只允许本地 commit，**禁止 push**
- 当前工作树：交接文档提交后 clean

## 1. 结论

`ai-novel-reader-v2` 的阅读界面右侧 AI 展开栏已经在 Readest 中完成复现，并已打包为 Windows x64 NSIS 安装包、覆盖安装到当前 Readest 安装目录。

已实现的核心目标：

- 桌面端左侧目录与右侧 AI 面板可以同时展开。
- 右侧 AI 面板包含五个入口：`问答 / 本章分析 / 全书分析 / 笔记 / 搜索`。
- 收起/展开入口使用与左侧目录一致的行为和视觉语言。
- 桌面端 AI rail 在面板收起时仍保持可见。
- 笔记页可以正常编辑；搜索页可以启动索引、展示进度并检索结果。
- “本章分析”只检索当前章节；“全书分析”会清除章节作用域。
- Legacy IndexedDB 和 Reedy 两条检索路径都支持章节过滤。
- 本地检索已支持 `BGE Small ZH` 语义模型，索引完成后搜索返回真实书中片段。
- AI 设置可切换检索引擎、TF-IDF 降级、动态 Top-K、模型缓存软上限与清缓存。
- en、zh-CN、zh-TW 三套翻译已同步。

## 2. 功能实现

### 2.1 五页签面板

主要文件：

- `apps/readest-app/src/app/reader/components/notebook/AIAnalysisPanel.tsx`
- `apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx`
- `apps/readest-app/src/app/reader/components/notebook/Notebook.tsx`
- `apps/readest-app/src/app/reader/components/notebook/NotebookAIToggler.tsx`
- `apps/readest-app/src/app/reader/components/notebook/Header.tsx`

实现内容：

- 标准 `tablist/tab/tabpanel` ARIA 结构。
- 左右方向键、Home、End 切换页签焦点。
- “本章分析”和“全书分析”作为动作页签，切回问答并提交分析 Prompt。
- “笔记”复用 `NotebookEditor`。
- “搜索”复用问答检索索引，支持语义/关键词结果、跳转和索引启动。
- 搜索异常覆盖：未索引、空索引、模型不一致、降级文本匹配、backend 缺失、索引检查失败、索引/搜索异常。
- 索引失败时优先展示错误信息，不再被“需要索引”提示覆盖。
- AI 模式不显示底部重复的“笔记/AI”导航；笔记模式仍保留原导航。

### 2.2 左右侧栏同时展开

- 左侧目录使用原有 `SidebarToggler` / `SideBar`。
- 右侧 AI 使用新增 `NotebookAIToggler`。
- 桌面端面板打开时，阅读顶栏的右侧工具组整体移入 Notebook Header 渲染；面板收起后回到书区 Header。两个宿主共用 `HeaderRightTools`（笔记本、视图菜单、AI 入口、窗口按钮），按钮在窗口右上角的位置和间距在两种状态下保持一致，关闭按钮始终位于右上角。书区 Header 在面板展开时不再渲染这组工具，避免出现两份。
- 移动端维持原状：工具组留在书区 Header（面板全屏遮挡），AI 入口照旧在面板展开时隐藏。
- 左侧目录和右侧 AI 面板分别使用独立的 pinned/overlay 状态，可以同时展开。

### 2.3 本章分析检索作用域

相关文件：

- `apps/readest-app/src/services/ai/adapters/TauriChatAdapter.ts`
- `apps/readest-app/src/services/ai/adapters/LegacyIdbBackend.ts`
- `apps/readest-app/src/services/ai/ragService.ts`
- `apps/readest-app/src/services/ai/storage/aiStore.ts`
- `apps/readest-app/src/services/reedy/db/ReedyDb.ts`
- `apps/readest-app/src/services/reedy/retrieval/BookRetriever.ts`
- `apps/readest-app/src/services/reedy/runtime/AgentRuntime.ts`
- `apps/readest-app/src/services/reedy/tools/lookupPassage.ts`
- `apps/readest-app/src/services/reedy/tools/builtins/lookupPassage.ts`
- `apps/readest-app/src/services/reedy/tools/types.ts`
- `apps/readest-app/src/services/reedy/ui/ReedyAssistant.tsx`
- `apps/readest-app/src/services/reedy/ui/useReedyTurn.ts`

实现要点：

- “本章分析”把当前章节 CFI/href 作为一次性作用域排队。
- 该作用域只影响下一轮检索，不会永久污染后续问答。
- 固定章节作用域优先于模型自行选择的 section。
- “全书分析”会显式清除章节作用域。
- Reedy `lookupPassage` 和 Legacy system-prompt retrieval 都接收同一章节过滤语义。
- 新增/更新了对应单元测试，覆盖一次性消费、章节过滤和全书清除作用域。

### 2.4 AI runtime 初始化补丁

历史实机问题：

```text
TypeError: Cannot set properties of undefined (setting '_getInitializePromise')
```

根因位于 `@assistant-ui/react@0.11.58`：方法从 runtime core 取出后丢失接收者。保留依赖版本，使用最小补丁：

- `patches/@assistant-ui__react@0.11.58.patch`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`

修复：

```diff
-setGetInitializePromise(() => initPromiseRef.current);
+setGetInitializePromise.call(runtimeCore, () => initPromiseRef.current);
```

回归测试：

- `apps/readest-app/src/__tests__/app/reader/components/notebook/AIAssistantRuntime.test.tsx`

### 2.5 本地检索与缓存

主要文件：

- `apps/readest-app/src/services/ai/rag/engines.ts`
- `apps/readest-app/src/services/ai/rag/LocalEmbeddingModel.ts`
- `apps/readest-app/src/services/ai/rag/settings.ts`
- `apps/readest-app/src/services/ai/rag/topK.ts`
- `apps/readest-app/src/components/settings/AIPanel.tsx`

实现内容：

- 检索引擎包括内置 TF-IDF、`BGE Small ZH`、`GTE Small`、`Multilingual E5 Small`、`All-MiniLM-L6-v2`、`Multilingual MiniLM L12`。
- 语义模型通过 `@xenova/transformers` 在本地加载，模型文件写入浏览器缓存。
- 默认启用 TF-IDF fallback；语义模型无法加载时仍可完成词法检索。
- Top-K 默认值为 30，按索引 chunk 数自动提升到 15、30、50 或 80，并限制在 1–100。
- 模型缓存软上限默认 `256 MB`，可配置 `32–4096 MB`；加载后按最旧优先清理，当前活跃模型保留。
- 设置页提供模型状态刷新、fallback 开关、默认 Top-K、缓存上限和清除缓存。

## 3. 自动化验证

### 3.1 测试与静态检查

2026-10-26 复跑结果：

```text
Test Files  13 passed (13)
Tests       106 passed (106)
```

测试命令：

```bash
cd /home/oraw/projects/00.Program/readest-codex-ai-analysis-rail/apps/readest-app
pnpm exec dotenv -e .env -e .env.test.local -- vitest run --maxWorkers=2 \
  src/__tests__/ai/ai-store.test.ts \
  src/__tests__/ai/analysisService.test.ts \
  src/__tests__/ai/constants.test.ts \
  src/__tests__/ai/rag-cache.test.ts \
  src/__tests__/ai/rag-indexing.test.ts \
  src/__tests__/app/reader/components/notebook/AIAnalysisPanel.test.tsx \
  src/__tests__/app/reader/components/notebook/AIAssistantRuntime.test.tsx \
  src/__tests__/components/settings/AIPanel.test.tsx \
  src/__tests__/reedy/BookIndexer.test.ts \
  src/__tests__/reedy/BookRetriever.test.ts \
  src/__tests__/reedy/registry.test.ts \
  src/__tests__/reedy/retrievalBackend.test.ts \
  src/__tests__/store/ai-analysis-store.test.ts
```

不要使用 `pnpm test -- --run ...`，该命令会进入 watch 模式。

已通过：

- `pnpm exec tsc --noEmit`
- Biome lint（36 个相关文件，No fixes applied）
- JSON 本地化文件校验
- `git diff --check`

### 3.2 Windows 实机 UI 验证

由于 `mcp__node_repl.js` 返回：

```text
sandboxCwd is not a local file URI: file:///home/oraw/projects/00.Program/readest
```

本轮改用 Windows UI Automation 验证安装后的桌面应用。

临时工具目录：

```text
C:/Users/Tom/AppData/Local/Temp/readest-uia
```

调用解释器：

```text
C:/ProgramData/anaconda3/python.exe
```

已验证：

- 窗口已恢复最大化，实机尺寸为 `1928×1048`。
- 当前阅读窗口可以打开右侧 `AI 分析` 面板。
- 左侧目录与右侧 AI 面板可以同时展开。
- 五个页签全部渲染：`问答 / 本章分析 / 全书分析 / 笔记 / 搜索`。
- 搜索页输入框和索引入口正常显示。
- 收起/展开实测结果：`OPEN_INITIAL=True COLLAPSED=True EXPAND_ENTRY=True EXPANDED=True SEARCH_TAB=True`。
- 五个页签逐项选择结果：每项均为 `selected=True pane=True`。
- 索引实机进度覆盖 `loading-model / preparing / chunking / embedding / indexing`，观察到 `1039 / 1040` 个章节、`ProgressBar: 100%`。
- 索引完成后搜索 `张元清`，返回本书真实片段，包含章节名与 `1.00 / 0.98 / 0.92` 等相关度。
- 搜索页左上显示当前语义引擎 `BGE Small ZH`，说明模型已加载并用于本地检索。
- 未观察到 `Oops!`、`_getInitializePromise` 或 CSP 错误。

UI Automation 标识：

- 面板：`notebook-panel`
- 页签：`ai-analysis-tab-qa/chapter/book/notes/search`
- 收起按钮 Name：`收起 AI 分析面板`
- 展开按钮 Name：`展开 AI 分析面板`
- 问答面板：`ai-analysis-panel-qa`

验证截图（临时文件）：

```text
C:/Users/Tom/AppData/Local/Temp/readest-toc-ai-shortcut.png
C:/Users/Tom/AppData/Local/Temp/readest-current-reader.png
C:/Users/Tom/AppData/Local/Temp/readest-live.png
```

## 4. Windows 构建与安装

Windows x64 构建副本：

```text
C:/Users/Tom/AppData/Local/Temp/readest-win-build-20261026
```

构建目标必须使用：

```text
x86_64-pc-windows-msvc
```

构建命令形态：

```powershell
cd C:\Users\Tom\AppData\Local\Temp\readest-win-build-20261026\apps\readest-app
pnpm exec tauri build --target x86_64-pc-windows-msvc --bundles nsis --config C:\Users\Tom\AppData\Local\Temp\tauri-no-updater.json
```

要求：

- 不要使用仓库里的 `build-win-x64`，它固定为 `i686-pc-windows-msvc`。
- 不要修改正式 `tauri.conf.json`。
- 源码晚于上次前端构建时，必须重新执行 Tauri build，让 `beforeBuildCommand` 重新生成 `out`。

最新 NSIS：

```text
C:/Users/Tom/AppData/Local/Temp/readest-win-build-20261026/target/x86_64-pc-windows-msvc/release/bundle/nsis/Readest_0.12.16_x64-setup.exe
SHA-256: 8111b8912a79ee11ca7b7efa5c3ec666d9638e218c9ad5b7b751ce0989fdb4e0
```

已复制到 Downloads：

```text
C:/Users/Tom/Downloads/Readest_0.12.16_x64-ai-analysis-rail-20261026-181131.exe
SHA-256: 8111b8912a79ee11ca7b7efa5c3ec666d9638e218c9ad5b7b751ce0989fdb4e0
```

已替换安装目录：

```text
D:/Program Files/Readest/Readest.exe
SHA-256: e5d9cb9899a3befccb1e34661af1906dbad55d6b2aeef74901e9347ec7672eba
```

NSIS 静默覆盖安装退出码为 `0`，安装后版本为 `0.12.16`，已启动并完成上述实机验收。

构建主程序：

```text
C:/Users/Tom/AppData/Local/Temp/readest-win-build-20261026/target/x86_64-pc-windows-msvc/release/readest.exe
SHA-256: 4dcc371506515dbdd8233b88eaa395eca1d20fc49becf13e868402dc97157007
```

安装后哈希与构建主程序不完全相同；`cmp` 仅在以下三个连续字节出现差异：

```text
offset 80508273–80508275
构建产物：ASCII UNK
安装后：  ASCII NSS
```

其余文件内容一致，判定为 NSIS 安装/资源标记差异，不影响已启动版本的功能。

覆盖前备份：

```text
C:/Users/Tom/AppData/Local/Temp/Readest-before-ai-analysis-rail-20261026.exe
SHA-256: 7012142ba5023d551fb8f194111891d080a8da2fc5a8ebf6ba8148ba291dcfba
```

## 5. 当前验证边界

真实 AI 问答质量仍需要：

- 有效的 AI/API 配置。

本轮已确认：

- AI 面板展开/收起。
- 五页签渲染和切换。
- 索引进度与完成状态。
- `BGE Small ZH` 本地语义索引和真实搜索结果。
- 笔记编辑。
- 章节作用域相关单元测试。

本轮未额外覆盖：

- 有效密钥下的真实问答质量。
- 所有可选语义模型的逐个下载与切换。
- 大缓存超过软上限后的完整磁盘清理实机演练。
- 暗色、RTL、窄窗口的逐项实机截图。
- 搜索命中后跨章节跳转的最终内容一致性。

## 6. 提交与环境约束

分支命名沿用用户指定名称：

```text
feat/ai-analysis-rail
```

本地提交完成后再次确认：

```bash
git status --short
git diff --check
```

环境约定：

- Windows / Git Bash，使用 Unix 语法和正斜杠路径。
- 优先使用 `rg`、`fd`、`bat`、`jq`。
- 仓库统一 LF，不运行 `dos2unix`，不批量“修复”换行。
- 不安装系统依赖，不执行管理员命令。
- 只允许本地 commit，**禁止 push**。
