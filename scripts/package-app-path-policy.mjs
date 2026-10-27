import { isAbsolute, join, relative, sep } from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { bundledPackageNames, matchesPathPattern } from './package-app-runtime-closure.mjs';

const isInside = (parent, path) => {
  const rel = relative(parent, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function relativeAppPath(candidate, root) {
  const value = String(candidate).replaceAll('\\', '/');
  const absolute = /^[A-Za-z]:\//.test(value) || value.startsWith('//');
  if (!absolute) return value.replace(/^\/+/, '');

  const appRoot = String(root).replaceAll('\\', '/').replace(/\/$/, '');
  if (!isInside(appRoot, value)) return null;
  return relative(appRoot, value).split(sep).join('/');
}

function packageNamesInPath(rel) {
  const segments = rel.split('/');
  const names = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== 'node_modules') continue;
    const first = segments[index + 1];
    if (!first || first === '.pnpm' || first === '.bin') continue;
    if (first.startsWith('@')) {
      const second = segments[index + 2];
      if (second) names.push(`${first}/${second}`);
    } else {
      names.push(first);
    }
  }
  return names;
}

/** True when a path is not part of the packaged app's runtime closure. */
export function shouldIgnorePackagedAppPath(candidate, root, { danglingNodeModulePaths = new Set(), runtimeClosure = null } = {}) {
  const rel = relativeAppPath(candidate, root);
  if (rel === null) return true;
  if (rel === '.' || rel === '') return false;
  if (rel === 'package.json' || rel === 'LICENSE' || rel === 'LICENSE.txt') return false;

  if (danglingNodeModulePaths.has(rel)) return true;

  if (/^dist\/.+\.map$/i.test(rel)) return true;

  if (rel === 'node_modules/.bin' || rel.startsWith('node_modules/.bin/')) return true;
  if (rel === 'node_modules/.modules.yaml' || rel === 'node_modules/.pnpm' || rel.startsWith('node_modules/.pnpm/')) return true;
  if (/^node_modules\/(?:\.vite|\.vitest|\.vitest-cache)(?:\/|$)/.test(rel)) return true;
  if (/^node_modules\/\.ignored\/@fluentui\/react-icons_tmp_[^/]+(?:\/|$)/.test(rel)) return true;
  const bundledNames = new Set(runtimeClosure ? bundledPackageNames(runtimeClosure) : []);
  if (packageNamesInPath(rel).some((name) => bundledNames.has(name))) return true;

  if ((runtimeClosure?.resourceExclusions ?? []).some((pattern) => matchesPathPattern(rel, pattern))) return true;

  if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
  if (!(runtimeClosure?.runtimeAssetRoots ?? ['dist', 'resources']).some((rootName) => rel === rootName || rel.startsWith(`${rootName}/`))) return true;
  if (!rel.startsWith('resources/')) return false;

  const parts = rel.split('/');
  const filename = parts.at(-1) ?? '';
  return parts.some((part) => ['.tmp', 'stubs-src', 'tools', '__pycache__'].includes(part)) ||
    filename === 'jython-standalone-2.7.3.jar' || /^(?:hs_err_pid|replay_pid).*\.log$/i.test(filename);
}

/** Finds only node_modules symlinks that cannot resolve in the source install. */
export async function collectDanglingNodeModulePaths(root) {
  const pending = [join(root, 'node_modules')];
  const dangling = new Set();
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT' && directory === join(root, 'node_modules')) return dangling;
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      throw error;
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          await realpath(path);
        } catch (error) {
          if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'ELOOP') {
            dangling.add(relative(root, path).split(sep).join('/'));
          } else {
            throw error;
          }
        }
      } else if (entry.isDirectory()) {
        pending.push(path);
      }
    }
  }
  return dangling;
}
