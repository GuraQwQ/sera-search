import { spawn } from 'node:child_process';
import type { Config, Source } from '../types.js';
import { document, object, response, string, textResponse } from './shared.js';
import { integrationEnvironment } from '../components.js';

const outputLimit = 4 * 1024 * 1024;
const bridgeErrors: Record<string, string> = {
  BAD_INPUT: 'metadata_parser 输入不是有效的 HTML 与 HTTP URL JSON 对象',
  DEPENDENCY_MISSING: '未安装 metadata_parser 或其运行依赖，请先完成安装',
  PARSE_FAILED: 'metadata_parser 无法解析所提供的 HTML',
};
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

export async function extractMetadata(config: Config, html: string, url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  const command = config['metadata-parser'];
  if (!command || command.enabled === false || !command.command.trim()) throw failure('NEED_SETUP', '请启用并配置 metadata_parser 的 Python 桥接入口');
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
  const env = await integrationEnvironment(config.home);
  return new Promise((accept, reject) => {
    const child = spawn(command.command, command.args, {
      shell: false, windowsHide: true, signal: boundedSignal, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, METADATA_PARSER__DISABLE_TLDEXTRACT: '1' },
    });
    const stdout: Buffer[] = [];
    let size = 0, settled = false;
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.on('error', (error: NodeJS.ErrnoException) => rejectOnce(boundedSignal.aborted ? boundedSignal.reason
      : failure(error.code === 'ENOENT' ? 'COMMAND_NOT_FOUND' : 'PROCESS_FAILED', 'metadata_parser Python 进程无法启动，请检查桥接配置')));
    const collect = (chunk: Buffer, keep: boolean) => {
      if (settled) return;
      size += chunk.length;
      if (size > outputLimit) {
        rejectOnce(failure('OUTPUT_LIMIT', 'metadata_parser 输出超过 4 MiB 限制'));
      } else if (keep) stdout.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
    child.stdin.on('error', () => rejectOnce(boundedSignal.aborted ? boundedSignal.reason : failure('PROCESS_FAILED', 'metadata_parser 进程未能接收 HTML 输入')));
    child.on('close', code => {
      if (settled) return;
      if (boundedSignal.aborted) return rejectOnce(boundedSignal.reason);
      let result: Record<string, unknown>;
      try { result = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout))), 'metadata_parser'); }
      catch { return rejectOnce(failure('BAD_OUTPUT', 'metadata_parser 未返回有效的 JSON 对象')); }
      if (result.error && typeof result.error === 'object') {
        if (Array.isArray(result.error)) return rejectOnce(failure('BAD_OUTPUT', 'metadata_parser 返回了无效的错误对象'));
        const errorCode = string((result.error as Record<string, unknown>).code);
        return rejectOnce(failure(bridgeErrors[errorCode] ? errorCode : 'PROCESS_FAILED', bridgeErrors[errorCode] ?? 'metadata_parser 进程执行失败'));
      }
      if (code !== 0) return rejectOnce(failure('PROCESS_FAILED', `metadata_parser 进程退出失败，退出码 ${String(code)}`));
      if (result.parser !== 'metadata_parser' || !result.metadata || typeof result.metadata !== 'object' || Array.isArray(result.metadata)) {
        return rejectOnce(failure('BAD_OUTPUT', 'metadata_parser 返回结果缺少分组元数据'));
      }
      settled = true;
      accept(result);
    });
    child.stdin.end(JSON.stringify({ html, url }), 'utf8');
  });
}

export function createMetadataSource(config: Config): Source {
  const command = config['metadata-parser'];
  const configured = Boolean(command && command.enabled !== false && command.command.trim());
  return {
    capability: { name: 'metadata-parser', search: false, read: true, configured, category: 'web', requirement: '配置 metadata_parser Python 桥接，读取 HTML 中的页面声明元数据' },
    async read(url, signal) {
      if (!configured) throw failure('NEED_SETUP', '请启用并配置 metadata_parser 的 Python 桥接入口');
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw failure('BAD_INPUT', '元数据读取仅支持 HTTP 或 HTTPS 链接');
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
      const page = await response(url, { signal: boundedSignal, headers: { 'User-Agent': config.web?.userAgent ?? 'SERA metadata-reader', Accept: 'text/html,application/xhtml+xml' } }, '页面元数据');
      const type = page.headers.get('content-type') ?? '';
      if (type && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type.trim())) {
        await page.body?.cancel();
        throw failure('UNSUPPORTED_CONTENT', 'metadata_parser 读取需要 HTML 页面');
      }
      const decoded = await textResponse(page), actualUrl = page.url || url;
      const extracted = await extractMetadata(config, decoded.text, actualUrl, boundedSignal);
      const grouped = object(extracted.metadata, 'metadata_parser');
      let title = '';
      for (const name of ['page', 'og', 'twitter', 'meta']) {
        const group = grouped[name];
        if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
        const value = (group as Record<string, unknown>).title;
        title = string(Array.isArray(value) ? value[0] : value);
        if (title) break;
      }
      return document('metadata-parser', url, title || url, JSON.stringify(extracted, null, 2), {
        contentKind: 'metadata',
        metadata: { ...extracted, requestedUrl: url, actualUrl, httpStatus: page.status, encoding: decoded.encoding, contentScope: 'page-declared-metadata' },
      });
    },
  };
}
