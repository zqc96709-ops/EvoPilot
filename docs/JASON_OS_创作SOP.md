# EvoPilot 创作与交付 SOP

> **用途**：把 EvoPilot 从产品定位、架构约束、模块开发、UI 验证到桌面应用交付，整理成可复用的标准作业流程。
> **适用对象**：独立开发者、小团队、产品型 AI Coding 工作流。
> **当前项目**：EvoPilot，React + TypeScript + Vite + Tauri + Rust + SQLite。
> **核心原则**：先确认真实架构，再做最小增量；Local-first；用户最终控制；每个阶段均可验证、可回滚、可交付。

---

## 0. 成功标准与不可违反的边界

### 0.1 产品一句话

EvoPilot 是一个 **Local-first、Desktop-first 的 Personal Operating System**：

```text
Capture → Plan → Focus → Work → Time → Result → Review
→ Insight → Principle → Mental Model → Decision → Action
```

Notebook 是其中独立的 **Personal Information Space**：用户可以自由记录、保存、组织资料；只有主动选择时才与 EvoPilot 业务对象建立关系。

### 0.2 不可违反的边界

- 不因新增模块重写现有系统。
- 不为一个模块新建第二套数据库、搜索、AI、认证或关系系统。
- 不把用户资料、SQLite 数据库、API Key、备份文件、个人附件提交进 Git。
- AI 可以理解、搜索、建议；任何写操作必须经过用户确认。
- 原始文件存储与文本提取 / AI 理解必须分离；解析失败不能导致上传失败。
- 一个改动必须有明确验收标准，并通过测试、构建和实际 UI 验证。

### 0.3 每次开发的最小交付物

每个需求至少产出：

1. 需求边界与验收场景。
2. 架构扫描结论：复用什么、扩展什么、新增什么。
3. 可运行代码。
4. 自动化验证结果。
5. 视觉验证截图或人工验收记录。
6. 一条聚焦、可读的 Git commit。

---

## 1. Phase 0：需求澄清与验收场景

### 目标

把“做一个功能”转换为可验证的用户行为，不直接从 UI 或数据库开始猜测实现。

### 操作

1. 写出用户动作、系统结果和边界。
2. 明确默认行为与可选行为。
3. 列出不做的内容，防止范围膨胀。
4. 对模糊点给出多个解释；无法安全假设时先询问。

### 示例：Notebook

| 用户动作 | 必须结果 |
|---|---|
| 新建笔记，不选择项目 | 保存成功，默认独立存在 |
| 上传 PDF | 原文件保存成功；提取失败也不影响文件 |
| 主动关联 Project | 仅创建 Relation，不修改 Project 本身 |
| 删除 Relation | 两端对象仍存在 |
| 打开 AI | AI 与 Notebook 不重叠；AI 可调整宽度 |

### 验收模板

```markdown
- Given：用户处于 [页面 / 数据状态]
- When：用户执行 [动作]
- Then：系统应 [可观察结果]
- And：系统不得 [副作用 / 越界行为]
```

---

## 2. Phase 1：先扫描，再决定实现路径

### 目标

不照着需求文档假设架构；以实际代码为准。

### 必查清单

```text
项目结构
前端入口、路由 / View 状态、Design System
数据模型、数据库 Schema、Migration
Repository / Service / Tauri commands
文件 Storage、Attachment、Backup
FTS / Search
Relation
AI Context、Tool Registry、Action Confirmation
权限、归档、删除
测试、构建、发布路径
Git remote 与工作区状态
```

### EvoPilot 当前可复用能力

| 能力 | 真实实现 | 新模块策略 |
|---|---|---|
| 数据存储 | SQLite `records` JSON 表 | 新实体以 entity 类型扩展 |
| 全文检索 | SQLite FTS5 `records_fts` | 写入 `title/body`，不另建搜索 |
| 关系 | `relations` 表 + field relation materialization | 复用 `add_relation` / `list_relations` |
| AI | Context Engine + Tool Registry + Action confirmation | 将模块暴露给现有 AI，不另建 Agent |
| 文件 | Tauri app data 本地目录 | 原始文件写入安全目录，DB 只存 Metadata |
| 生命周期 | Archive / Restore | 新模块复用 archive，不默认永久删除 |

### 决策规则

```text
Reuse > Extend > Create New
```

只有现有机制明确无法满足时，才新增表、命令或抽象层。

---

## 3. Phase 2：最小数据与后端设计

### 3.1 数据设计原则

- 数据库只保存可查询 Metadata 和业务状态。
- 大文件、二进制内容不能存入 SQLite JSON 字段。
- `id` 使用系统统一生成方式。
- 关联始终是单独的 Relation，不把目标对象当作父对象删除。
- 新字段要兼容旧数据：不存在时给出安全默认值。

### 3.2 Notebook 参考模型

```text
NotebookCategory
NotebookFolder
Note
NotebookFile
Relation（复用通用 relations 表）
```

Notebook File Metadata 示例：

```text
id
ownerId
name / originalName
extension / mimeType / size
storagePath
relativePath
notebookCategoryId / notebookFolderId
extractStatus / extractedContent / extractionError
createdAt / updatedAt / archivedAt
```

### 3.3 文件上传标准

1. 清理用户文件名，禁止路径穿越。
2. 使用内部 ID 生成真实 storage path。
3. 使用分块上传，避免一次读入大文件。
4. 先保证原文件保存，再做可选内容提取。
5. 提取文本写入 Metadata，自动进入 FTS。
6. 预览按需读取，并设置大小上限。
7. 永久删除必须要求先 Archive，并同时清理原始文件、FTS 与 Relation。

### 3.4 本地权限标准

当前单用户架构仍需提前保留 owner 边界：

```text
ownerId = local-user
```

对保存、打开、复制、归档、删除、建立 Relation 等操作检查 owner。未来引入多用户时，不需要重做 Notebook 数据模型。

---

## 4. Phase 3：前端交互与 UI 设计

### 4.1 UI 原则

- **先延续现有系统 Design System，再增加模块特性。**
- 复用现有字体栈、字号层级、颜色变量、按钮、边框和圆角。
- 不为了“功能完整”叠出多层卡片。
- 一个页面只有一个主视觉焦点。
- 操作密集区优先做信息密度与可扫描性，不做营销页。

### 4.2 Notebook 页面标准布局

```text
页面标题
紧凑操作栏：新建笔记 / 新建文件夹 / 上传
----------------------------------------------
左：范围与分类 | 中：内容列表 | 右：详情 / 预览 / 关系
```

### 4.3 AI 抽屉与业务页面共存规则

AI 不是覆盖层，而是独立工作区：

- AI 打开后，App Shell 使用三栏 Grid：Sidebar / Main / AI。
- AI 宽度由用户拖拽左边界调整。
- 主内容必须随 AI 宽度响应，不得被压在 AI 下方。
- 对三栏内容页（例如 Notebook），AI 打开后将次级详情区域移至主区下方或变为独立滚动区。
- 任何底部操作栏都必须可见：使用独立滚动容器与 sticky footer，禁止被 `overflow:hidden` 裁切。

### 4.4 视觉验收清单

在实际窗口尺寸下逐项检查：

```text
[ ] 字体、字号、按钮样式与原系统一致
[ ] 没有重复的主操作入口
[ ] 页面没有横向溢出
[ ] AI 打开时，业务内容不被遮挡
[ ] AI 宽度拖动后，主内容仍可使用
[ ] 长内容下，归档 / 编辑等底部操作仍可点击
[ ] 空状态、加载状态、错误状态可读
```

---

## 5. Phase 4：AI 接入 SOP

### 原则

```text
Understand → Search → Suggest → Confirm → Action
```

不是：

```text
Understand → Automatically Modify Everything
```

### 实施步骤

1. 将新实体加入 Schema Registry。
2. 为允许的 AI 操作加入 Tool Registry。
3. 明确 required fields、风险等级、是否需确认。
4. 将当前页面、选中对象、Relation 上下文接入 Context Engine。
5. 在系统提示中写清 AI 的只读 / 建议 / 确认边界。
6. 让 AI 对文件只使用 `extractedContent`，不能直接任意读取路径。

### Notebook AI 行为

| 用户意图 | AI 行为 | 是否可自动写入 |
|---|---|---|
| “总结这个文件” | 读取已提取文本，给出摘要 | 否 |
| “有哪些潜在关联” | 搜索 EvoPilot，给出候选与理由 | 否 |
| “保存这段话到 Notebook” | 生成 createNote Action 预览 | 需确认 |
| “沉淀为思维模型” | 生成草案 / Action 预览 | 需确认 |

---

## 6. Phase 5：测试与质量门禁

### 6.1 必跑命令

```bash
pnpm lint
pnpm test
pnpm build
cd src-tauri && cargo test
cd .. && pnpm tauri build
```

### 6.2 测试层次

1. **单元测试**：数据标准化、文件名安全、文本提取、Relation、权限边界。
2. **前端测试**：实体注册、默认独立性、列表 / 搜索规则。
3. **构建测试**：TypeScript、Vite、Rust。
4. **视觉验证**：用真实浏览器或桌面应用确认布局。
5. **回归验证**：原有 Goal / Project / Task / Finance / AI 行为仍可用。

### 6.3 UI 修复的标准流程

```text
用户截图
→ 定位真实 CSS / Layout 边界
→ 最小修改
→ 本地浏览器截图验证
→ release build
→ 关闭旧进程并启动新 bundle
```

特别注意：Tauri dev 端口冲突可能使窗口载入错误的 Vite 服务。最终验收必须以 release bundle 为准。

---

## 7. Phase 6：Git 协作与 GitHub 交付

### 7.1 提交前检查

```bash
git status --short
git diff --check
git diff --cached --stat
```

### 7.2 绝不提交的内容

```text
SQLite 数据库
API Key / Keychain 凭据
用户上传文件
个人文档、简历、截图
release target / dist（除非项目明确要求）
```

### 7.3 推荐提交粒度

```text
feat: add notebook workspace
fix: keep notebook details visible with ai drawer
style: align notebook ui with app shell
```

一条 commit 只表达一个可理解的产品能力或修复。大需求可拆为：数据 / 功能 / UI / 修复，但每一步必须可构建。

### 7.4 推送流程

```bash
git fetch origin
git add <明确文件列表>
git commit -m "feat: ..."
git push origin main
```

如本机 Git 配置了不可用代理，单次命令可清空代理，不要修改团队全局设置：

```bash
git -c http.proxy= -c https.proxy= fetch origin
git -c http.proxy= -c https.proxy= push origin main
```

---

## 8. Phase 7：给他人使用的打包 SOP

### 8.1 交付包内容

```text
EvoPilot.app                 # macOS 桌面应用
README.md                    # 安装与基本使用
JASON_OS_创作SOP.md          # 本文档
版本说明 / Release Notes
隐私说明
可选：示例数据（必须脱敏）
```

### 8.2 macOS 打包命令

```bash
pnpm tauri build
```

产物：

```text
src-tauri/target/release/bundle/macos/EvoPilot.app
```

### 8.3 交付前检查

```text
[ ] 从全新用户目录启动应用
[ ] 无 API Key 时应用可正常使用本地功能
[ ] 有 API Key 时 AI 仅在用户配置后工作
[ ] 不携带你的 SQLite 数据、个人附件、备份
[ ] Notebook 上传、检索、预览、归档、恢复正常
[ ] AI 打开、关闭、拖拽宽度正常
[ ] GitHub main 分支已推送
```

### 8.4 隐私说明模板

```markdown
EvoPilot 默认采用本地优先存储。
业务数据、Notebook 文件与备份保存在用户本机应用数据目录。
AI 功能仅在用户主动配置并调用第三方模型服务时发送必要上下文。
请勿将 API Key、数据库、备份或个人附件提交到 Git 仓库。
```

---

## 9. 可复用的研发循环

```text
需求与验收
→ 架构扫描
→ 复用决策
→ 最小数据设计
→ 后端 / 前端实现
→ 自动化测试
→ 视觉验证
→ release build
→ Git commit / push
→ 用户反馈
→ 小范围修复并重复验证
```

### 关键复盘问题

每完成一个模块，回答：

1. 是否复用了已有能力，而非造了第二套系统？
2. 默认行为是否足够低摩擦？
3. 用户是否保有最终控制权？
4. UI 是否和现有产品同一语言？
5. AI 是否仅在允许范围内行动？
6. 数据、文件、隐私是否可安全导出、恢复、删除？
7. 是否能用测试和 release bundle 证明它真的可交付？

---

## 10. 对外分发建议

当前项目最适合以两个层次交付：

1. **产品包**：`EvoPilot.app` + 安装指南 + 隐私说明。
2. **创作包**：本文 SOP + 源码 + 架构说明 + 脱敏演示数据。

如果要让其他开发者复刻：先让其阅读本文的 Phase 0、1、3、5、7；不要只交付 UI 截图或零散 prompt。
