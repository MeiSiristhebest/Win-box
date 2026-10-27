import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { copyFile, readFile, readdir, realpath, stat, mkdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { assertPackagedReleaseAssets } from './verify-release-assets.mjs';

const BUILTINS = new Set(builtinModules.flatMap((name) => {
  const bareName = name.replace(/^node:/, '');
  return [bareName, `node:${bareName}`];
}));

const normalizeRelativePath = (value) => String(value).replaceAll('\\', '/').replace(/^\/+/, '');

export function matchesPathPattern(candidate, pattern) {
  const path = normalizeRelativePath(candidate);
  const source = String(pattern).replaceAll('\\', '/');
  let expression = '^';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '/' && source.slice(index + 1) === '**') {
      expression += '(?:/.*)?';
      index = source.length;
    } else if (char === '*' && source[index + 1] === '*') {
      index += 1;
      if (source[index + 1] === '/') {
        index += 1;
        expression += '(?:.*/)?';
      } else {
        expression += '.*';
      }
    } else if (char === '*') {
      expression += '[^/]*';
    } else if ('\\^$+?.()|{}[]'.includes(char)) {
      expression += `\\${char}`;
    } else {
      expression += char;
    }
  }
  expression += '$';
  return new RegExp(expression).test(path);
}

function packageNameFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  return segments[0];
}

async function listCjsArtifacts(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return found;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listCjsArtifacts(path));
    else if (entry.isFile() && entry.name.endsWith('.cjs') && !entry.name.endsWith('.cjs.map')) found.push(path);
  }
  return found;
}

async function listRendererArtifacts(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return found;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listRendererArtifacts(path));
    else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.js.map')) found.push(path);
  }
  return found;
}

export async function collectStaticExternalPackages(root) {
  const artifacts = await listCjsArtifacts(join(root, 'dist'));
  if (!artifacts.length) throw new Error('No built CJS runtime artifacts were found under dist/. Run the application build first.');
  const found = new Set();
  const requireExpression = /\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const artifact of artifacts) {
    const source = await readFile(artifact, 'utf8');
    for (const match of source.matchAll(requireExpression)) {
      const specifier = match[2];
      if (specifier === 'electron' || BUILTINS.has(specifier)) continue;
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName) found.add(packageName);
    }
  }
  return [...found].sort();
}

export async function collectRendererExternalPackages(root) {
  const artifacts = await listRendererArtifacts(join(root, 'dist', 'renderer', 'assets'));
  if (!artifacts.length) throw new Error('No built renderer JavaScript artifacts were found under dist/renderer/assets. Run the renderer build first.');
  const found = new Set();
  const expressions = [
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\b(?:import|export)\s+[^'";]{0,1000}?\sfrom\s*(['"])([^'"]+)\1/g,
  ];
  for (const artifact of artifacts) {
    const source = await readFile(artifact, 'utf8');
    for (const expression of expressions) {
      for (const match of source.matchAll(expression)) {
        const specifier = match[2];
        if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#') && !specifier.startsWith('node:') && !/^(?:https?:|data:|blob:)/i.test(specifier)) {
          const packageName = packageNameFromSpecifier(specifier);
          if (packageName) found.add(packageName);
        }
      }
    }
  }
  return [...found].sort();
}

export function bundledPackageNames(closure) {
  return [...new Set([
    ...(closure.bundledPackages ?? []).map(({ name }) => name),
    ...(closure.rendererBundledPackages ?? []).map(({ name }) => name),
  ])].sort();
}

function assertSetEquals(actual, expected, description) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet].filter((value) => !actualSet.has(value));
  const unexpected = [...actualSet].filter((value) => !expectedSet.has(value));
  if (missing.length || unexpected.length) {
    throw new Error(`${description} mismatch; missing: ${missing.join(', ') || '(none)'}; unexpected: ${unexpected.join(', ') || '(none)'}`);
  }
}

export async function loadAndValidateRuntimeClosure(root, packageManifest) {
  const closure = JSON.parse(await readFile(join(root, 'scripts', 'package-app-runtime-closure.json'), 'utf8'));
  if (closure.schemaVersion !== 1) throw new Error(`Unsupported package runtime closure schema: ${closure.schemaVersion}`);

  const declaredStatic = closure.runtimePackages?.staticExternals ?? [];
  const dynamic = closure.runtimePackages?.dynamicAllowlist ?? [];
  const dynamicNames = dynamic.map(({ name }) => name);
  const bundledNames = bundledPackageNames(closure);
  const unusedNames = (closure.unusedDependencies ?? []).map(({ name }) => name);
  assertSetEquals(declaredStatic, [...new Set(declaredStatic)], 'Static external manifest');
  assertSetEquals(dynamicNames, [...new Set(dynamicNames)], 'Dynamic runtime allowlist');
  assertSetEquals(bundledNames, [...new Set(bundledNames)], 'Bundled package list');

  const actualStatic = await collectStaticExternalPackages(root);
  assertSetEquals(actualStatic, declaredStatic, 'Built CJS external package closure');
  const declaredRendererExternals = closure.rendererExternalPackages ?? [];
  const actualRendererExternals = await collectRendererExternalPackages(root);
  assertSetEquals(actualRendererExternals, declaredRendererExternals, 'Built renderer external package closure');
  assertSetEquals(Object.keys(packageManifest.dependencies ?? {}), [...declaredStatic, ...dynamicNames], 'Production dependency manifest');

  const production = new Set(Object.keys(packageManifest.dependencies ?? {}));
  const development = new Set(Object.keys(packageManifest.devDependencies ?? {}));
  for (const name of bundledNames) {
    if (production.has(name)) throw new Error(`Bundled package ${name} must not remain in dependencies.`);
  }
  for (const { name } of closure.bundledPackages ?? []) {
    if (!development.has(name)) throw new Error(`Main-process bundled package ${name} must be available as a devDependency for builds.`);
  }
  for (const { name } of closure.rendererBundledPackages ?? []) {
    try {
      const resolvedPackage = await realpath(packageFilesRoot(root, name));
      if (!isInside(root, resolvedPackage)) throw new Error(`Renderer bundle package resolves outside the workspace: ${name}`);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new Error(`Renderer bundled package ${name} is not installed for the renderer build.`);
      }
      throw error;
    }
  }
  for (const name of unusedNames) {
    if (production.has(name) || development.has(name)) throw new Error(`Unused package ${name} must be removed from package.json.`);
  }

  for (const name of [...declaredStatic, ...dynamicNames]) await assertInstalledPackage(root, name);

  const runtimeNames = new Set([...declaredStatic, ...dynamicNames]);
  for (const entry of closure.dynamicRequireAllowlist ?? []) {
    const artifact = normalizeRelativePath(entry.artifact);
    if (artifact !== entry.artifact || !artifact.startsWith('dist/') || artifact.split('/').includes('..')) {
      throw new Error(`Dynamic require allowlist artifact must stay inside dist/: ${entry.artifact}`);
    }
    if (!entry.expression || !Array.isArray(entry.allowedPackageNames)) {
      throw new Error(`Dynamic require allowlist entry is incomplete for ${entry.artifact}.`);
    }
    const artifactSource = await readFile(join(root, ...artifact.split('/')), 'utf8');
    if (!artifactSource.includes(entry.expression)) {
      throw new Error(`Dynamic require allowlist expression was not found in ${artifact}: ${entry.expression}`);
    }
    for (const name of entry.allowedPackageNames) {
      if (!runtimeNames.has(name)) throw new Error(`Dynamic require allowlist package ${name} is not a declared runtime package.`);
    }
  }

  for (const assetRoot of closure.runtimeAssetRoots ?? []) {
    await stat(join(root, assetRoot));
  }
  for (const { name, requiredAssets = [] } of dynamic) {
    if (!production.has(name)) throw new Error(`Dynamic runtime package ${name} must be in dependencies.`);
    for (const asset of requiredAssets) {
      const normalizedAsset = normalizeRelativePath(asset);
      if (normalizedAsset !== asset || normalizedAsset.split('/').includes('..') || !normalizedAsset.startsWith(`node_modules/${name}/`)) {
        throw new Error(`Dynamic runtime asset must be contained by its package (${name}): ${asset}`);
      }
      const assetInfo = await stat(join(root, normalizedAsset));
      if (!assetInfo.isFile() || assetInfo.size === 0) {
        throw new Error('Dynamic runtime asset must be a non-empty file: ' + normalizedAsset);
      }
    }
  }

  return { closure, actualStatic, actualRendererExternals, bundledNames, dynamicNames };
}

function isInside(parent, path) {
  const rel = relative(parent, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(`../`) && !rel.startsWith(`..\\`) && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel);
}

function packageFilesRoot(root, name) {
  return join(root, 'node_modules', ...name.split('/'));
}

async function assertInstalledPackage(root, name) {
  const packageRoot = packageFilesRoot(root, name);
  const resolvedRoot = await realpath(packageRoot);
  if (!isInside(root, resolvedRoot)) throw new Error(`Runtime package resolves outside the workspace: ${name}`);
  const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (packageManifest.name !== name) throw new Error(`Installed package manifest mismatch for ${name}.`);
}

async function findLicenseFiles(packageRoot, pattern, packageName, packageVersion, appRoot) {
  const licensePattern = new RegExp(pattern, 'i');
  const files = [];
  const packageRealRoot = await realpath(packageRoot);
  if (!isInside(appRoot, packageRealRoot)) throw new Error(`Bundled package resolves outside the workspace: ${packageName}`);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') await visit(path);
      else if (entry.isFile() && licensePattern.test(entry.name)) {
        const realFile = await realpath(path);
        if (!isInside(packageRealRoot, realFile)) throw new Error(`License file resolves outside its package: ${path}`);
        const bytes = await readFile(path);
        const relativeFile = relative(packageRoot, path).split(sep).join('/');
        files.push({ packageName, packageVersion, sourcePath: path, relativeFile, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }

  await visit(packageRoot);
  return files;
}

async function resolvePackageRoot(appRoot, requiringRoot, packageName) {
  if (BUILTINS.has(packageName)) return null;
  let directory = requiringRoot;
  for (;;) {
    if (!isInside(appRoot, directory)) break;
    const candidate = join(directory, 'node_modules', ...packageName.split('/'));
    try {
      const manifest = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'));
      if (manifest.name === packageName) {
        const resolvedDirectory = await realpath(candidate);
        if (!isInside(appRoot, resolvedDirectory)) throw new Error(`Bundled dependency resolves outside the workspace: ${packageName}`);
        return { directory: resolvedDirectory, manifest };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

async function collectBundledPackageRoots(appRoot, closure) {
  const pending = bundledPackageNames(closure).map(name => ({ name, requiringRoot: appRoot, required: true }));
  const found = new Map();
  while (pending.length) {
    const { name, requiringRoot, required } = pending.pop();
    if (BUILTINS.has(name)) continue;
    const resolved = await resolvePackageRoot(appRoot, requiringRoot, name);
    if (!resolved) {
      if (required) throw new Error(`Unable to resolve bundled dependency ${name} from ${requiringRoot}.`);
      continue;
    }
    const key = `${resolved.manifest.name}@${resolved.manifest.version ?? 'unknown'}:${resolved.directory}`;
    if (found.has(key)) continue;
    found.set(key, resolved);

    const dependencies = Object.keys(resolved.manifest.dependencies ?? {});
    const optional = Object.keys(resolved.manifest.optionalDependencies ?? {});
    const peers = Object.keys(resolved.manifest.peerDependencies ?? {});
    for (const dependency of dependencies) {
      if (!BUILTINS.has(dependency)) pending.push({ name: dependency, requiringRoot: resolved.directory, required: true });
    }
    for (const dependency of [...optional, ...peers]) {
      if (!BUILTINS.has(dependency)) pending.push({ name: dependency, requiringRoot: resolved.directory, required: false });
    }
  }
  return [...found.values()];
}

export async function collectBundledPackageLicenses(root, closure) {
  const pattern = closure.licenseRetention?.resourceFilenamePattern;
  if (!pattern) throw new Error('Runtime closure manifest has no license filename pattern.');
  const records = [];

  for (const { directory, manifest } of await collectBundledPackageRoots(root, closure)) {
    const name = manifest.name;
    const version = manifest.version ?? 'unknown';
    let files = await findLicenseFiles(directory, pattern, name, version, root);
    if (!files.length) {
      const supplemental = (closure.licenseRetention?.supplementalFiles ?? []).find(
        item => item.packageName === name && item.packageVersion === version,
      );
      if (supplemental) {
        const relativePath = normalizeRelativePath(supplemental.path);
        if (relativePath.split('/').includes('..') || relativePath.startsWith('/')) {
          throw new Error(`Supplemental license path must stay inside the workspace: ${supplemental.path}`);
        }
        const supplementalPath = join(root, ...relativePath.split('/'));
        files = await findLicenseFiles(dirname(supplementalPath), pattern, name, version, root);
        files = files.filter(file => file.sourcePath === supplementalPath);
      }
    }
    if (!files.length) throw new Error(`No license-related files found for bundled dependency ${name}@${version}.`);
    records.push(...files);
  }
  const unique = new Map();
  for (const record of records) {
    const key = `${record.packageName}@${record.packageVersion}:${record.relativeFile}:${record.sha256}`;
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()];
}

export async function copyBundledPackageLicenses(root, stagingDirectory, closure) {
  const files = await collectBundledPackageLicenses(root, closure);
  const destinationRoot = join(stagingDirectory, 'resources', 'app.asar.unpacked', 'resources', 'licenses', 'third-party');
  const records = [];
  for (const file of files) {
    const destinationPath = join(destinationRoot, ...file.packageName.split('/'), file.packageVersion, ...file.relativeFile.split('/'));
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(file.sourcePath, destinationPath);
    records.push({
      packageName: file.packageName,
      packageVersion: file.packageVersion,
      relativeFile: file.relativeFile,
      destinationPath,
      sha256: file.sha256,
    });
  }
  return records;
}

function packageNamesInPath(path) {
  const segments = normalizeRelativePath(path).split('/');
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

export async function assertPackagedRuntimeClosure({ archivePath, stagingDirectory, closure, extractFile, listPackage, licenseRecords, runtimeAssetManifest }) {
  const archiveEntries = new Set(listPackage(archivePath, { isPack: false }).map(normalizeRelativePath));
  for (const path of archiveEntries) {
    if (path === 'node_modules/.modules.yaml' || path === 'node_modules/.pnpm' || path.startsWith('node_modules/.pnpm/')) {
      throw new Error('Packaged ASAR must not contain pnpm install metadata: ' + path);
    }
  }
  const archiveApiPath = (relativePath) => join(...relativePath.split('/'));
  const runtimeNames = [
    ...(closure.runtimePackages?.staticExternals ?? []),
    ...(closure.runtimePackages?.dynamicAllowlist ?? []).map(({ name }) => name),
  ];
  for (const name of runtimeNames) {
    const manifestPath = `node_modules/${name}/package.json`;
    if (!archiveEntries.has(manifestPath)) throw new Error(`Packaged ASAR is missing runtime dependency ${name}.`);
    const packedManifest = JSON.parse(extractFile(archivePath, archiveApiPath(manifestPath)).toString('utf8'));
    if (packedManifest.name !== name) throw new Error(`Packaged dependency manifest mismatch for ${name}.`);
  }

  for (const { name, requiredAssets = [] } of closure.runtimePackages?.dynamicAllowlist ?? []) {
    for (const asset of requiredAssets) {
      if (!archiveEntries.has(asset)) throw new Error(`Packaged ASAR is missing dynamic runtime asset ${asset} for ${name}.`);
      const contents = extractFile(archivePath, archiveApiPath(asset));
      if (!contents?.length) throw new Error('Packaged dynamic runtime asset is empty: ' + asset);
    }
  }

  const bundled = new Set(bundledPackageNames(closure));
  for (const path of archiveEntries) {
    const unexpected = packageNamesInPath(path).find((name) => bundled.has(name));
    if (unexpected) throw new Error(`Bundled package code must not be present in ASAR: ${path}`);
  }

  for (const record of licenseRecords) {
    const bytes = await readFile(record.destinationPath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== record.sha256) throw new Error(`Packaged license copy failed verification: ${record.packageName}/${record.relativeFile}`);
    const relativeToStage = relative(stagingDirectory, record.destinationPath).split(sep).join('/');
    if (!relativeToStage.startsWith('resources/app.asar.unpacked/resources/licenses/third-party/')) {
      throw new Error(`License copy was written outside the unpacked app resources: ${record.destinationPath}`);
    }
  }

  await assertPackagedReleaseAssets(stagingDirectory, { manifest: runtimeAssetManifest });
}
