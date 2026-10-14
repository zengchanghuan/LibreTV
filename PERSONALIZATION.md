# 个性化开发说明

本仓库的 `personal` 分支以当前线上使用的 `v2.16.12`（`b20e352b800e5ff3dca02bf47d3503cbd41d4bf5`）为基础，保留上游完整源码和历史。

- `origin`：个人 Fork `zengchanghuan/LibreTV`
- `upstream`：原项目 `LibreSpark/LibreTV`
- `main`：创建 Fork 时的上游主分支；`personal`：个人修改和部署配置

## 默认影视源与慢速提示

`config/sources.json` 保存当前 11 个默认影视源。暴风资源名称带有「起播较慢」提示，源管理、搜索结果和换源界面均使用该名称。

2026-10-14 对《庆余年第二季》第 1 集的抽测中，暴风源播放列表获取耗时约 22.9 秒，360 源约 1.2 秒。提示反映本次线路表现，不代表所有影片始终慢。后续重新测试后可调整名称。

源的数组顺序对应 `env_0`、`env_1` 等标识。修改名称时保留顺序和地址，避免影响已有播放链接。仅提交 JSON 不会自动改变运行中的服务；需将其 `sources` 数组写入部署环境的 `DEFAULT_SOURCES`，再重启应用。

输出可用于 `DEFAULT_SOURCES` 的 JSON：

```sh
node -p 'JSON.stringify(require("./config/sources.json").sources)'
```

现有 systemd 部署在 `/etc/libretv.env` 使用如下格式（将数组替换为上述命令结果）：

```text
DEFAULT_SOURCES='[{"name":"示例","url":"https://example.com/api.php/provide/vod","isAdult":false}]'
```

修改前备份环境文件，保留其他配置，随后重启 `libretv` 并通过 `/api/status` 检查 `defaultSources`。

## 本地开发

使用 Node.js 22：

```sh
npm ci
cp .env.example .env.local
```

编辑 `.env.local`，为本地开发设置自己的 `PASSWORD`，然后运行：

```sh
DEFAULT_SOURCES="$(node -p 'JSON.stringify(require("./config/sources.json").sources)')" npm run dev
```

访问 `http://localhost:8080`。`.env.local` 已被 Git 忽略；生产密码、签名密钥和证书只保存在部署环境中。

常用代码入口：

- `src/components/source-manager.tsx`：源管理
- `src/components/switch-source.tsx`：播放时换源
- `src/lib/env-sources.ts`：默认源环境变量解析
- `src/lib/proxy-handlers.ts`：播放代理

修改应用代码后，按影响范围运行 `npm run typecheck`、`npm run lint`、`npm test` 与 `npm run build`。当前线上使用官方构建的 standalone 运行文件；后续源码修改需要构建并部署个人版本，推送 GitHub 本身不会自动更新现有服务器。

## 同步上游

```sh
git fetch upstream --tags
git switch personal
# 审查上游差异后，再合并选定的版本或提交。
```

保留上游许可证及版权说明。
