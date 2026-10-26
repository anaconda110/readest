# Readest AI 分析侧栏复现：迁移交接

- 更新日期：2026-10-26
- 工作树：`/home/oraw/projects/00.Program/readest-codex-ai-analysis-rail`
- 分支：`feat/ai-analysis-rail`
- 代码 HEAD：`729e9411 feat(ai): scope chapter analysis retrieval`
- 基线：`origin/main`
- 当前领先：22 个本地提交
- 提交策略：只允许本地 commit，**禁止 push**
- 当前工作树：clean

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
- 桌面端面板打开时，右侧入口放在 Notebook Header 内；面板收起后，入口仍显示在阅读器右上角。
- 左侧目录和右侧 AI 面板分别使用独立的 pinned/overlay 状态，可以同时展开。
- 移动端保持原有抽屉式交互，不强制显示桌面 AI rail。

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

## 3. 自动化验证

### 3.1 测试与静态检查

2026-10-26 复跑结果：

```text
Test Files  9 passed (9)
Tests       108 passed (108)
```

测试命令：

```bash
cd /home/oraw/projects/00.Program/readest-codex-ai-analysis-rail/apps/readest-app
pnpm exec dotenv -e .env -e .env.test.local -- vitest run --maxWorkers=2 \
  src/__tests__/ai/ai-store.test.ts \
  src/__tests__/reedy/TauriChatAdapter.test.ts \
  src/__tests__/reedy/AgentRuntime.test.ts \
  src/__tests__/reedy/BookRetriever.test.ts \
  src/__tests__/reedy/ReedyDb.test.ts \
  src/__tests__/reedy/builtins.test.ts \
  src/__tests__/reedy/lookupPassage.test.ts \
  src/__tests__/app/reader/components/notebook/AIAnalysisPanel.test.tsx \
  src/__tests__/app/reader/components/notebook/AIAssistantRuntime.test.tsx
```

不要使用 `pnpm test -- --run ...`，该命令会进入 watch 模式。

已通过：

- `pnpm exec tsc --noEmit`
- Biome lint（相关文件）
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

- 当前阅读窗口可以打开右侧 `AI 分析` 面板。
- 左侧目录与右侧 AI 面板可以同时展开。
- 五个页签全部渲染：`问答 / 本章分析 / 全书分析 / 笔记 / 搜索`。
- 搜索页输入框和索引入口正常显示。
- 索引页显示“索引这本书 / 开始索引”状态。
- 点击“收起 AI 分析面板”后，面板消失。
- 收起后“展开 AI 分析面板”入口存在，点击可重新展开。
- 无 `Oops!` 或 `_getInitializePromise` 错误。

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
SHA-256: 6246f8be67046ba0f4ecf889b298d2c0abb6e848208c68a09712a0b3cf23ee77
```

已复制到 Downloads：

```text
C:/Users/Tom/Downloads/Readest_0.12.16_x64-ai-analysis-rail-20261026-150040.exe
```

已替换安装目录：

```text
D:/Program Files/Readest/Readest.exe
SHA-256: 3f4fa9134c750c152092f67bdaba0bd22d36bcfddc66b81b6844fc4456b37bd5
```

该哈希与构建产物中的 `Readest.exe` 一致，新版已成功启动。

覆盖前备份：

```text
C:/Users/Tom/AppData/Local/Temp/Readest-before-ai-chapter-scope-20261026-150040.exe
SHA-256: 8cf3bd6934d7ab26f6b84841c8fe23c27238e0f1533e012bee68620c1a959960
```

## 5. 当前验证边界

真实 AI 问答仍需要：

- 有效的 AI/API 配置。
- 已完成书籍索引。

没有这些外部条件时，可验证：

- AI 面板展开/收起。
- 五页签渲染和切换。
- 索引入口与索引状态。
- 搜索界面与错误/未索引提示。
- 笔记编辑。
- 章节作用域相关单元测试。

本轮未额外覆盖：

- 有效密钥下的真实问答质量。
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
