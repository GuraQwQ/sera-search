# 来源与许可

## 吸收的源码

- 上游：[bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
- 提交：`39d47a99ab791bf16ada4ce9778d32cc31e3d549`
- 源码许可：MIT，Copyright (c) 2026 Bilawal Sidhu；完整文本保存在 [vendor/LICENSE](vendor/LICENSE)。
- 每个吸收文件的路径、上游 SHA-256 与修改标记见 [vendor/UPSTREAM.json](vendor/UPSTREAM.json)。

本扩展保留便携查询函数、输入验证、MCP 协议、来源解析、轨道及坐标计算、数据提供者和所需依赖闭包。SERA 编写独立进程内数据路由、采样生命周期、区域目录选择和来源证据封装。`vendor/src/tools/services.js` 调整为本扩展服务组合；`vendor/src/tools/views.js` 按结构化查询用途简化。

上游项目中的 TeleGeography 海底电缆数据、Bhote Koshi 场景数据、模型、图像和演示素材按其各自许可归属上游数据提供者。该扩展分发文件清单由 `vendor/UPSTREAM.json` 明确列出。

## 随包数据

| 数据 | 许可及归属 | 说明 |
|---|---|---|
| `vendor/src/data/local_data/datacenters/datacenters.geojsonl` | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)，© OpenStreetMap contributors | 独立派生数据库，保留上游数据快照；原始提取日期部分未记录，挪威部分为 2026-10-05 数据 |
| `vendor/src/data/local_data/dams/dams.geojsonl` | ODbL 1.0，© OpenStreetMap contributors，经 Open Infrastructure Map | 独立派生数据库，保留上游数据快照 |

上述数据继续按 ODbL 提供，保留数据目录的 README 与查询结果中的 attribution；SERA 的 MIT 源码许可不改变数据许可。

## 运行时来源

USGS、CelesTrak、OpenSky、adsb.lol、adsbdb、AISStream、NASA FIRMS、NOAA、ECMWF、Open-Meteo、Launch Library 2、Google Places、TomTom、OpenStreetMap、Nominatim、Overpass、Radio Browser、GBFS、城市公共交通与公开摄像头数据仍归各自提供方。查询结果保留来源归属、原始时间、回退及不完整范围。公开访问能力、API Key 与数据再利用条件分别遵循提供方规则。

完整上游逐源材料说明：[DATA_SOURCES.md](https://github.com/bilawalsidhu/gods-eye-view/blob/39d47a99ab791bf16ada4ce9778d32cc31e3d549/DATA_SOURCES.md)。

## 运行依赖

| 依赖 | 用途 | 许可 |
|---|---|---|
| satellite.js | TLE 轨道计算与过境预测 | MIT |
| @meri-imperiumi/eccodes-wasm | GFS／ECMWF GRIB2 解码 | Apache-2.0 |
| @mapbox/vector-tile、pbf | OpenStreetMap 矢量数据解析 | BSD-3-Clause |
| ws | 区域 AIS WebSocket | MIT |
| undici、proxy-from-env、https-proxy-agent、socks-proxy-agent | HTTP／SOCKS 代理与数据请求 | MIT |

依赖版本范围对应已接入的 API 与运行时格式，依赖锁文件记录安装输入。更新由 SERA 维护者核对相应查询功能后执行。
