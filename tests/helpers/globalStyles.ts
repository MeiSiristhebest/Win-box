import { readFile } from 'node:fs/promises';

export const GLOBAL_STYLESHEET = new URL('../../src/renderer/styles/global.css', import.meta.url);

export async function readGlobalStyleComposition(): Promise<{ imports: string[]; css: string }> {
  const entry = await readFile(GLOBAL_STYLESHEET, 'utf8');
  const imports: string[] = [];
  const expanded: string[] = [];

  for (const line of entry.split(/\r?\n/)) {
    const match = line.match(/^@import\s+['"]\.\/([^'"]+)['"];$/);
    if (!match) {
      expanded.push(line);
      continue;
    }

    const fileName = match[1];
    imports.push(fileName);
    expanded.push(await readFile(new URL(fileName, GLOBAL_STYLESHEET), 'utf8'));
  }

  return { imports, css: expanded.join('\n') };
}
