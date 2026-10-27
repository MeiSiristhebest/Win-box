import { LOCAL_PROXY_BASE } from '../../shared/constants';
import { spiderProxyPort } from './jarBridgePolicy';

/** Values needed to describe a JVM launch; collecting them has no I/O or process side effects. */
export interface JarJvmPrefixInput {
  runtimeClasspath: string;
  loaderClasspath: string;
  serve: boolean;
  sandboxDirectory: string;
  javaExecutable: string;
  dex2jarClasspath: string;
  dex2jarCacheDirectory: string;
  proxyJvmArgs?: readonly string[];
}

const MODULE_OPEN_ARGUMENTS = [
  '--add-opens=java.base/java.lang=ALL-UNNAMED',
  '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
  '--add-opens=java.base/java.lang.invoke=ALL-UNNAMED',
  '--add-opens=java.base/java.util=ALL-UNNAMED',
  '--add-opens=java.base/java.util.concurrent=ALL-UNNAMED',
  '--add-opens=java.base/java.io=ALL-UNNAMED',
  '--add-opens=java.base/java.net=ALL-UNNAMED',
  '--add-opens=java.base/java.nio=ALL-UNNAMED',
  '--add-opens=java.base/java.security=ALL-UNNAMED',
  '--add-opens=java.base/java.text=ALL-UNNAMED',
  '--add-opens=java.base/sun.net.www.protocol.jar=ALL-UNNAMED',
] as const;

/** Build JVM arguments in the established order, including the loader-specific proxy identity. */
export function buildJarJvmPrefix(input: JarJvmPrefixInput): string[] {
  const proxyPort = spiderProxyPort(input.loaderClasspath);
  return [
    '-noverify',
    input.serve ? '-Xmx384m' : '-Xmx256m',
    '-XX:+UseSerialGC',
    `-Dtvbox.spiderCacheDir=${input.sandboxDirectory}`,
    ...MODULE_OPEN_ARGUMENTS,
    '-Dfile.encoding=UTF-8',
    '-Dsun.stdout.encoding=UTF-8',
    '-Dsun.stderr.encoding=UTF-8',
    ...(input.proxyJvmArgs ?? []),
    `-Dtvbox.proxy.port=${proxyPort}`,
    `-Dtvbox.proxy.entry=${LOCAL_PROXY_BASE}/proxy/${proxyPort}`,
    `-Dtvbox.d2j.java=${input.javaExecutable}`,
    `-Dtvbox.d2j.cp=${input.dex2jarClasspath}`,
    `-Dtvbox.d2j.cache=${input.dex2jarCacheDirectory}`,
    '-cp', input.runtimeClasspath,
  ];
}

export interface JarServeArgvInput {
  jvmPrefix: readonly string[];
  loaderClasspath: string;
  shimClasses?: string;
  nativeArguments: readonly string[];
}

export function buildJarServeArgv(input: JarServeArgvInput): string[] {
  return [
    ...input.jvmPrefix,
    ...(input.shimClasses ? [`-Dtvbox.shellShimClasses=${input.shimClasses}`] : []),
    ...input.nativeArguments,
    'SpiderRunner', '--serve', input.loaderClasspath,
  ];
}

export interface JarCallArgvInput extends JarServeArgvInput {
  className: string;
  method: string;
  args: readonly string[];
}

export function buildJarCallArgv(input: JarCallArgvInput): string[] {
  return [
    ...input.jvmPrefix,
    ...(input.shimClasses ? [`-Dtvbox.shellShimClasses=${input.shimClasses}`] : []),
    ...input.nativeArguments,
    'SpiderRunner', input.loaderClasspath, input.className, input.method, ...input.args,
  ];
}

export type JarPoolFailureAction =
  | 'return-timeout'
  | 'return-capacity'
  | 'return-output-limit'
  | 'throw-cancelled'
  | 'fallback-one-shot';

/** Only transport failures may start a cold process; completed failures and cancellation are terminal. */
export function jarPoolFailureAction(reason: string | undefined): JarPoolFailureAction {
  switch (reason) {
    case 'timeout':
    case 'queue-timeout':
      return 'return-timeout';
    case 'capacity-exhausted':
      return 'return-capacity';
    case 'output-limit':
      return 'return-output-limit';
    case 'cancelled':
      return 'throw-cancelled';
    default:
      return 'fallback-one-shot';
  }
}
