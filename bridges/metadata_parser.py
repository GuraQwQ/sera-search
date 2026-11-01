"""从标准输入中的现成 HTML 提取页面声明元数据。"""

import contextlib
import json
import logging
import os
import sys
import warnings
from urllib.parse import urljoin, urlsplit


def fail(code, message):
    print(json.dumps({"error": {"code": code, "message": message}}, ensure_ascii=False))
    return 1


def main():
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    sys.stdout.reconfigure(encoding="utf-8", errors="strict", newline="\n")
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict) or not isinstance(payload.get("html"), str):
            return fail("BAD_INPUT", "输入必须是含有 html 字符串和 HTTP URL 的 JSON 对象")
        url = payload.get("url")
        address = urlsplit(url) if isinstance(url, str) else None
        if not address or address.scheme not in ("http", "https") or not address.hostname:
            return fail("BAD_INPUT", "输入必须是含有 html 字符串和 HTTP URL 的 JSON 对象")
    except (ValueError, UnicodeError, TypeError):
        return fail("BAD_INPUT", "输入不是有效的 UTF-8 JSON 对象或 HTTP URL")

    # HTML 已由调用方取得，关闭后缀数据库初始化以避免隐式联网和缓存。
    os.environ["METADATA_PARSER__DISABLE_TLDEXTRACT"] = "1"
    # 桥接文件与依赖同名，避免从当前脚本目录导入自身。
    bridge_directory = os.path.dirname(os.path.abspath(__file__))
    sys.path = [entry for entry in sys.path if os.path.abspath(entry) != bridge_directory]
    logging.disable(logging.CRITICAL)
    warnings.simplefilter("ignore")
    try:
        with open(os.devnull, "w", encoding="utf-8") as quiet:
            with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                import metadata_parser

                page = metadata_parser.MetadataParser(
                    html=payload["html"],
                    url=url,
                    defer_fetch=True,
                    html_encoding="utf-8",
                    derive_encoding=False,
                )
                metadata = page.parsed_result.metadata
    except ModuleNotFoundError:
        return fail("DEPENDENCY_MISSING", "未安装 metadata_parser 或其运行依赖，请先完成安装")
    except Exception:
        return fail("PARSE_FAILED", "metadata_parser 无法解析所提供的 HTML")

    declared_urls = []
    for source, field in (("page", "canonical"), ("meta", "canonical"), ("og", "url"), ("twitter", "url")):
        values = metadata.get(source, {}).get(field, [])
        for value in values if isinstance(values, list) else [values]:
            if not isinstance(value, str) or not value:
                continue
            declaration = {"source": source, "field": field, "value": value}
            try:
                resolved = urljoin(url, value)
                if urlsplit(resolved).scheme in ("http", "https"):
                    declaration["resolvedUrl"] = resolved
            except ValueError:
                pass
            declared_urls.append(declaration)
    print(json.dumps({
        "parser": "metadata_parser",
        "parserVersion": metadata_parser.__VERSION__,
        "inputUrl": url,
        "extraction": "metadata-parser-html",
        "declarationScope": "page-declared",
        "metadata": metadata,
        "declaredUrls": declared_urls,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
