import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { assertReleaseAssets } from './verify-release-assets.mjs';
import { rebuildJvmStubs } from './build-jvm-stubs.mjs';

const root = resolve(dirname(import.meta.filename), '..');

async function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  const [code, signal] = await once(child, 'close');
  if (code !== 0) throw new Error(`Release step ${args.join(' ')} failed (${signal ?? `exit ${code ?? 'unknown'}`}).`);
}

// SpiderRunner is compiled into stubs.jar. Rebuild it from the checked-in Java
// source before validating/copying release assets so the packaged runner cannot
// silently lag behind the TypeScript-to-JVM argument contract.
await rebuildJvmStubs(root);
await assertReleaseAssets(root, { phase: 'pre-build' });
await run(['scripts/build-main.mjs']);
await run(['node_modules/vite/bin/vite.js', 'build']);
await run(['scripts/package-app.mjs', '--installer', ...process.argv.slice(2)]);
