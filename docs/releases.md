# Windows 发布包

GitHub Releases 提供 Windows x64 ZIP，解压后在目录中运行 `sera.cmd`。启动时检测本机程序，缺失时显示所需版本与官方下载地址。配置、证据和运行缓存默认写入同目录的 `data/`，也可通过 `--home`／`SERA_HOME` 选择目录。

| 发布包 | 内容 |
|---|---|
| `SERA-v版本-lite-windows-x64.zip` | SERA 核心、生产依赖、文档与扩展源码；可选组件尚未安装 |
| `SERA-v版本-full-windows-x64.zip` | 轻量版全部内容，以及 ghgrab、Scrapling、metadata_parser、Aliens_eye、Sherlock、地理扩展的生产依赖 |

轻量版需要本机 Node.js 22+；完整版完整能力需要 Node.js 24+、Python 3.13 x64 和 Chromium／Edge／Chrome。完整版携带的 Python 原生扩展对应 CPython 3.13 Windows x64，解释器版本需要匹配。启动器先检测 PATH、Windows Python Launcher 和常见浏览器位置，可用 `SERA_NODE`、`SERA_PYTHON`、`SERA_BROWSER` 指定已有程序。

下载入口：[Node.js](https://nodejs.org/en/download)、[Python](https://www.python.org/downloads/windows/)、[Edge](https://www.microsoft.com/edge/download)。

```powershell
.\sera.cmd --version
.\sera.cmd --check-env
.\sera.cmd capabilities --sources bing,web --json
.\sera.cmd research "TypeScript 官方发布说明" --sources bing --read-sources web --json
```

完整版首次运行会准备组件入口；缺少程序时保留其他可用组件，补齐环境后再次启动即可检测。移动整个解压目录后再次运行 `sera.cmd`，启动器会更新由发布包生成的路径，保留用户自定义的组件设置与启用状态。MCP 客户端将 `command` 指向已有 `node.exe`，`args` 使用 `portable.mjs` 的绝对路径和 `mcp`，以获得同样的检测、依赖路径和配置准备。

完整版携带扩展依赖，数据查询仍按上游网络、覆盖、凭据及配额工作。API Key 经 `login` 或对应扩展的运行环境提供。来源和数据许可见 [THIRD_PARTY.md](../THIRD_PARTY.md) 与[地理扩展许可](../extensions/gods-eye-view/THIRD_PARTY.md)；随包依赖的版本和归属见 `DEPENDENCIES.json` 及包内许可。

下载后可将 `Get-FileHash 文件名 -Algorithm SHA256` 的结果与发布附件 `SHA256SUMS.txt` 对照。

## 构建

在 Windows x64 源码工作区准备 ghgrab 及 `.cache/release-input/python-packages` 后运行 `npm run release:windows`。Python 依赖目录包含 `SERA_PACKAGES.json`，排除解释器、浏览器和驱动内的 Node 运行时，保留包内许可及原生扩展。`SERA_BUILD_PYTHON` 选择构建时已有的 Python 3.13。构建从 npm 发布清单提取项目文件，安装生产依赖，验证环境程序未被打包及 ZIP 完整性，输出到 `.cache/releases/v版本/`，成功或失败都会回收本轮暂存目录。

发布前应解压两个 ZIP 到新目录，验证轻量版默认组件状态，以及完整版的工具发现、动态页面读取和目录移动后的路径更新。源代码的轻量跨平台 CI 独立验证类型、构建及发布文件清单。
