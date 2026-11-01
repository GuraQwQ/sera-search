# 第三方归属与许可

SERA 自身代码采用 [MIT 许可证](LICENSE)。外部组件、服务与来源材料保留各自的许可和使用条款。可选组件由 `install --components` 下载到用户选定的数据目录；接入方式与兼容责任见[扩展来源与后端](docs/integrations.md)。

以下归属根据 2026-11-01 的上游仓库和许可文件核对。

| 项目 | 作者／维护者与上游 | 许可 | SERA 中的用途 |
|---|---|---|---|
| ghgrab | Abhinav A；[abhixdd/ghgrab](https://github.com/abhixdd/ghgrab) | [MIT](https://github.com/abhixdd/ghgrab/blob/v2.3.0/LICENSE) | 可选仓库工具，适配 v2.3.0 的 Agent API v1 与 MCP |
| Scrapling | Karim shoair 与贡献者；[D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling) | [BSD-3-Clause](https://github.com/D4Vinci/Scrapling/blob/main/LICENSE) | 可选 HTTP／浏览器提取及会话后端 |
| metadata_parser | Jonathan Vanasco 与贡献者；[jvanasco/metadata_parser](https://github.com/jvanasco/metadata_parser) | [MIT](https://github.com/jvanasco/metadata_parser/blob/main/LICENSE.txt) | 可选 Python 依赖，解析已取得 HTML 的声明元数据 |
| Free-TV IPTV | [Free-TV/IPTV](https://github.com/Free-TV/IPTV) 的维护者和目录贡献者 | 核对时仓库未提供独立 LICENSE | 运行时读取公开 M3U 频道目录，SERA 自行解析目录字段 |
| Google News Scraper 参考项目 | [Oxylabs](https://github.com/oxylabs/google-news-scraper) | 核对时仓库未提供独立 LICENSE | 功能参考；SERA 独立实现公开 Google News RSS 查询和解析 |

Google News RSS 内容与聚合链接归对应服务及原始发布者；RSS 记录和发布者文章按各自条款使用。IPTV 的频道标识、logo、EPG、流链接和视听内容归相应发布者或权利人，目录收录与实际播放条件分别确认。上述两个仓库的许可状态不扩展为 SERA 的 MIT 授权。

metadata_parser 的上游许可还说明其部分代码来自其他宽松许可项目，包括 Apache-2.0 许可的 Requests；具体归属随上游包内对应文件保留。浏览器分发包和其他传递依赖也保留各自许可。

## MIT 组件许可

适用于 ghgrab 与 metadata_parser，各自版权声明为：

```text
ghgrab: Copyright (c) 2025 Abhinav A
metadata_parser: Copyright (c) 2012-2018, Jonathan Vanasco <jonathan@findmeon.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Scrapling 的 BSD-3-Clause 许可

```text
BSD 3-Clause License

Copyright (c) 2024, Karim shoair

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
