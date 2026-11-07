# 阿里云本机部署

当前网站为 `https://tv.fixepub.com`，SSH 账号为 `fixepub@8.153.158.141`。服务是 `hometv.service`，运行目录为 `/opt/hometv/publish/current`，生产环境文件为 `/etc/hometv.env`。

## 日常使用

本机只需 Git、GitHub CLI（`gh auth login` 已登录）、OpenSSH、curl 和 tar。无需 Docker、Node 或本机编译环境。GitHub Actions 负责 Linux 构建，本机只下载发布包并通过 SSH 部署。

```bash
# 只读检查本机工具、提交、SSH 和服务器发布权限
bash scripts/deploy-aliyun.sh --check

# 发布当前已推送到 origin/personal 的提交
bash scripts/deploy-aliyun.sh

# 等待云端构建并下载校验后的发布包，不连接或更新服务器
bash scripts/deploy-aliyun.sh --download-only /tmp/hometv-release.tgz
```

脚本要求本地 HEAD 与远程 `personal` 一致，工作区未提交修改不会被包含，也不会被修改。它复用该提交的 Web CI 构建；没有构建或发布包已过期时自动触发一次新构建，等待 lint、类型检查、全部测试和 Linux 生产构建通过。现有构建失败时停止并保留 Actions 日志，不上传。修复失败原因后可在 Actions 重跑，再执行部署命令。

发布包的配置默认值来自提交中的 `config`；直播列表按现有 Web CI 流程生成，服务器环境变量仍有更高优先级。脚本验证包内 `REVISION` 与目标提交一致，上传前再次检查远程分支未变化。它不覆盖生产环境文件、账号和观看记录。上传后调用服务器现有的 `/opt/hometv/publish/activate`，通过发布锁、原子切换、健康检查和失败回滚完成更新，旧发布目录保留。已经运行相同提交时只检查健康，不重复构建或重启。

## 每台 Mac 的免密配置

```bash
bash scripts/setup-deploy-ssh.sh --prepare
bash scripts/setup-deploy-ssh.sh
```

默认密钥是本机 `~/.ssh/id_ed25519_fixepub`，也可以通过 `DEPLOY_KEY` 指定。首次安装需要现有 SSH 登录方式，并核对服务器主机指纹。脚本只追加公钥，不覆盖其他设备的公钥，也不修改 SSH 或 sudo 权限。

若首次无法通过 SSH 登录，在阿里云已登录的 Workbench 中把本机 `.pub` 公钥追加到 `/home/fixepub/.ssh/authorized_keys`，属主为 `fixepub:fixepub`，目录权限 700、文件权限 600。私钥不得上传。2026-11-07 已在当前 Mac 完成免密安装和验证。

## 脚本职责与 Actions

- `scripts/deploy-aliyun.sh`：唯一的本机发布入口，使用 GitHub Actions 的 Linux 构建包。
- `scripts/setup-deploy-ssh.sh`：首次安装、验证当前 Mac 的部署公钥。
- `scripts/activate-aliyun.sh`：服务器发布器的源码；服务器已安装到 `/opt/hometv/publish/activate`，日常发布不重新安装它。
- `scripts/create-account.mjs` 和直播同步脚本仍用于账号管理、直播维护，不属于废弃部署脚本。

2026-11-07 GitHub Actions 页面明确显示该 Fork 的工作流被 GitHub 停用，原因说明是减少从上游继承的不必要工作流消耗；这与迁移服务器无关。仓库 API 的 `enabled: true` 与工作流 `active` 不能反映这个 Fork 级限制。随后已在页面确认 `Actions Enabled`。若再次遇到此限制，先查看仓库 Actions 页的具体提示。

`.github/workflows/web-ci.yml` 负责构建，不持有服务器私钥，也不会自动重启生产服务。代码推送后构建会自动运行；真正上线仍通过本机部署命令完成。此次移除本机 Docker 构建路径，只保留这一种日常部署方式。

验证记录（2026-11-07）：[Web CI #25](https://github.com/zengchanghuan/LibreTV/actions/runs/42378826827) 已成功完成最新提交 `b43f9f6` 的检查、59 个测试文件、Linux 构建及产物上传。本机 `--check`、同版本跳过部署、现有密钥复用通过；模拟确认提交不一致、CI 失败和产物编号不匹配均阻止上传。65 MB 产物的本机完整下载因当前网络约十几 KB/s 未完成，此次未重复部署线上相同版本。
