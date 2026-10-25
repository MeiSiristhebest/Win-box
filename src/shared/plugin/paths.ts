/** 安全相对路径：非空、无盘符/前导分隔符，任一段不得是 .. */
export function isSafeRelPath(p: unknown): boolean {
  if (typeof p !== 'string') return false;
  const s = p.trim().replace(/\\/g, '/');
  if (!s) return false;
  if (/^[a-zA-Z]:/.test(s)) return false;
  if (s.startsWith('/')) return false;
  return !s.split('/').some((seg) => seg === '..');
}
