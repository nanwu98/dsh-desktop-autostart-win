# dsh-desktop-autostart-win

让 **DeepSeek Harness 桌面版**随 Windows 登录自动启动。插件在设置里增加一页——
**开机自启 / Startup**——上面只有一个开关。

| 开关 | 效果 |
| --- | --- |
| 开 | 在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 写入 `DeepSeek Harness` = `"<桌面版>.exe"`，并清除任务管理器里留下的「已禁用」标记，登录 Windows 后自动启动桌面版。 |
| 关 | 删除该值，登录后不再自动启动。 |

插件配置里不保存第二份状态：启动项本身就是唯一事实来源，所以页面显示的永远是
Windows 实际会执行的东西。

## 安装

需要 **DSH 0.2.2-rc.1 或更新的 0.2.x**，以及 **Windows 10/11**。下面的
`desktop` 换成你实际启动 DSH 用的 profile 名。

本包只从 GitHub 分发，暂未发布到 npm。

### 从 GitHub 安装

这种方式要求机器上装了 Git（DSH 安装前会用 `git ls-remote` 检查仓库）：

```sh
dsh plugin --profile desktop add github:nanwu98/dsh-desktop-autostart-win
```

固定到某个版本：

```sh
dsh plugin --profile desktop add github:nanwu98/dsh-desktop-autostart-win#v1.0.0
```

### 从 Release 的 tgz 安装

不需要 Git：

```sh
dsh plugin --profile desktop add https://github.com/nanwu98/dsh-desktop-autostart-win/releases/download/v1.0.0/dsh-desktop-autostart-win-1.0.0.tgz
```

### 从插件页安装

打开 **插件 → 添加插件**，粘贴仓库地址或 Release 的 tgz 地址（只填包名只对已发布到
npm 的包有效）。如果页面提示需要重启 DSH，重启后打开 **设置 → 开机自启**。

## 桌面版是怎么找到的

插件不写死安装路径，按下面的顺序逐个尝试，找到第一个真实存在的可执行文件就停：

| 来源 | 读什么 |
| --- | --- |
| 正在运行的桌面版 | Host 本身就是桌面版时，用 `process.execPath` |
| App Paths | HKCU / HKLM 下 `App Paths\DeepSeek Harness.exe`，64 位和 32 位视图都查 |
| 默认安装目录 | `%LOCALAPPDATA%\Programs`、`%ProgramFiles%`、`%ProgramFiles(x86)%` 加常见产品目录名 |
| 安装器记录 | HKCU / HKLM 卸载项里的 `DisplayIcon`、`InstallLocation`、`UninstallString` |

只接受真实的 `.exe`，并且会排除 `node.exe`、`electron.exe` 和卸载程序。设置页会
显示这次是从哪个来源找到的，方便判断路径为什么是它。找不到时下次打开页面会重试
（结果缓存一分钟）。

因此从普通的 `dsh` 命令行会话里也能用：虽然 CLI 自己跑在 `node.exe` 上，桌面版
仍能从注册表里找到。

## 启动项

Windows 上有两处决定一个启动项会不会运行：`Run` 键和任务管理器的审批记录。插件
写第一处、清除第二处，所以在 **任务管理器 → 启动** 里被禁用的条目，重新打开开关
就会恢复。如果条目存在但仍被禁用，页面会直接说明，而不会假装已经开启。

不需要管理员权限：所有读写都在当前用户下（`HKCU`），不动机器级设置。

## 权限与隐私

只读，用来找程序、报告状态：

- `HKCU\...\CurrentVersion\Run` 和 `...\Explorer\StartupApproved\Run`
- HKCU / HKLM 下的 `App Paths`（64 位和 32 位视图）
- HKCU / HKLM 下的卸载记录（只读显示名、图标、安装目录、卸载命令）

只在操作开关时写入：

- 在当前用户的 `Run` 键里添加或删除 `DeepSeek Harness`
- 删除对应的 `StartupApproved` 值，避免 Windows 继续跳过它

插件**不联网**、**不写文件**、**不上报任何数据**。检测到的路径和注册表值只返回给
本机的设置页（路由拒绝非 loopback 连接，除了那一个布尔开关之外都是只读）。

## 卸载

不想再自启就先关掉开关，再移除插件：

```sh
dsh plugin --profile desktop remove dsh-desktop-autostart-win
```

移除插件会删掉路由和设置页，但不会自动清除启动项。

## 开发

纯 ESM JavaScript，没有构建步骤，没有运行时依赖。跑单元测试：

```sh
npm test
```

测试覆盖注册表输出解析、编码回退、路径清理、审批记录解码和可执行文件名校验，
不会碰真实注册表。

## 兼容性

- DSH `>=0.2.2-rc.1 <0.3.0`（写在 `engines.dsh` 里，版本不符时 DSH 会在安装前拒绝）
- Windows 10/11（`dsh.bundle.platforms` 为 `["win32"]`，其他系统会直接被拒绝，
  而不是装上一个用不了的开关）
- Node.js 22+（DSH 自带的运行时）

## 插件索引

本仓库同时发布一份 format-1 插件索引，可以被内置的「发现」页读取：

- jsDelivr（推荐，`raw.githubusercontent.com` 被墙时也能用）：
  `https://cdn.jsdelivr.net/gh/nanwu98/dsh-desktop-autostart-win@main/index.json`
- GitHub raw：
  `https://raw.githubusercontent.com/nanwu98/dsh-desktop-autostart-win/main/index.json`

在 **插件 → 发现 → 索引源 → 添加索引源** 里填入上面的地址即可。当前 DSH 版本需要
先启用实验性的 `plugin-market` 组合包，「发现」页才会出现。

## 许可证

MIT。本包与其他同名插件没有关系；它管理的是当前用户的 `Run` 键，而不是启动文件夹。
