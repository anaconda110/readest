# AI Reader V2 功能移植

本文件记录从 `mouseart2025/AI-Reader-V2` 移植到 Readest 阅读知识库的范围、
结构与后续工作。

## 分析来源

- 目标：`AI-Reader-V2`（React + Tauri 桌面应用，Python sidecar 负责抽取）
- REA：`analyze_javascript_application` 分析 `frontend/src`
- 覆盖：158 个相关文件，156 个 JS/TS 文件解析成功，0 个解析失败
- 人工核对：`backend/src/extraction/prompts/extraction_system.txt`、
  `backend/src/models/chapter_fact.py`、`frontend/src/pages/{Graph,Timeline,Encyclopedia}Page.tsx`

AI Reader V2 的核心不是章节摘要，而是把整本书拆成可计算的 `ChapterFact`：
人物、别名、关系、地点层级、物品、组织、概念、事件，并保留原文证据。

## 已移植

- 章节级结构化抽取：严格 JSON、禁用编造、关系必须有原文引文、别名必须有文本依据
- 跨章聚合：别名合并、规范名选择、关系去重、关系权重、出现章节、证据归档
- 人物列表与详情：别名、描述、关系、关键事件、原文依据、章节跳转
- 人物关系图谱：六类关系着色、关系权重/章数过滤、两人最短路径
- 时间线：按章分组、事件类型与重要度过滤、参与者/地点跳转、原文引文
- 地点层级：按 `parent` 关系渲染树
- 百科：概念、物品、组织统一检索与详情
- 本地持久化：每个章节的记录单独存入 IndexedDB（`readest-ai` v5）
- 全书批量分析：串行抽取、进度、取消、断点续跑、按章删除/整本清空

入口在笔记面板的 AI 区新增 `Knowledge`（知识库）标签页，与现有
`Q&A / Chapter Analysis / Book Analysis / Notes / Search` 并列。

## 未移植

- Leaflet/地形渲染的小说世界地图
- 系列圣经（series bible）、剧本视图、PDF/DOCX/XLSX 导出
- 多轮查漏补缺、冲突检测、层级审计/快照
- 实体改名/隐藏/改类型与别名合并的编辑工作流
- 派系、场景切分与逐场景摘要

这些能力依赖 AI Reader V2 的 Python sidecar 与多阶段校验流水线，不能直接
复制前端组件；需要按 Readest 的 TS/Tauri 架构重新设计。

## 成本与边界

每章一次模型调用，长章节会截断中段（保留开头与结尾）。批量分析默认串行，
失败时停止并在面板中给出错误，已完成的章节不会丢失。所有知识库数据只写入
本机 IndexedDB，不参与 Readest 同步。
