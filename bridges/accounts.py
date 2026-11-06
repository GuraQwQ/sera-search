"""将按站点查询、资料关联与头像比较提供为独立 MCP 工具。"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import copy
import importlib.metadata
import importlib.resources
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.parse import unquote, urlsplit
from urllib.request import getproxies, proxy_bypass
from uuid import uuid4


def cache_directory() -> Path:
    root = Path(os.environ.get("XDG_CACHE_HOME", Path.cwd() / ".sera" / "cache")) / "accounts"
    root.mkdir(parents=True, exist_ok=True)
    return root


def catalog(engine: str) -> tuple[dict, dict]:
    if engine == "aliens-eye":
        from aliens_eye import api

        return api.load_sites(), {"version": importlib.metadata.version("aliens-eye")}
    resource = importlib.resources.files("sherlock_project").joinpath("resources/data.json")
    rules = json.loads(resource.read_text(encoding="utf-8"))
    rules.pop("$schema", None)
    excluded, warnings = [], []
    cached = cache_directory() / "sherlock-exclusions.txt"
    try:
        if not cached.exists() or time.time() - cached.stat().st_mtime > 21600:
            import requests

            response = requests.get(
                "https://raw.githubusercontent.com/sherlock-project/sherlock/refs/heads/exclusions/false_positive_exclusions.txt",
                timeout=4,
            )
            response.raise_for_status()
            temporary = cached.with_name(f".{uuid4().hex}.tmp")
            temporary.write_text(response.text, encoding="utf-8", newline="\n")
            temporary.replace(cached)
    except Exception as error:
        warnings.append(f"误报排除表刷新失败：{type(error).__name__}")
    if cached.exists():
        excluded = [line.strip() for line in cached.read_text(encoding="utf-8").splitlines() if line.strip()]
    else:
        warnings.append("本次没有可用的误报排除表")
    return {name: value for name, value in rules.items() if name not in excluded}, {
        "version": importlib.metadata.version("sherlock-project"),
        "catalogSource": "installed-package",
        "excludedSites": [name for name in excluded if name in rules],
        "warnings": warnings,
    }


def selected_sites(available: dict, names: list[str]) -> dict:
    if not names or any(not isinstance(name, str) or not name.strip() for name in names):
        raise ValueError("sites 需要显式指定至少一个站点；先用 list_sites 发现站点")
    lookup = {name.casefold(): name for name in available}
    unknown = [name for name in names if name.casefold() not in lookup]
    if unknown:
        raise ValueError("站点不存在或已被上游误报表排除：" + ", ".join(unknown))
    return {lookup[name.casefold()]: available[lookup[name.casefold()]] for name in names}


def template(engine: str, value) -> str:
    return value if engine == "aliens-eye" else value["url"]


def proxy_for(address: str, requested: str | None) -> str | None:
    if requested is not None:
        return requested or None
    target = urlsplit(address)
    if proxy_bypass(target.netloc):
        return None
    proxies = getproxies()
    return proxies.get(target.scheme) or proxies.get("all")


async def hash_profiles(profiles: list, requested: str | None, timeout: float):
    from aliens_eye.core import correlate

    if not 0.1 <= timeout <= 120:
        raise ValueError("request_timeout 需要介于 0.1 到 120 秒")
    groups = {}
    for profile in profiles:
        groups.setdefault(proxy_for(profile.avatar, requested), []).append(profile)
    for proxy, group in groups.items():
        await correlate.hash_avatars(group, proxy=proxy, timeout=timeout)


def match_url(engine: str, address: str, sites: dict) -> list[dict]:
    if engine == "aliens-eye":
        from aliens_eye import api

        return [match._asdict() for match in api.match_profile_url(address, sites=sites)]
    matches = []
    for name, rule in sites.items():
        pattern = re.escape(rule["url"].rstrip("/"))
        if pattern.count(r"\{\}") != 1:
            continue
        pattern = pattern.replace(r"\{\}", r"([^/?#&]+)")
        found = re.fullmatch(pattern, address.rstrip("/"), flags=re.IGNORECASE)
        if found:
            matches.append({"site": name, "username": unquote(found[1])})
    return matches


async def worker(engine: str, request: dict, emit) -> None:
    operation, params = request["operation"], request["arguments"]
    if operation in ("list_sites", "scan_username", "match_profile_url"):
        available, metadata = catalog(engine)
    if operation == "list_sites":
        keyword = params.get("query", "").casefold()
        rows = []
        for name, value in available.items():
            url = template(engine, value)
            if keyword and keyword not in name.casefold() and keyword not in url.casefold():
                continue
            rows.append({"name": name, "urlTemplate": url, **({"usernamePattern": value.get("regexCheck")} if engine == "sherlock" and value.get("regexCheck") else {})})
        rows.sort(key=lambda row: row["name"].casefold())
        offset, limit = params.get("offset", 0), params.get("limit", 50)
        emit({"event": "result", "data": {"engine": engine, "sites": rows[offset:offset + limit], "total": len(rows), "returned": len(rows[offset:offset + limit]), "truncated": offset + limit < len(rows), "nextOffset": offset + limit if offset + limit < len(rows) else None, **metadata}})
    elif operation == "match_profile_url":
        matches = match_url(engine, params["url"], available)
        emit({"event": "result", "data": {"engine": engine, "url": params["url"], "matches": matches, **metadata}})
    elif operation == "scan_username":
        sites = selected_sites(available, params["sites"])
        username = params["username"].strip()
        if not username or any(char.isspace() for char in username):
            raise ValueError("username 需要完整用户名或平台 ID")
        emit({"event": "scope", "data": {"sites": list(sites), **metadata}})
        if engine == "aliens-eye":
            from aliens_eye import api
            from aliens_eye.core.exporter import ResultsExporter

            # 按真实目标分组承接代理配置，NO_PROXY 站点继续直连。
            groups, observed = {}, {}
            for name, value in sites.items():
                route = proxy_for(api.profile_url(name, username, sites=sites), params.get("proxy"))
                groups.setdefault(route, {})[name] = value
            def on_result(user, result):
                observed.setdefault(user, []).append(result)
                emit({"event": "row", "row": {**result, "username": user}})
            for proxy, group in groups.items():
                report = await api.scan(username, params.get("level", "basic"), sites=group,
                                        use_ml=params.get("use_ml", True), proxy=proxy, quiet=True, on_result=on_result)
            if len(groups) > 1:
                report = ResultsExporter(cache_directory()).report_dict(username, params.get("level", "basic"), observed)
        else:
            from sherlock_project.notify import QueryNotify
            from sherlock_project.sherlock import sherlock

            class Notify(QueryNotify):
                def update(self, result):
                    emit({"event": "row", "row": {"site": result.site_name, "username": result.username,
                         "url": result.site_url_user, "status": str(result.status), "response_time": result.query_time,
                         "context": result.context}})

            result = sherlock(username, copy.deepcopy(sites), Notify(), proxy=params.get("proxy"),
                              timeout=min(8, params["timeout_seconds"]))
            report = {"username": username, "sites": {name: {"url": item["url_user"],
                      "status": str(item["status"].status), "http_status": item["http_status"],
                      "context": item["status"].context, "response_time": item["status"].query_time}
                      for name, item in result.items()}}
        emit({"event": "result", "data": {"report": report}})
    elif operation in ("correlate_profiles", "compare_avatars"):
        from aliens_eye.core import correlate

        if operation == "compare_avatars":
            urls = params["avatar_urls"]
            if len(urls) < 2 or any(urlsplit(url).scheme not in ("http", "https") for url in urls):
                raise ValueError("avatar_urls 需要至少两个 HTTP 或 HTTPS 图片 URL")
            profiles = [correlate.Profile(str(index), "avatar", "", "", url, url, "Found") for index, url in enumerate(urls)]
            await hash_profiles(profiles, params.get("proxy"), params.get("request_timeout", 8))
            pairs = [{"left": left.avatar, "right": right.avatar,
                      "hammingDistance": (left.avatar_hash ^ right.avatar_hash).bit_count(),
                      "similar": (left.avatar_hash ^ right.avatar_hash).bit_count() <= correlate.AVATAR_MAX_HAMMING}
                     for index, left in enumerate(profiles) for right in profiles[index + 1:]
                     if left.avatar_hash is not None and right.avatar_hash is not None]
            emit({"event": "result", "data": {"engine": engine, "method": "dhash-64", "threshold": correlate.AVATAR_MAX_HAMMING,
                 "pairs": pairs, "images": [{"url": profile.avatar, "hash": format(profile.avatar_hash, "016x") if profile.avatar_hash is not None else None,
                                             "status": "ok" if profile.avatar_hash is not None else "unavailable"} for profile in profiles]}})
            return
        report = params["report"]
        report = report.get("report", report)
        if not isinstance(report.get("variations"), dict):
            raise ValueError("report 需要 Aliens_eye 的 variations 报告或包含 report 的扫描结果")
        profiles = correlate.profiles_from_report(report)
        if params.get("sites"):
            names = {name.casefold() for name in params["sites"]}
            profiles = [profile for profile in profiles if profile.site.casefold() in names]
        observed = [profile.to_dict() for profile in profiles]
        signals = params.get("signals", ["name", "bio", "links", "handles"])
        if (not signals and not params.get("avatar_match")) or set(signals) - {"name", "bio", "links", "handles"}:
            raise ValueError("signals 可选择 name、bio、links、handles；头像匹配由 avatar_match 控制")
        for profile in profiles:
            if "name" not in signals:
                profile.name = ""
            if "bio" not in signals:
                profile.bio = ""
            if "links" not in signals:
                profile.links = set()
            if "handles" not in signals:
                profile.handles = set()
        if params.get("avatar_match"):
            await hash_profiles(profiles, params.get("proxy"), params.get("request_timeout", 8))
        common = correlate._common_names(profiles)
        edges = [{"from": left.key, "to": right.key, "reason": reason}
                 for index, left in enumerate(profiles) for right in profiles[index + 1:]
                 if (reason := correlate._pair_reason(left, right, common))]
        emit({"event": "result", "data": {"engine": engine, "signals": signals,
             "avatarMatch": params.get("avatar_match", False), "avatarHashingAvailable": correlate.pillow_available(),
             "profiles": observed, "edges": edges, "clusters": correlate.cluster_profiles(profiles)}})
    else:
        raise ValueError("未知账号操作")


def scan_result(engine: str, arguments: dict, events: list[dict], scan_id: str) -> dict:
    rows = list({(event["row"]["username"], event["row"]["site"]): event["row"] for event in events if event.get("event") == "row"}.values())
    scope = next((event["data"] for event in events if event.get("event") == "scope"), {"sites": arguments["sites"]})
    completed = next((event["data"] for event in reversed(events) if event.get("event") == "result"), None)
    error = next((event["error"] for event in reversed(events) if event.get("event") == "error"), None)
    pending = [] if completed else [site for site in scope["sites"] if not any(row["site"] == site and row["username"] == arguments["username"].strip() for row in rows)]
    if completed:
        report = completed["report"]
    elif engine == "aliens-eye":
        variations = {}
        for row in rows:
            variations.setdefault(row["username"], {"sites": {}})["sites"][row["site"]] = row
        report = {"variations": variations}
    else:
        report = {"username": arguments["username"], "sites": {row["site"]: row for row in rows}}
    if completed and engine == "sherlock":
        rows = [{**row, **report["sites"].get(row["site"], {})} for row in rows]
    failures = sum(row["status"].casefold() in {"timeout", "error", "unknown", "waf", "illegal"} for row in rows)
    status = ("error" if failures == len(rows) and failures else "partial" if failures else "ok") if completed else "partial" if rows else "error"
    if status == "error" and error is None:
        error = {"code": "SOURCE_UNAVAILABLE", "message": "本轮站点均未取得可判断账号存在性的响应，请查看各站状态"}
    return {"engine": engine, "status": status, "scanId": scan_id,
            "rows": rows, "report": report, "scope": scope, "pendingSites": pending,
            "completed": completed is not None,
            "unresolvedVariations": completed is None and arguments.get("level", "basic") != "basic",
            **({"error": error} if error else {})}


async def invoke(engine: str, operation: str, arguments: dict, timeout: float) -> dict:
    if not 0.1 <= timeout <= 300:
        raise ValueError("timeout_seconds 需要介于 0.1 到 300 秒")
    events, scan_id = [], uuid4().hex
    checkpoint, process = None, None
    if operation == "scan_username":
        checkpoint = (cache_directory() / f"{scan_id}.jsonl").open("w", encoding="utf-8", newline="\n")
        checkpoint.write(json.dumps({"engine": engine, "arguments": {key: arguments[key] for key in ("username", "sites", "level") if key in arguments}}, ensure_ascii=False) + "\n")
        checkpoint.flush()
    async def receive():
        process.stdin.write(json.dumps({"operation": operation, "arguments": arguments}).encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()
        while line := await process.stdout.readline():
            event = json.loads(line)
            events.append(event)
            if checkpoint:
                checkpoint.write(json.dumps(event, ensure_ascii=False) + "\n")
                checkpoint.flush()
        await process.wait()
    try:
        process = await asyncio.create_subprocess_exec(sys.executable, str(Path(__file__).resolve()), "--engine", engine, "--worker",
                                                     stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.DEVNULL, limit=8 * 1024 * 1024,
                                                     creationflags=0x08000000 if os.name == "nt" else 0)
        await asyncio.wait_for(receive(), timeout)
    except TimeoutError:
        error = {"event": "error", "error": {"code": "TIMEOUT", "message": "本轮预算已用完，已保留完成的站点结果"}}
        events.append(error)
        if checkpoint:
            checkpoint.write(json.dumps(error, ensure_ascii=False) + "\n")
    finally:
        if process is not None and process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()
        if checkpoint:
            checkpoint.close()
    if operation == "scan_username":
        return scan_result(engine, arguments, events, scan_id)
    for event in reversed(events):
        if event.get("event") == "result":
            return event["data"]
        if event.get("event") == "error":
            raise ValueError(event["error"]["message"])
    raise ValueError(f"{engine} 操作未返回结果，退出码 {process.returncode}")


def serve(engine: str):
    from mcp.server.mcpserver import MCPServer

    server = MCPServer(f"sera-{engine}")

    @server.tool()
    async def list_sites(query: str = "", offset: int = 0, limit: int = 50) -> dict:
        """发现可选站点、URL 模板和用户名格式；query 筛站点名或域名。"""
        if offset < 0 or not 1 <= limit <= 1000:
            raise ValueError("offset 需要非负，limit 需要介于 1 到 1000")
        return await invoke(engine, "list_sites", {"query": query, "offset": offset, "limit": limit}, 10)

    @server.tool()
    async def scan_username(username: str, sites: list[str], level: str = "basic", timeout_seconds: float = 10,
                            proxy: str | None = None, use_ml: bool = True) -> dict:
        """只扫描显式指定的站点；按任务设置预算。超时返回部分结果，scanId 可用于读取已完成结果。"""
        if not sites or level not in ("basic", "intermediate", "advanced"):
            raise ValueError("sites 需要非空；level 需要 basic/intermediate/advanced")
        if engine == "sherlock" and level != "basic":
            raise ValueError("Sherlock 按一个完整用户名查询；变体由 agent 分次提供")
        return await invoke(engine, "scan_username", {"username": username, "sites": sites, "level": level,
                            "proxy": proxy, "use_ml": use_ml, "timeout_seconds": timeout_seconds}, timeout_seconds)

    @server.tool()
    def read_scan(scan_id: str | None = None) -> dict:
        """读取保存的扫描结果；省略 scan_id 列出最近记录，可恢复被中断调用已经完成的站点。"""
        if scan_id is None:
            scans = []
            for path in sorted(cache_directory().glob("*.jsonl"), key=lambda item: item.stat().st_mtime, reverse=True):
                try:
                    with path.open(encoding="utf-8") as handle:
                        header = json.loads(handle.readline())
                    if header["engine"] == engine:
                        scans.append({"scanId": path.stem, **header["arguments"], "modifiedAt": path.stat().st_mtime})
                except (OSError, ValueError, KeyError):
                    continue
                if len(scans) >= 20:
                    break
            return {"engine": engine, "scans": scans}
        if not re.fullmatch(r"[a-f0-9]{32}", scan_id):
            raise ValueError("scan_id 需要扫描返回的 32 位标识")
        lines = (cache_directory() / f"{scan_id}.jsonl").read_text(encoding="utf-8").splitlines()
        header = json.loads(lines[0])
        if header["engine"] != engine:
            raise ValueError("扫描记录属于另一个账号引擎")
        events = []
        for line in lines[1:]:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                break
        return scan_result(engine, header["arguments"], events, scan_id)

    @server.tool()
    async def match_profile_url(url: str) -> dict:
        """从已知主页 URL 反查可能的平台和用户名；只做目录匹配。"""
        if urlsplit(url).scheme not in ("http", "https"):
            raise ValueError("url 需要 HTTP 或 HTTPS 主页地址")
        return await invoke(engine, "match_profile_url", {"url": url}, 10)

    @server.tool()
    def extract_leads(text: str) -> dict:
        """从已读取的简介或文本提取外链和 @用户名，供 agent 选择下一轮查询。"""
        return {"urls": sorted(set(re.findall(r"https?://[^\s\"'<>]+", text))),
                "handles": sorted(set(re.findall(r"(?<![\w@])@([\w.-]{2,64})", text)))}

    if engine == "aliens-eye":
        @server.tool()
        async def correlate_profiles(report: dict, sites: list[str] | None = None, avatar_match: bool = False,
                                     signals: list[str] | None = None, timeout_seconds: float = 10,
                                     proxy: str | None = None, request_timeout: float = 8) -> dict:
            """关联选定报告中的候选资料。返回逐边依据和分组；avatar_match 显式启用头像抓取与相似度匹配。"""
            arguments = {"report": report, "sites": sites, "avatar_match": avatar_match,
                         "proxy": proxy, "request_timeout": request_timeout}
            if signals is not None:
                arguments["signals"] = signals
            return await invoke(engine, "correlate_profiles", arguments, timeout_seconds)

        @server.tool()
        async def compare_avatars(avatar_urls: list[str], timeout_seconds: float = 10,
                                  proxy: str | None = None, request_timeout: float = 8) -> dict:
            """按指定图片 URL 比较 64 位 dHash；未成功取得或解码的图片单独报告。"""
            return await invoke(engine, "compare_avatars", {"avatar_urls": avatar_urls, "proxy": proxy,
                                "request_timeout": request_timeout}, timeout_seconds)

    server.run(transport="stdio")


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=("aliens-eye", "sherlock"), required=True)
    parser.add_argument("--worker", action="store_true")
    arguments = parser.parse_args()
    if not arguments.worker:
        serve(arguments.engine)
        return
    wire = sys.stdout
    def emit(event):
        wire.write(json.dumps(event, ensure_ascii=False) + "\n")
        wire.flush()
    try:
        request = json.load(sys.stdin)
        # 上游日志与协议使用不同流，扫描中断也不会污染 MCP 输出。
        with contextlib.redirect_stdout(sys.stderr):
            asyncio.run(worker(arguments.engine, request, emit))
    except Exception as error:
        emit({"event": "error", "error": {"code": type(error).__name__, "message": str(error)}})


if __name__ == "__main__":
    main()
