import { mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NATIVE_RUNTIME_ARTIFACTS, NATIVE_RUNTIME_VERSION } from './nativeRuntimeAssets';
import { hasNativeMethods } from './nativeClass';
import { listZipEntries, looksLikeZip, readZipEntries } from '../util/syncZip';

const MAVEN_MIRRORS = [
  'https://maven.aliyun.com/repository/public/',
  'https://mirrors.cloud.tencent.com/nexus/repository/maven-public/',
  'https://repo1.maven.org/maven2/',
] as const;

/** Narrow infrastructure port: the runtime provisioner does not depend on Electron or EngineHost. */
export interface NativeRuntimePorts {
  downloadArtifact(url: string): Promise<Buffer>;
  logInfo(message: string): void;
  logWarning(message: string): void;
}

export interface NativeSpiderRuntimeOptions {
  jvmDir: string;
  runtimeDir?: string;
  ports: NativeRuntimePorts;
}

/** Detects native spider jars and provisions the optional ARM emulation classpath on demand. */
export class NativeSpiderRuntime {
  private readonly nativeFlags = new Map<string, boolean>();
  private preparation: Promise<string[]> | null = null;
  private readyClasspath: string[] | null = null;

  constructor(private readonly options: NativeSpiderRuntimeOptions) {}

  get readyJars(): string[] | null {
    return this.readyClasspath ? [...this.readyClasspath] : null;
  }

  shouldEnable(jarPaths: string[]): boolean {
    if (!this.options.runtimeDir) return false;
    if (!existsSync(join(this.options.jvmDir, 'native-bridge', 'native-bridge.jar'))) return false;
    return jarPaths.some((jarPath) => this.containsNativeCode(jarPath));
  }

  containsNativeCode(jarPath: string): boolean {
    return this.jarRequiresNativeBridge(jarPath);
  }

  jvmProperties(nativeJars: string[]): string[] {
    const runtimeDir = this.options.runtimeDir;
    if (nativeJars.length === 0 || !runtimeDir) return [];
    return [
      `-Dtvbox.native.work=${join(runtimeDir, 'work')}`,
      `-Dtvbox.native.patch=${join(runtimeDir, 'patched')}`,
    ];
  }

  prewarm(): void {
    if (!this.options.runtimeDir) return;
    void this.ensure().catch(() => []);
  }

  async ensure(): Promise<string[]> {
    if (!this.options.runtimeDir) return [];
    if (this.readyClasspath) return this.readyClasspath;

    // Concurrent callers share one provision attempt. A later call retries after a failure.
    if (this.preparation) return this.preparation;

    const preparation = this.prepare();
    const sharedPreparation = preparation
      .then((jars) => {
        if (jars.length > 0) this.readyClasspath = jars;
        return jars;
      })
      .catch((error: unknown) => {
        this.options.ports.logWarning(
          `native: 原生运行时不可用（该源按无原生桥降级）: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      })
      .finally(() => {
        this.preparation = null;
      });
    this.preparation = sharedPreparation;
    return sharedPreparation;
  }

  private jarRequiresNativeBridge(jarPath: string): boolean {
    const cached = this.nativeFlags.get(jarPath);
    if (cached !== undefined) return cached;

    let required = false;
    try {
      const bytes = readFileSync(jarPath);
      if (looksLikeZip(bytes)) {
        required = listZipEntries(bytes).some((entry) => entry.endsWith('.so'));
        if (!required) {
          required = readZipEntries(bytes).some(
            (entry) => entry.name.endsWith('.class') && hasNativeMethods(entry.bytes),
          );
        }
      }
    } catch {
      required = false;
    }

    this.nativeFlags.set(jarPath, required);
    return required;
  }

  private async prepare(): Promise<string[]> {
    const runtimeDir = this.options.runtimeDir;
    if (!runtimeDir) return [];

    const versionDir = join(runtimeDir, NATIVE_RUNTIME_VERSION);
    const bridgeJar = join(this.options.jvmDir, 'native-bridge', 'native-bridge.jar');
    if (!existsSync(bridgeJar)) throw new Error(`缺少原生桥实现 jar: ${bridgeJar}`);
    mkdirSync(versionDir, { recursive: true });

    const missing = NATIVE_RUNTIME_ARTIFACTS.filter(
      (artifact) => !this.isUsableArtifact(join(versionDir, artifact.file)),
    );
    if (missing.length > 0) {
      this.options.ports.logInfo(
        `native: 正在准备 ARM 原生运行时（unidbg ${NATIVE_RUNTIME_VERSION}，${missing.length} 个包约 39MB；仅含 .so 的源需要）…`,
      );
    }

    for (const artifact of missing) {
      let lastError = '';
      for (const mirror of MAVEN_MIRRORS) {
        try {
          const bytes = await this.options.ports.downloadArtifact(mirror + artifact.path);
          if (bytes.length < 4096) {
            lastError = `下载内容过小(${bytes.length}B)`;
            continue;
          }
          writeFileSync(join(versionDir, artifact.file), bytes);
          lastError = '';
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (lastError) throw new Error(`原生运行时下载失败（${artifact.file}）：${lastError}`);
    }

    this.options.ports.logInfo(`native: ARM 原生运行时已就绪 ${versionDir}`);
    return [bridgeJar, ...NATIVE_RUNTIME_ARTIFACTS.map((artifact) => join(versionDir, artifact.file))];
  }

  private isUsableArtifact(filePath: string): boolean {
    try {
      return existsSync(filePath) && statSync(filePath).size > 4096;
    } catch {
      return false;
    }
  }
}
