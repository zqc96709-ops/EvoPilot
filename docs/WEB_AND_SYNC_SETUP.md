# Jason OS Web/PWA 与跨设备同步

## 已落地的基础

- 保留 Mac 的 SQLite 本地副本；云端只保存用户自己的记录信封与删除墓碑。
- 每台设备都有独立 UUID；同步按 `updatedAt` 的毫秒版本进行，更新较新的记录胜出。
- 所有关联、归档、删除和知识存入仍然是普通记录字段：云端不会自动创建 Jason OS 关联，也不会自动把内容写入知识库。
- Supabase 使用 Email/Password 身份认证、RLS 与用户隔离。浏览器公开的只有项目 URL 与 anon key；服务角色密钥、AI Key、情报源 Key 均禁止上传。

## 首次部署（需要账户权限）

1. 在 Supabase 新建项目，按顺序执行 `supabase/migrations/0001_jason_cloud_sync.sql` 与 `0002_jason_sync_protocol_v1.sql`。生产切换前保留旧 RPC 作为回滚路径。
2. 在 Authentication 开启 Email 登录，并配置生产站点 URL 与回调 URL。
3. 在 Storage 新建私有 bucket `jason-notebook-files`；文件对象路径必须以用户 UUID 开头。二进制文件上传将在云项目启用后接入该 bucket，当前同步基础先保证记录和文件元数据一致。
4. 在 Vercel 导入 GitHub 仓库 `zqc96709-ops/jason-os`，设置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 两个 Production/Preview 环境变量，再部署。
5. 在 Vercel 项目中添加你的 `.com` 域名；按 Vercel 给出的 DNS 记录到域名注册商处配置，验证后再把该 HTTPS 域名填入 Supabase Auth 的 Site URL / Redirect URLs。
6. 在 Mac 桌面版和网页端用同一邮箱登录，首次使用“立即同步”建立各自的本地副本。

## 验收边界

- 只有成功登录并点击“立即同步”后，数据才会上传；未配置云端时应用继续保持本地模式。
- 删除记录以墓碑同步，避免另一设备把已删除项目重新写回。
- 同一记录在两台设备离线编辑时，以 `updatedAt` 较新的版本为准；需要更复杂的字段级合并前，应先保留冲突副本而不是静默覆盖。
- 跨设备二进制文件、后台调研队列和实时订阅需要在可用 Supabase/Vercel 项目内做真实凭据验收后再启用，不能在没有云项目的本机伪造“已部署”。

## 本地 Jason Sync Server

```bash
JASON_SYNC_TOKEN='仅用于本机开发的随机值' pnpm sync:server
```

桌面开发环境配置 `VITE_JASON_SYNC_URL=http://127.0.0.1:8787` 与同一个
`VITE_JASON_SYNC_TOKEN`。该本地服务用于协议、离线、冲突和文件分块验收；生产环境使用
Supabase Auth/RLS 与 `0002` 协议表，绝不能把本地开发 token 打包进公开网页。

协议 V1 使用 server sequence cursor、mutation 幂等、base revision、tombstone 和一等 Relation。
Web 的 IndexedDB 是 Working Replica；清除浏览器数据后必须重新下载 Snapshot。
