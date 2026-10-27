import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBundledPackageLicenses, loadAndValidateRuntimeClosure } from './package-app-runtime-closure.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { closure, actualStatic, actualRendererExternals, dynamicNames } = await loadAndValidateRuntimeClosure(root, packageManifest);
const licenseFiles = await collectBundledPackageLicenses(root, closure);

console.log(JSON.stringify({
  staticExternals: actualStatic,
  dynamicRuntimePackages: dynamicNames,
  mainBundledPackages: closure.bundledPackages.map(({ name }) => name).sort(),
  rendererBundledPackages: closure.rendererBundledPackages.map(({ name }) => name).sort(),
  rendererExternalPackages: actualRendererExternals,
  requiredDynamicAssets: closure.runtimePackages.dynamicAllowlist.flatMap(({ requiredAssets = [] }) => requiredAssets),
  retainedLicenseFiles: licenseFiles.map(({ packageName, packageVersion, relativeFile, sha256 }) => ({ packageName, packageVersion, relativeFile, sha256 })),
}, null, 2));
