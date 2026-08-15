# @terricsh/dsh-desktop

DeepSeek Harness Web GUI 的桌面壳（Electron）：把 `dsh web` 装进独立窗口 +
系统托盘，双击即用，不用再开浏览器标签页。

```
┌──────────────────────────┐
│   Electron 窗口（独立应用） │
│   ← 加载 http://127.0.0.1:3080 │
└──────────────────────────┘
        │  attach（已在跑）或 spawn（自动拉起）
        ▼
┌──────────────────────────┐
│   dsh web（Node 宿主进程）  │   ← 关闭窗口=最小化到托盘，退出=杀进程
└──────────────────────────┘
```

## 安装与运行

```powershell
cd E:\dsh\dsh-desktop
npm install        # 只需 electron 一个依赖
npm start          # 启动桌面应用
```

首次启动行为：

1. 探测 `http://127.0.0.1:3080` —— 若已有 `dsh web` 在跑（比如你现在这个 GUI），
   **直接挂接**，不重复拉起；
2. 若没有，自动解析 `dsh` 命令并 **spawn**（`dsh web --host 127.0.0.1 --port 3080`），
   就绪后开窗口；
3. 关闭窗口 = 最小化到托盘；托盘菜单可显示/隐藏/退出。

**退出时只杀掉本应用拉起的服务**；挂接的已有服务原样保留。

## dsh 命令的解析顺序

1. `--dsh-command <cmd>` 或环境变量 `DSH_DESKTOP_COMMAND`
2. PATH 上的 `dsh`
3. npm 全局前缀（`%APPDATA%\npm\dsh.cmd`）
4. `%LOCALAPPDATA%\npm-cache\_npx\*\node_modules\.bin\dsh.cmd`（取最新的 npx 部署）

## 可选参数

```
npm start -- --port 3199           # 换端口
npm start -- --dsh-command "C:\path\to\dsh.cmd"
npm start -- --no-tray             # 关窗口直接退出（不驻留托盘）
npm start -- --smoke               # 无头自检：截图 smoke.png 后退出
```

环境变量：`DSH_DESKTOP_COMMAND`、`DSH_DESKTOP_PORT` 与对应参数等效。

## 自检

```powershell
npm run smoke
```

挂接到运行中的 GUI，等页面完成启动，截图到 `smoke.png`，打印
`SMOKE_OK`（或 `SMOKE_FAIL`）后退出。`smoke.png` 可打开目检。

## 生成图标

```powershell
npm run make-icon            # favicon.svg → icon.png / icon-256/64/32/16.png
powershell -File scripts\make-icon.ps1   # 再生成 icon.ico（Windows 任务栏）
```

## 打包成独立 exe（后续可选）

当前是 `electron .` 开发态。要发给别人免安装使用，可加 `electron-builder`
产出 NSIS 安装包 / 便携版：

```powershell
npm i -D electron-builder
npx electron-builder --win
```

## 工作原理与安全

- 壳内 BrowserWindow 就是普通浏览器上下文（`sandbox: true`、无 nodeIntegration、
  `contextIsolation: true`），与浏览器打开 `127.0.0.1:3080` 完全同权，不新增
  任何权限面；DSH 的 loopback 信任围栏、审批、沙箱全部照旧。
- spawn 的服务日志写在 `data/server.log`（本目录，已 gitignore）。
- 单实例锁：重复启动只会聚焦已有窗口，不会拉起第二个服务。

## 配合周边项目

- [`@terricsh/dsh-notify`](../dsh-notify)：桌面通知 + 点击直达对应会话；
- [`@terricsh/dsh-app-launcher`](../dsh-app-launcher)：从会话头部一键打开
  工作区文件夹 / VS Code。
