# Jason OS V3

Local-first、Desktop-first 的个人操作系统，用来连接：

`Capture → Plan → Focus → Work → Time → Result → Review → Insight → Principle → Mental Model → Decision → Action`

## 下载与安装

到 [GitHub Releases](https://github.com/zqc96709-ops/jason-os/releases) 下载最新版 `.dmg`，打开后将 `Jason OS.app` 拖入“应用程序”目录。

当前首发包仅支持 Apple Silicon Mac（M1、M2、M3、M4）。由于尚未使用 Apple Developer ID 公证，macOS 可能提示“无法验证开发者”；请仅从本仓库下载，并在 Finder 中按住 Control 点击 App 后选择“打开”。

## 开发运行

```bash
pnpm install
source "$HOME/.cargo/env"
pnpm tauri dev
```

## 验证

```bash
pnpm test
pnpm lint
pnpm build
cd src-tauri && cargo test
cd .. && pnpm tauri build --debug
```

## 快捷键

- `⌘ K`：Command Palette
- `⌘ Shift Space`：快速收集
- `Esc`：关闭搜索、命令、AI 或详情抽屉

## 本地数据

```text
~/Library/Application Support/com.jasonos.desktop/
├── jason-os.sqlite3
├── attachments/
├── exports/
└── backups/
```

HackStart API Key 保存于 应用私有凭据文件（权限 0600），不写入 SQLite 或导出文件。

## 网页端与跨设备同步

Jason OS 采用 Local-first：Mac 的 SQLite 始终是本地副本，云端只用于用户确认后的跨设备同步。网页/PWA 部署、Supabase RLS、域名绑定和验收步骤见 [`docs/WEB_AND_SYNC_SETUP.md`](docs/WEB_AND_SYNC_SETUP.md)。

## 构建产物

```text
src-tauri/target/debug/bundle/macos/Jason OS.app
```

## AI 服务商

AI 首席助理支持独立选择服务商和模型：

- HackStart：`gpt-5.5`
- DeepSeek：`deepseek-v4-pro`、`deepseek-v4-flash`
- MiniMax：`MiniMax-M3`

每个服务商的 API Key 分别保存到 应用私有凭据文件（权限 0600）。切换服务商时不会覆盖其他服务商的 Key。
- 火山引擎 Agent Plan：`kimi-k3`（Responses API，`/api/plan/v3/responses`）

## 创作与交付 SOP

完整的产品创作、模块开发、AI 安全、UI 验证、桌面打包与 GitHub 交付流程见：

[`docs/JASON_OS_创作SOP.md`](docs/JASON_OS_创作SOP.md)
