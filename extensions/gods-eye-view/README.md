# SERA 地理空间扩展

该扩展吸收 [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) 的查询、来源解析、轨道计算及数据提供者模块，在独立 Node.js 进程内提供 MCP stdio 工具。Agent 按任务选择具体领域、区域、对象和查询深度；结构化结果交给 SERA 保存为证据，图像按本次 MCP 内容返回。

## 安装和运行

扩展需要 Node.js 24 或更高版本，原因是天气风场使用的 ecCodes WebAssembly 需要该运行时。SERA 的组件安装会准备扩展依赖并检测已有 Node.js；缺失时给出版本要求和下载入口。

```powershell
node dist/cli.js install --home F:/tools/sera-data --components gods-eye-view
node dist/cli.js backend gods-eye-view --home F:/tools/sera-data --json
```

独立安装时，在此目录运行 `npm install --omit=dev --ignore-scripts`，随后 `node server.mjs --check` 验证依赖、提供者入口、工具合同及 WASM。`node server.mjs` 启动 MCP stdio。`--check` 只执行离线检查。

SERA 将组件放在 `<home>/tools/gods-eye-view`，运行缓存位于受管理的 `XDG_CACHE_HOME/gods-eye-view`。依赖锁文件记录可复现输入；源码版本由 `vendor/UPSTREAM.json` 记录。组件更新由 SERA 维护者核对上游 API、来源合同与所需依赖后执行。

## 工具范围

当前提供 36 个工具，输入以实际发现的 Schema 为准。

| 领域 | 工具 |
|---|---|
| 航空 | `aircraft_in_area`、`find_aircraft`、`get_aircraft_info`、`get_aircraft_track` |
| 航运 | `vessels_in_area`、`find_vessel`、`get_vessel_track` |
| 航天 | `get_recent_launches`、`satellites_overhead`、`next_satellite_pass` |
| 灾害及环境 | `get_earthquakes`、`get_active_fires`、`get_fire_perimeters`、`get_cyclones`、`get_recent_imagery` |
| 气象及高程 | `get_weather`、`get_weather_map`、`get_wind`、`get_terrain_height` |
| 基础设施及地理 | `find_infrastructure`、`get_map_features`、`find_military_installations`、`find_alpr_cameras` |
| 公开摄像头及广播 | `list_camera_regions`、`find_cctv_cameras`、`get_cctv_snapshot`、`find_radio_stations` |
| 地点及交通 | `search_places`、`places_nearby`、`plan_route`、`get_bike_share`、`get_transit_vehicles`、`get_traffic_flow` |
| 综合查询 | `get_regional_brief`、`situation_brief`、`military_awareness` |

数据提供者在首次请求对应路由时初始化。初始化 MCP 和发现工具不发起网络访问。内部 `fetch` 路由直接组合 Node 数据提供者，处理请求正文、响应状态与取消，不监听 HTTP 端口。

## 按任务查询

```json
{"source":"gods-eye-view","tool":"get_weather","arguments":{"location":{"lat":35.68,"lon":139.76}}}
```

```json
{"source":"gods-eye-view","tool":"find_infrastructure","arguments":{"kind":"datacenters","area":{"lat":51.5,"lon":-0.12,"radius_km":100},"limit":5}}
```

```json
{"source":"gods-eye-view","tool":"satellites_overhead","arguments":{"location":{"lat":35.68,"lon":139.76},"group":"stations","limit":5}}
```

地点参数可以使用明确经纬度；地名解析依赖已配置的上游地理编码入口。OpenStreetMap 查询入口及上游节流规则继续生效，返回不可用或等待状态时保留原因。

## 区域采样与后续深度

AIS 采样使用 `area` 和 `collect_seconds`（1–60 秒，默认 5 秒）。首次查询必须提供区域，订阅包中的 `BoundingBoxes` 使用实际区域范围；跨日界线区域拆成两个边界框。一次采样结束、取消或断开后关闭连接。同一 API Key 的请求串行使用连接，互不叠加。结果保留订阅起止时间、区域、采样时长及收到的消息数。

```json
{"source":"gods-eye-view","tool":"vessels_in_area","timeoutMs":30000,"arguments":{"area":{"lat":33.75,"lon":-118.2,"radius_km":20},"collect_seconds":8,"limit":10}}
```

`find_vessel` 可传区域继续采样，也可查询当前进程之前已取得的样本。`get_vessel_track` 只返回本进程采样期间保留的近期轨迹。区域短时采样与累计样本始终声明 `complete:false`，空结果表示本次采样未取得符合记录。

公开摄像头先按 `area` 选取相交目录，也可用 `camera_regions` 明确选目录。`list_camera_regions` 返回可选目录及选择边界。后续快照读取复用已发现的摄像头，仅请求所选摄像头的真实静态图像；实时视频只提供目录线索。目录数据的缺失、缓存年龄和裁剪范围保留在结果中。

综合查询会访问多个领域，适合需要综合情况的任务；单一字段问题直接选择对应工具。

## 凭据、网络和材料性质

| 来源 | 条件和返回范围 |
|---|---|
| Open-Meteo、USGS、CelesTrak、Launch Library 2、NOAA、ECMWF | 公开接口，受来源配额、覆盖和网络影响；LL2 可配置 `LL2_API_TOKEN` |
| OpenSky、adsb.lol、adsbdb | 航空位置及补充记录；OpenSky 可选原生认证配置，覆盖及回退状态保留 |
| AISStream | 配置 `AISSTREAM_API_KEY`，按指定区域短时订阅 |
| NASA FIRMS | 实时火点配置 `FIRMS_MAP_KEY`；原始来源及过期状态保留 |
| TomTom | 配置 `TOMTOM_API_KEY`，查询路段流速和拥堵记录 |
| Google Places | 配置 `GOOGLE_MAPS_SERVER_API_KEY` 或上游共享 key；服务提供方配额与计费生效 |
| OpenStreetMap／Nominatim／Overpass | `NOMINATIM_URL` 配置地理编码入口，`OVERPASS_UPSTREAMS` 配置逗号分隔的 Overpass 实例；按上游限速及实际响应查询，保留提供方归属 |
| 数据中心、水坝 | 随包 ODbL 数据快照；覆盖与更新日期由各数据目录说明 |
| 摄像头、广播、共享单车和公共交通 | 覆盖已接入的区域或系统，来源失败和记录截断保留 |

网络使用 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 与 `NO_PROXY`；支持 HTTP 与 SOCKS 代理，AIS WebSocket 使用相同代理选择。凭据由运行环境传入，来源追踪中的 URL 对凭据值作隐藏处理。

结果中的观测时间、计算时间、抓取时间、`stale`、`missing_sources`、回退来源和 `truncated` 各有独立含义。卫星位置及过境为 TLE 轨道预测；风场为数值预报；火点是遥感检测记录；目录中的摄像头位置、方向和基础设施属性来自提供方声明。来源抓取 URL、时间和本轮采集范围附于 `provenance`。

## 验证范围

已验证 Node.js 24 的离线依赖／WASM／36 工具组合，Open-Meteo 天气、Launch Library 2 发射记录、CelesTrak 轨道目录、GFS 风场及真实 GRIB 解码、地面高程和 ODbL 基础设施查询。小型本地测试覆盖查询合同、取消前置检查、AIS 区域订阅与释放、摄像头目录选择及进程内 GET／POST 路由。

需要凭据的实时 AIS、FIRMS 和 TomTom 尚未实测；各公开数据源的所有地区、平台与时段没有逐一验收。

许可与来源见 [THIRD_PARTY.md](THIRD_PARTY.md) 和 [vendor/UPSTREAM.json](vendor/UPSTREAM.json)。
