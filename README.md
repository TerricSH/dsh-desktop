# @terricsh/dsh-desktop

DeepSeek Harness Web GUI 的桌面壳（Electron）：把 `dsh web` 装进独立窗口 +
系统托盘。**打包后完全自包含**——harness 代码（含 dsh CLI 与 Web 前端）内置
在应用里，机器上不需要任何 dsh / node 安装，双击即用。

## 上游项目

本应用内置的 harness 来自
[**DeepSeek Harness**](https://github.com/deepseek-ai/deepseek-harness)——
DeepSeek 官方的插件式 Agent 执行环境（Cordis 组合，`dsh web` 即其 Web GUI）。
`dsh-desktop` 是它的**桌面壳**：不改动 harness 任何代码，只负责窗口、托盘、
服务生命周期与打包分发。harness 升级后执行 `npm run package -- -RefreshBundle`
即可把新版本重新打进应用。

```
┌──────────────────────────┐
│   Electron 窗口（独立应用） │
│   ← 加载 http://127.0.0.1:3080 │
└──────────────────────────┘
        │  attach（端口已有服务时）／ spawn（自己起，内置 harness）
        ▼
┌──────────────────────────┐
│   dsh web（Node 宿主进程）  │   ← 关闭窗口=最小化到托盘，退出=杀进程
└──────────────────────────┘
```

## 两种运行方式

| 场景 | 行为 |
|---|---|
| 端口上已有 DSH 服务（如浏览器里开着 GUI） | **attach**：直接挂接，不重复拉起，退出不影响它 |
| 没有服务 | **spawn**：从内置 harness 起自己的服务（`--expose-internals` 走 Electron 自带 Node 运行时），退出时杀掉 |

内置服务使用应用自己的 DSH home（默认 `<userData>/dsh-home`），与浏览器 GUI
的 `$DSH_HOME` 相互独立——这就是"独立的服务"。首次运行会自动播种：profile
配置拷入 home，包树由 dsh 自己的安装回退机制链接（`healProfilesModuleFallback`）。

## 开发态运行

```powershell
cd E:\dsh\dsh-desktop
npm install
npm run bundle     # 把当前部署的 harness 复制进 resources/harness（255MB，一次性）
npm start          # 启动桌面应用
```

## 打包成独立 exe

一键打包（推荐）：

```powershell
npm run package                 # 复用现有 resources/harness，构建便携 exe
npm run package -- -RefreshBundle   # 先从当前部署重新同步 harness 再打包
```

手动分步：

```powershell
npm run bundle     # 把当前部署的 harness 复制进 resources/harness（255MB，一次性）
npm run dist       # electron-builder --win portable → dist/DSH Desktop.exe
```

产物是单个便携 exe（~200MB）：拷贝到任何 Windows 机器双击即用，自带 Node
运行时与整个 harness，不依赖外部安装。

## 可选参数

```
npm start -- --port 3199           # 换端口
npm start -- --dsh-command "C:\path\to\dsh.cmd"   # 强制用外部 dsh（跳过内置）
npm start -- --no-tray             # 关窗口直接退出（不驻留托盘）
npm start -- --smoke               # 无头自检：截图 smoke.png 后退出
```

环境变量：

| 变量 | 作用 |
|---|---|
| `DSH_DESKTOP_COMMAND` | 与 `--dsh-command` 等效 |
| `DSH_DESKTOP_PORT` | 与 `--port` 等效 |
| `DSH_DESKTOP_HOME` | 应用 DSH home 路径（默认 `<userData>/dsh-home`） |
| `DSH_DESKTOP_USERDATA` | Chromium 配置目录（便携/测试模式） |

## 自检

```powershell
npm run smoke      # 挂接运行中的 GUI，截图到 data/smoke.png 后退出
```

全链路 bundled 自检（无需任何外部 dsh）：

```powershell
$env:DSH_DESKTOP_HOME = "E:\dsh\dsh-desktop\data\test-home"
$env:DSH_DESKTOP_USERDATA = "E:\dsh\dsh-desktop\data\userdata-smoke"
electron.exe . --smoke --port 3199
```

## 在应用自己的 home 里加插件

应用的 home（默认 `%APPDATA%\dsh-desktop\dsh-home`）profile patch 初始为空。
要装插件（如 `@terricsh/dsh-notify`、`@terricsh/dsh-app-launcher`）：

1. 把插件包放进 `dsh-home\profiles\web\node_modules\`（或
   `dsh-home\profiles\node_modules\`）；
2. 编辑 `dsh-home\profiles\web\cordis.patch.yml` 加 insert 行（见各插件 README）；
3. 重启应用。

## 生成图标

```powershell
npm run make-icon            # favicon.svg → icon.png / icon-256/64/32/16.png
powershell -File scripts\make-icon.ps1   # 再生成 icon.ico（Windows 任务栏）
```

## 工作原理与安全

- 壳内 BrowserWindow 就是普通浏览器上下文（`sandbox: true`、无 nodeIntegration、
  `contextIsolation: true`），与浏览器打开 `127.0.0.1:3080` 完全同权，不新增
  任何权限面；DSH 的 loopback 信任围栏、审批、沙箱全部照旧。
- spawn 的服务日志写在 `data/server.log`（本目录，已 gitignore）。
- 单实例锁：重复启动只会聚焦已有窗口，不会拉起第二个服务。
- 打包时 harness 通过 `extraResources` 以真实文件落盘（junction/链接需要真实
  路径，不能进 asar）；应用代码本体（src/assets）在 asar 内。

## 配合周边项目

- [`@terricsh/dsh-notify`](../dsh-notify)：桌面通知 + 点击直达对应会话；
- [`@terricsh/dsh-app-launcher`](../dsh-app-launcher)：从会话头部一键打开
  工作区文件夹 / VS Code。
