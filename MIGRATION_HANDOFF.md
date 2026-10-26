# Readest AI 分析侧栏复现：迁移交接

- 更新日期：2026-10-26
- 仓库：`/home/oraw/projects/00.Program/readest`
- 分支：`feat/reading-statistics`
- 当前基线：`353b04c9 fix(reader): align AI entry with sidebar toggle`
- 当前重点：修复打开右侧 AI 面板时 `@assistant-ui/react` runtime 初始化崩溃。
- 提交策略：只允许本地 commit，**禁止 push**。

## 1. 任务目标

复现 `ai-novel-reader-v2` 阅读界面右侧的 AI 展开栏。桌面端左侧目录与右侧 AI 面板可以同时展开，AI 面板包含五个入口：

`问答 / 本章分析 / 全书分析 / 笔记 / 搜索`

目标视觉参考：

`C:/Users/Tom/AppData/Local/Temp/codex-clipboard-73ea72ec-dc06-410a-b2db-e0e07cce770b.png`

关键视觉与交互：

- 左侧目录约 208px。
- 右侧 AI 面板约 309px，收起后的边缘 rail 为 32×85px。
- 五个页签紧排，顶部显示当前检索/嵌入模型。
- 搜索占位符为“输入关键词或语义查询...”。
- AI 模式不显示底部重复的“笔记/AI”导航。
- 点击“本章分析”或“全书分析”切回问答并提交对应分析 Prompt。

## 2. 已完成内容

### 2.1 五页签 AI 面板

新增：

- `apps/readest-app/src/app/reader/components/notebook/AIAnalysisPanel.tsx`

实现：

- 标准 `tablist/tab/tabpanel` ARIA 结构。
- 左右方向键、Home、End 切换页签焦点。
- “本章分析”和“全书分析”作为动作页签，切回问答后提交分析 Prompt。
- “笔记”复用 `NotebookEditor`。
- “搜索”复用问答所用检索索引，支持语义/关键词结果、跳转和索引启动。
- 搜索异常覆盖：未索引、空索引、模型不一致、降级文本匹配、backend 缺失、索引检查失败、索引/搜索异常。
- 索引失败时优先展示错误信息，不再被“需要索引”提示覆盖。

### 2.2 两种 AI runtime 均已接入

相关文件：

- `apps/readest-app/src/app/reader/components/notebook/AIAssistant.tsx`
- `apps/readest-app/src/services/reedy/ui/ReedyAssistant.tsx`

Legacy runtime：

- `AIAssistantChat` 和 `AIAssistantWithRuntime` 接入共享五页签外壳。
- 分析动作通过 `runtime.thread.append()` 提交。
- 搜索页使用同一个 `RetrievalBackend`，结果可通过 CFI 或页码跳转。

Reedy agent runtime：

- `ReedyAssistant` 将索引状态上报给外层页签。
- “本章分析/全书分析”通过 `promptRequest` 队列发送，避免在未索引时提前提交。
- 搜索页通过 `onIndexActionChange` 调用 `ReedyAssistant` 的真实索引动作。
- 搜索页索引期间显示进度、禁用搜索框，完成后重新检查索引状态。

### 2.3 Notebook 与 rail

相关文件：

- `apps/readest-app/src/app/reader/components/notebook/Notebook.tsx`
- `apps/readest-app/src/app/reader/components/notebook/Header.tsx`
- `apps/readest-app/src/app/reader/components/notebook/NotebookAIRail.tsx`

- AI 模式隐藏底部 `NotebookTabNavigation`；笔记模式仍保留。
- AI 模式标题显示“AI 分析”。
- 桌面端收起时 rail 固定在屏幕右侧居中，展开时附着在 Notebook 左边缘。
- 点击浮层会自动切到 AI 页并打开 Notebook。
- 桌面端 rail 始终可见，即使 `aiSettings.enabled=false` 也不隐藏；移动端仍隐藏。
- 笔记页展开时，附着 rail 会从“收起”状态切换为“展开 AI”，点击后切到 AI 页而不关闭 Notebook。
- AI 未启用时仍显示完整五页签：问答页展示启用说明与“打开 AI 设置”，笔记可正常使用，搜索显示未启用提示。
- 生产构建开放 Settings 对话框的 AI 设置页，避免按钮跳到不可用页面。

### 2.4 Retrieval backend 扩展

相关文件：

- `apps/readest-app/src/services/ai/adapters/retrievalBackend.ts`
- `apps/readest-app/src/services/ai/adapters/LegacyIdbBackend.ts`
- `apps/readest-app/src/services/ai/adapters/ReedyBackend.ts`
- `apps/readest-app/src/services/ai/adapters/index.ts`

- 新增 `searchBook()` 统一搜索结果类型和状态。
- Legacy 使用 `hybridSearch()`。
- Reedy 使用 `BookRetriever.search()`，保留 CFI。
- 新增 `getEmbeddingModelName()`，统一面板引擎提示。

### 2.5 国际化

同步修改：

- `apps/readest-app/public/locales/en/translation.json`
- `apps/readest-app/public/locales/zh-CN/translation.json`
- `apps/readest-app/public/locales/zh-TW/translation.json`

已修复 zh-CN / zh-TW 中重复的 `Section {{index}}` key。

### 2.6 AI runtime 初始化崩溃修复

用户实机截图显示，点击右侧 AI 入口后整页进入 `Oops!` 错误边界，错误为：

```text
TypeError: Cannot set properties of undefined (setting '_getInitializePromise')
at __internal_setGetInitializePromise
```

根因位于 `@assistant-ui/react@0.11.58`：`RemoteThreadListHookInstanceManager` 从 runtime core 取出 `__internal_setGetInitializePromise` 后直接调用，丢失了方法接收者，导致方法内部 `this` 为 `undefined`。

保持现有依赖版本，新增最小兼容补丁：

- `patches/@assistant-ui__react@0.11.58.patch`
- `pnpm-workspace.yaml` 的 `patchedDependencies`
- `pnpm-lock.yaml` 的 patch hash

核心修复：

```diff
-setGetInitializePromise(() => initPromiseRef.current);
+setGetInitializePromise.call(runtimeCore, () => initPromiseRef.current);
```

新增回归测试：

```text
apps/readest-app/src/__tests__/app/reader/components/notebook/AIAssistantRuntime.test.tsx
```

该测试在打补丁前可复现同一 `_getInitializePromise` 异常，打补丁后通过。

## 3. 测试与静态检查

截至本交接更新时已通过：

```text
AIAssistantRuntime + AIAnalysisPanel + NotebookResize + HeaderBar
4 test files passed
34 tests passed

NotebookAIRail.browser.test.tsx
1 test file passed
2 tests passed

pnpm exec tsc --noEmit
通过

Biome lint（15 个相关文件）
通过

git diff --check
通过
```

注意：运行普通 Vitest 前需要加载 `.env` / `.env.test.local`。仓库脚本 `pnpm test` 已包含 dotenv；手工直接运行 Vitest 时需先注入环境变量，否则 `src/utils/supabase.ts` 会因缺少 base64 环境变量失败。

## 4. Windows 构建与安装状态

Windows x64 NSIS 使用原生 Windows 副本构建：

```text
C:/Users/Tom/AppData/Local/Temp/readest-win-build-20261026
```

构建命令：

```powershell
cd C:\Users\Tom\AppData\Local\Temp\readest-win-build-20261026\apps\readest-app
pnpm exec tauri build --target x86_64-pc-windows-msvc --bundles nsis --config C:\Users\Tom\AppData\Local\Temp\tauri-no-updater.json
```

要求：

- 不要使用仓库里的 `build-win-x64`，它固定为 `i686-pc-windows-msvc`。
- 不要修改正式 `tauri.conf.json`。
- 最新源码修改晚于当前构建的前端 `next build` 时，必须同步源码后重新运行 Tauri build，让 `beforeBuildCommand` 重新生成 `out`。Cargo 通常会增量编译。

预期产物位置：

```text
C:/Users/Tom/AppData/Local/Temp/readest-win-build-20261026/target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

2026-10-26 12:57 已完成包含 runtime 修复的 Windows x64 构建，并复制为：

```text
C:/Users/Tom/Downloads/Readest_0.12.16_x64-ai-runtime-fix-20261026-125750.exe
SHA-256: 217d06552bebfbf06958ef91e195fd0dc57dd722875304dd21bb79f9f9a18ad9
```

为保证现有环境立即使用最新版本，已先关闭旧进程，再将构建产物中的 `Readest.exe` 覆盖到：

```text
D:\Program Files\Readest\Readest.exe
```

构建产物与安装目录可执行文件 SHA-256 均为：

```text
8cf3bd6934d7ab26f6b84841c8fe23c27238e0f1533e012bee68620c1a959960
```

已保留覆盖前备份：

```text
C:/Users/Tom/AppData/Local/Temp/Readest-before-ai-runtime-fix-20261026-125750.exe
SHA-256: 73585055ba4db8ff8511782948d99d487b0ad8c107abb0117587b2d1a09055b5
```

## 5. 验证状态与待办

已完成：

- 最新源码已同步到 Windows 构建副本。
- Tauri build 已重新生成 `out` 并完成 NSIS 打包。
- 已确认两个阅读器前端 chunk 均编译为带接收者的调用：

```text
"function"==typeof t&&t.call(e,()=>l.current)
```

- 现有安装目录的可执行文件已替换为最新构建，版本哈希一致。
- 修复版 Readest 已重新启动。
- 已确认用户配置中 `aiSettings.enabled=false`；旧版会因此隐藏整个 rail，新构建已移除此前提。
- 已确认构建产物包含 `Expand AI panel` / `Collapse AI panel`，不是仅源码修改。

本轮 Computer Use 初始化返回 `sandboxCwd is not a local file URI`，无法自动接管 Windows 窗口完成点击复核；该限制不影响补丁、回归测试和安装包构建结果。

仍需在可交互桌面点击右侧 AI 入口实机确认：

- 不再出现 `Oops!` / `_getInitializePromise` 错误。
- 右侧面板可展开、再次点击可收起。
- 左目录与右 AI 面板同时展开。
- 五个页签完整且密度接近参考图。
- 问答发送正常。
- 本章分析、全书分析提交对应 Prompt。
- 笔记可编辑。
- 搜索可索引、检索和跳转。
- 暗色、RTL、窄窗口。
- AI 模式没有底部重复导航。
- 真实 AI 问答需要有效 API 配置；没有密钥时只能验证到索引、搜索和错误提示链路。

## 6. 提交

全部验证完成后做本地 commit，禁止 push：

```bash
git add MIGRATION_HANDOFF.md \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  patches/@assistant-ui__react@0.11.58.patch \
  apps/readest-app/src/__tests__/app/reader/components/notebook/AIAssistantRuntime.test.tsx
git commit -m "fix(reader): patch assistant runtime initialization"
```

提交后再次确认没有意外包含 submodule 检出状态或其他无关文件。
