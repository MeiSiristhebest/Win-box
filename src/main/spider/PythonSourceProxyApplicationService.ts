import type { SourceBean } from '../../shared/types';

export interface PythonProxySourceLookupPort {
  forRequest(sourceKey: string, profileId?: string): SourceBean | null;
}

export interface PythonSpiderProxyPort {
  proxy(params: Record<string, string>): Promise<string> | string;
}

export interface PythonSpiderFactoryPort {
  createForSource(source: SourceBean): PythonSpiderProxyPort;
}

export interface PythonSourceProxyPorts {
  sources: PythonProxySourceLookupPort;
  spiders: PythonSpiderFactoryPort;
}

/** Executes a Python-backed source proxy without exposing runtime construction to IPC. */
export class PythonSourceProxyApplicationService {
  constructor(private readonly ports: PythonSourceProxyPorts) {}

  async execute(
    sourceKey: string,
    params: Record<string, string>,
    profileId?: string,
  ): Promise<unknown[]> {
    const source = this.ports.sources.forRequest(sourceKey, profileId);
    if (!source || !/\.py(?:[?#]|$)/i.test(source.api || '')) {
      throw new Error('Python 代理源不存在');
    }

    const serializedResult = await this.ports.spiders.createForSource(source).proxy(params);
    const result: unknown = JSON.parse(serializedResult);
    if (!Array.isArray(result)) throw new Error('Python 源未返回有效代理响应');
    return result;
  }
}
