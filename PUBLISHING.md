# 发布 Kero 客户端

源码位于私有仓库 `MasterAlanLab/Kero`。本仓库只维护发布流程、下载说明和 Release 附件，不复制源码历史。

## 一次性配置

在本仓库的 [Actions Secrets](https://github.com/MasterAlanLab/Kero-releases/settings/secrets/actions) 添加：

| Secret | 用途 | 权限 |
| --- | --- | --- |
| `KERO_SOURCE_TOKEN` | 检出私有源码与 Git LFS 文件 | Fine-grained PAT，仅选择 `MasterAlanLab/Kero`，Contents: Read-only |

令牌需属于能够读取源码仓库的账号；如果组织要求审批，先完成审批。它不需要写源码或发布仓库的权限。发布附件使用 GitHub 自动提供的 `GITHUB_TOKEN`，仅发布 job 获得 `contents: write`。

本机 Git 使用 `git@alan:MasterAlanLab/Kero-releases.git`，复用本机 `alan` SSH 别名。不要将本机 SSH 私钥配置到 Actions。

## 发布一个版本

1. 将需要发布的源码提交并推送到 `MasterAlanLab/Kero`。建议先在源码仓库为已验收提交建立版本标签。
2. 打开 [Actions → Release Kero](https://github.com/MasterAlanLab/Kero-releases/actions/workflows/release.yml)，选择 **Run workflow**。
3. 填写 `version`（如 `1.0.0`，不带 `v`）、`source_ref`（源码标签、分支或完整提交 SHA，默认 `main`）、`release_notes`（面向用户的更新说明）。
4. 默认 `draft = true`，构建成功后保存 Release 草稿。下载对应平台的附件完成安装与启动验收后，在 Releases 页面补充说明并发布。需要直接公开发布时，明确取消 `draft`。
5. `prerelease = true` 用于预发布测试，官网不会将它作为正式版展示。安装包版本仍使用严格的 `x.y.z`；`0.0.0` 是上游占位版本，不能发布。

普通提交或推送不会自动消耗构建额度。工作流仅支持手动触发，同一时间只运行一次发布。

## 构建与交付

- 将 `source_ref` 解析为一次确定的源码提交，所有平台都构建该 SHA。
- 使用源码仓库固定的 pnpm 版本与锁文件，设置 `KERO_PLATFORM_POOL=1` 固化 Kero 构建身份，调用既有 `pnpm release:package -- --region global --version <版本> --no-sign`。
- 在 Windows x64、macOS arm64（连打 arm64 / x64）、Linux x64 原生 runner 上打包。Windows / macOS 保留打包脚本的 smoke 检查；Linux 无头 runner 跳过 smoke。
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
