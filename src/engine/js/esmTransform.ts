import { parse } from '@babel/parser';
import { transformFromAstSync, types, type PluginObject } from '@babel/core';
import commonjs from '@babel/plugin-transform-modules-commonjs';
import { UnsupportedSourceError } from '../util/errors';

export interface CompiledModule {
  code: string;
  dependencies: string[];
  importName: string;
  metaName: string;
}

function unusedName(source: string, base: string): string {
  let name = base;
  while (source.includes(name)) name += '_';
  return name;
}

/** Compile module syntax without rewriting strings, comments, or local require functions. */
export function compileModule(source: string, moduleName: string): CompiledModule {
  const importName = unusedName(source, '__winboxImport');
  const metaName = unusedName(source, '__winboxMeta');
  if (!/\b(?:import|export|require)\b/.test(source)) {
    return { code: source, dependencies: [], importName, metaName };
  }
  try {
    const ast = parse(source, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      createImportExpressions: true,
    });
    const dependencies = new Set<string>();
    const bridge: PluginObject = {
      name: 'winbox-module-bridge',
      visitor: {
        Program(path) {
          if (path.node.sourceType !== 'module') return;
          // Generated imports use the host require; a spider's own require keeps its own callers.
          for (const name of ['require', 'module', 'exports']) {
            if (path.scope.hasOwnBinding(name)) path.scope.rename(name);
          }
        },
        ImportDeclaration(path) {
          dependencies.add(path.node.source.value);
        },
        ExportNamedDeclaration(path) {
          if (path.node.source) dependencies.add(path.node.source.value);
        },
        ExportAllDeclaration(path) {
          dependencies.add(path.node.source.value);
        },
        CallExpression(path) {
          const { callee, arguments: args } = path.node;
          if (types.isIdentifier(callee, { name: 'require' }) && !path.scope.getBinding('require') && types.isStringLiteral(args[0])) {
            dependencies.add(args[0].value);
          }
        },
        ImportExpression(path) {
          path.replaceWith(types.callExpression(types.identifier(importName), [path.node.source]));
        },
        MetaProperty(path) {
          if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
            path.replaceWith(types.identifier(metaName));
          }
        },
      },
    };
    const result = transformFromAstSync(ast, source, {
      filename: 'spider.js',
      babelrc: false,
      configFile: false,
      cloneInputAst: false,
      comments: true,
      retainLines: true,
      plugins: [() => bridge, [commonjs, { importInterop: 'babel' }]],
    });
    if (!result?.code) throw new Error('Module compiler returned no code');
    return { code: result.code, dependencies: [...dependencies], importName, metaName };
  } catch (error) {
    throw new UnsupportedSourceError(
      'TRANSFORM_FAILED',
      '模块编译失败（' + moduleName + '）: ' + (error instanceof Error ? error.message : String(error)),
    );
  }
}
