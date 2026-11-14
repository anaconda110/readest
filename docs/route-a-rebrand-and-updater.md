# Route A：自有更新通道与改名脱包

日期：2026-11-14
范围：桌面端优先（Windows / macOS / Linux），使用工作代号 **Moyue（墨阅）**。

---

## 1. 已落地的身份

| 项 | 旧值 | 新值 |
|---|---|---|
| 产品名 | Readest | Moyue |
| 二进制名 | readest | moyue |
| Bundle identifier | com.bilingify.readest | app.moyue.reader |
| 深链 scheme | readest:// | moyue:// |
| OneDrive scheme | readest-onedrive:// | moyue-onedrive:// |
| 书库 UTI | com.readest.books | app.moyue.books |
| 书库 MIME | application/x-readest-books | application/x-moyue-books |
| 更新源 | download.readest.com | github.com/anaconda110/moyue Releases |
| 更新签名公钥 | 上游公钥 | 本 fork 新密钥 |
| Windows 缩略图 CLSID | 与上游共用 | 独立 CLSID |
| 相册名 / Audiobookshelf 客户端名 | Readest | Moyue |

说明：

- 内部数据子目录 `DATA_SUBDIR` 仍为 `Readest`，避免一次性迁移本地书库；
  `tauri.conf.json` 的 asset scope 与 capabilities 也继续保持 `**/Readest/**/*`。
- JS 深链解析同时接受 `moyue://` 和旧 `readest://`，旧链接不会立即失效。
- 共享域名、API、同步、存储仍指向 `readest.com`，属于下一阶段（Route B）。

---

## 2. 更新通道

### 2.1 客户端

- `apps/readest-app/src-tauri/tauri.conf.json`
  - `plugins.updater.endpoints` 只保留：
    `https://github.com/anaconda110/moyue/releases/latest/download/latest.json`
  - `plugins.updater.pubkey` 已替换为本 fork 公钥。
- `apps/readest-app/src/services/constants.ts`
  - `READEST_UPDATER_FILE`、`READEST_CHANGELOG_FILE` 指向 fork 的 GitHub Release 资产。
  - `READEST_NIGHTLY_UPDATER_FILE` 指向未来的 `nightly` 标签；当前未发布，nightly 通道会回退到 stable manifest。
  - `READEST_UPDATER_PUBKEY` 与 `tauri.conf.json` 保持一致。

### 2.2 私钥

私钥已生成到仓库外：

```text
~/.tauri/moyue-updater.key
```

不要提交私钥，也不要把它复制进仓库。发布前在 GitHub 仓库设置中配置：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/moyue-updater.key
```

生成时未设置密码，因此不需要 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；如果后续更换为带密码的密钥，再补该 secret。

### 2.3 CI

- `.github/workflows/release.yml`
  - 所有 GitHub 下载/上传地址改为当前仓库（`${{ github.repository }}`）。
  - 更新产物名从 `Readest_*` 改为 `Moyue_*`；Windows portable 从 Cargo 输出目录复制 `moyue.exe`。
  - 首次发版没有 `latest.json` 时，portable / Android 合并步骤只在 HTTP 404 下初始化一个空 manifest；其他 HTTP 错误仍会失败，避免覆盖已有清单。
  - R2 上传 job 改为 opt-in：仓库变量 `ENABLE_R2_UPLOAD=true`、`MOYUE_R2_BUCKET`、`MOYUE_DOWNLOAD_BASE_URL` 都配置后才执行。
- `.github/workflows/nightly.yml`
  - 整个 nightly 构建改为 opt-in：仓库变量 `ENABLE_NIGHTLY_BUILDS=true` 时才执行。
  - 产物名同步改为 `Moyue_*`。
  - nightly 的下载地址和 R2 bucket 不再硬编码上游，必须配置 `MOYUE_NIGHTLY_BASE_URL`、`MOYUE_R2_BUCKET` 后才会运行。

发布步骤：

1. 提升 `apps/readest-app/package.json` 的 `version`。
2. 提交并推送。
3. 在 GitHub 创建并发布 Release（或手动运行 `Release Moyue`）。
4. CI 生成签名安装包，并把 `latest.json`、`release-notes.json` 上传到该 Release。
5. 旧版客户端检查更新时读取 fork 的 `latest.json`，签名校验使用新公钥。

验收：

- 安装上一版 `Moyue`，触发检查更新，确认下载地址是 `github.com/anaconda110/moyue`。
- 确认新版本安装成功，且不会再被官方 Readest 更新覆盖。
- 在同时安装官方 Readest 的机器上，确认两个应用互不覆盖、深链各自路由。

---

## 3. 数据迁移

换 Bundle identifier 后，Tauri 的 app data/config 根目录会变化。旧数据不会自动出现在新应用里。

建议先备份，再复制旧根目录内容到新根目录：

| 平台 | 旧根目录（示例） | 新根目录（示例） |
|---|---|---|
| Windows | `%APPDATA%\com.bilingify.readest` | `%APPDATA%\app.moyue.reader` |
| macOS | `~/Library/Application Support/com.bilingify.readest` | `~/Library/Application Support/app.moyue.reader` |
| Linux | `~/.local/share/com.bilingify.readest` | `~/.local/share/app.moyue.reader` |

保留内部的 `Readest/` 子目录不变。也可以先用应用自带备份功能导出，再在新应用中恢复。

桌面凭据（同步口令、OAuth token 等）的 keyring service 已从
`Readest Safe Storage` 改为 `Moyue Safe Storage`，避免与官方 Readest 共用同一
凭据命名空间。旧条目不会自动读取，因此迁移后需要重新输入同步口令、重新授权
需要安全存储的账号；本地书库和数据库仍可通过上面的目录复制迁移。

> 如果后续希望无感迁移，可在启动时增加“旧目录存在且新目录为空则复制”的一次性迁移逻辑；
> 如需迁移旧 keyring，可增加“新 service 为空时回退读取旧 service，再写入新 service”的兼容路径。

---

## 4. 仍需处理

1. **云服务仍绑上游**：`READEST_WEB_BASE_URL`、`READEST_NODE_BASE_URL`、Supabase、存储、分享、Voice 仍指向 `readest.com`。
2. **界面文案与图标**：`src` 与 35 个 locale 中仍有大量 `Readest` 文案，图标仍是上游资源。
3. **OAuth 客户端**：OneDrive / Google Drive 的 client id 仍是上游应用，需替换为自己的应用注册；同时把 `moyue://auth-callback` 加入 Supabase Redirect URLs，把 `moyue-onedrive://auth` 加入 Microsoft 应用重定向 URI。在这两项配置完成前，新 scheme 的账号登录和 OneDrive 授权会失败。
4. **签名身份**：已移除上游 `DEVELOPMENT_TEAM`，并删除上游的 provisioning profile。macOS Developer ID 构建前，把自有 profile 放到 `apps/readest-app/src-tauri/profiles/MoyueDeveloperID.provisionprofile`；该路径已被 `.gitignore` 忽略。macOS 公证、iOS provisioning profile、Android keystore 仍需配置自己的证书。
5. **移动端生成工程**：`gen/android`、`gen/apple` 的 bundle id 和深链已同步，但 iOS 产物名 / Xcode target 仍是 `Readest*`，所以 `dev-ios` 脚本暂时仍安装 `Readest.ipa`。最终改名后建议重新执行 `tauri android init` / `tauri ios init`。
6. **Web 域名**：`web.moyue.app` 尚未部署，因此 App Links、分享和 OAuth 仍继续使用 `web.readest.com`；不要提前把 manifest 指向未拥有的域名。
7. **Nightly / R2**：默认关闭。启用 nightly 前需要自己的 R2 bucket、下载域名和 `MOYUE_NIGHTLY_BASE_URL` / `MOYUE_R2_BUCKET` 变量；当前 stable 更新不依赖这些基础设施。
8. **上游跟随**：当前仍领先 `upstream/main` 35 个提交，需要制定月度 merge 策略。

---

## 5. 改成正式产品名时的检查清单

如果最终不采用 `Moyue`，至少替换以下位置：

```bash
rg -n "Moyue|moyue|app\.moyue\.reader" \
  apps/readest-app/src-tauri \
  apps/readest-app/src \
  apps/readest-app/package.json \
  .github/workflows
```

重点文件：

- `apps/readest-app/src-tauri/tauri.conf.json`
- `apps/readest-app/src/services/constants.ts`
- `apps/readest-app/src/services/nodeAppService.ts`
- `apps/readest-app/src/utils/deeplink.ts`
- `apps/readest-app/src/app/auth/page.tsx`
- `apps/readest-app/src/services/sync/providers/onedrive/microsoftOAuthConfig.ts`
- `apps/readest-app/src-tauri/Info.plist`
- `apps/readest-app/src-tauri/Info-ios.plist`
- `apps/readest-app/src-tauri/capabilities/default.json`
- `apps/readest-app/src-tauri/nsis/installer-hooks.nsh`
- `apps/readest-app/src-tauri/tauri.windows.conf.json`
- `apps/readest-app/src-tauri/profiles/MoyueDeveloperID.provisionprofile`（本机文件，不入库）

更新签名密钥与私钥不需要随产品名变化，除非决定轮换密钥。
