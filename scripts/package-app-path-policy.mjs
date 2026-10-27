import { isAbsolute, join, relative, sep } from 'node:path';
import { readdir, realpath } from 'node:fs/promises';

const RENDERER_BUNDLED_PACKAGES = new Set([
  'hls.js',
  'mpegts.js',
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
]);

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

function isRendererBundlePackage(rel) {
  if (!rel.startsWith('node_modules/')) return false;
  const segments = rel.slice('node_modules/'.length).split('/');
  const name = segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1] ?? ''}` : segments[0];
  return RENDERER_BUNDLED_PACKAGES.has(name);
}

/** True when a path is not part of the packaged app's runtime closure. */
export function shouldIgnorePackagedAppPath(candidate, root, { danglingNodeModulePaths = new Set() } = {}) {
  const rel = relativeAppPath(candidate, root);
  if (rel === null) return true;
  if (rel === '.' || rel === '') return false;
  if (rel === 'package.json' || rel === 'LICENSE' || rel === 'LICENSE.txt') return false;

  if (danglingNodeModulePaths.has(rel)) return true;

  if (/^dist\/.+\.map$/i.test(rel)) return true;

  if (rel === 'node_modules/.bin' || rel.startsWith('node_modules/.bin/')) return true;
  if (/^node_modules\/(?:\.vite|\.vitest|\.vitest-cache)(?:\/|$)/.test(rel)) return true;
  if (/^node_modules\/\.ignored\/@fluentui\/react-icons_tmp_[^/]+(?:\/|$)/.test(rel)) return true;
  if (isRendererBundlePackage(rel)) return true;

  if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
  if (!/^(dist|resources)(\/|$)/.test(rel)) return true;
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
