# 发布 Kero 客户端

源码位于私有仓库 `MasterAlanLab/Kero`。本仓库只维护发布流程、下载说明和 Release 附件，不复制源码历史。

## 一次性配置

在本仓库的 [Actions Secrets](https://github.com/MasterAlanLab/Kero-releases/settings/secrets/actions) 添加：

| Secret | 用途 | 权限 |
| --- | --- | --- |
| `KERO_SOURCE_TOKEN` | 检出私有源码与 Git LFS 文件 | Fine-grained PAT，仅选择 `MasterAlanLab/Kero`，Contents: Read-only |

令牌需属于能够读取源码仓库的账号；如果组织要求审批，先完成审批。它不需要写源码或发布仓库的权限。发布附件使用 GitHub 自动提供的 `GITHUB_TOKEN`，仅发布 job 获得 `contents: write`。

本机 Git 使用 `git@alan:MasterAlanLab/Kero-releases.git`，复用本机 `alan` SSH 别名。不要将本机 SSH 私钥配置到 Actions。

## 推送标签自动发布

1. 将需要发布的源码提交并推送到 `MasterAlanLab/Kero` 的 `main`。
2. 在**本发布仓库 `Kero-releases`** 更新 `main`，创建并推送版本标签：

   ```sh
   git switch main
   git pull --ff-only origin main
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. 工作流读取私有源码的 `main`，固定为一个 SHA，再构建所有平台。全部构建和附件校验成功后直接公开 Release，无需手写说明或手动发布草稿。

版本标签必须使用严格的 `vx.y.z`；`v0.0.0`、测试后缀和前导零不可用。标签属于发布仓库，不需要在源码仓库创建同名标签。普通分支推送不触发构建；同一时间只运行一次发布。

### 标题与更新说明

- 标题沿用 emailbox 的格式：`v1.0.0 -- "每日一句"`。从 `https://v1.hitokoto.cn/` 获取句子，清除控制字符并限制长度；超时、空内容或异常响应时使用 `Stay hungry, stay foolish.`，不阻断发布。重试已有草稿时保留原句。
- 更新说明自动列出上次公开正式版到本次源码 SHA 之间的非合并提交标题及短 SHA；首次发布列出当前源码历史。最多展开 100 条，每条最多 140 字符；其余显示数量。
- 基准来自上次正式版附件 `release-metadata.json` 的源码 SHA，不使用发布仓库的提交历史。源码提交标题会出现在公开更新说明中，提交时不要包含敏感信息。
- 历史被重写、基准不是本次源码的祖先或旧版本缺少有效元数据时，停止自动生成；手动填写一次更新说明即可建立新基准。GitHub API 异常仍会报错，避免静默遗漏变更。

### 手动发布与重试

需要固定已验收的源码标签 / SHA、预发布或草稿时，打开 [Actions → Release Kero](https://github.com/MasterAlanLab/Kero-releases/actions/workflows/release.yml)，选择 **Run workflow**：

- `version`：例如 `1.0.0`，也接受 `v1.0.0`。
- `source_ref`：源码标签、分支或完整 SHA，默认 `main`。
- `release_notes`：可留空，自动生成；填写后覆盖自动说明。
- `draft`：默认不勾选，构建成功直接公开；勾选则只保存草稿，供安装验收后手动发布。
- `prerelease`：默认不勾选；勾选则标记预发布，官网不会将它作为正式版展示。安装包版本仍使用 `x.y.z`。

## 构建与交付

- 将 `source_ref` 解析为一次确定的源码提交，所有平台都构建该 SHA。
- 使用源码仓库固定的 pnpm 版本与锁文件，设置 `KERO_PLATFORM_POOL=1` 固化 Kero 构建身份，调用既有 `pnpm release:package -- --region global --version <版本> --no-sign`。
- 在 Windows x64、macOS arm64（连打 arm64 / x64）、Linux x64 原生 runner 上打包。Windows / macOS 保留打包脚本的 smoke 检查；Linux 无头 runner 跳过 smoke。
- Linux runner 同时安装 Wayland scanner 及 `wayland-client`、`xkbcommon`、`json-c`、`libturbojpeg`、`libpng` 开发包，用于构建现有桌面输入与截图助手；不跳过原生助手编译。
- 读取每个平台的 `build-info.json`，核对版本、源码提交、平台、架构、文件名、大小和 SHA-256，仅收集 `installer` 产物。发布时将文件名前缀 `cindy-` 改为 `kero-`，不改安装包内部内容及上游协议身份。
- 所有平台完成并再次校验后，上传四个安装包、`SHA256SUMS` 和 `release-metadata.json`。元数据只记录版本、源码 SHA、构建链接与附件校验信息。
- 不上传 hotfix 包、完整 build-info、用户配置或源码快照；不写 CDN，不生成自动更新 feed，不改变客户端更新器。

默认产物：

```text
kero-1.0.0-Setup.exe
kero-1.0.0-arm64.zip
kero-1.0.0-x64.zip
kero-1.0.0-amd64.deb
SHA256SUMS
release-metadata.json
```

当前 macOS 包为 ad-hoc 签名的 ZIP，未经 Apple 公证；Windows 未签名。这里不承诺尚未接入的 DMG、公证、Windows 签名、Linux arm64 或客户端自动更新。

## 失败与重试

构建失败不会创建公开版本；到对应 Actions run 查看失败平台，修复后重新运行。附件上传中断时，版本保留为草稿，重跑会更新该草稿的四个安装包与校验信息。默认保留 Actions 构建产物 7 天。

已公开版本禁止覆盖；请使用新版本号发布修复。草稿允许重跑，但不要同时手动发布一个仍在构建或上传附件的草稿。

令牌过期、无仓库访问权或缺少 LFS 权限会在源码检出时失败。请直接更新 Actions Secret，不将令牌写入 Git、命令示例或聊天。

## 官网下载联动

Kero 服务端的 `GET /api/public/releases/latest` 读取本仓库最新公开正式 Release，缓存 5 分钟。官网的下载页只展示已上传完成且属于本仓库的受支持安装包。

源码侧仓库地址与附件链接白名单需同步使用 `MasterAlanLab/Kero-releases`；服务端重新部署后生效。草稿、预发布或还没有公开版本时，官网不会提供这些附件的正式版下载入口。

## 本地验证发布脚本

只需要 Node.js 22.12+，无需安装依赖：

```sh
node --test scripts/release.test.mjs
```

正式构建仍需 GitHub Actions 在三个平台实际运行，本地脚本测试不能代替安装验收。
