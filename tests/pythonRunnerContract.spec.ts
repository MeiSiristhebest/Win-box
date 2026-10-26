import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const pythonCandidates = process.env.PYTHON
  ? [process.env.PYTHON]
  : process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];

const python = pythonCandidates.find((command) => {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return !result.error && result.status === 0;
});

describe.skipIf(!python)('Python runner capability contract', () => {
  it('distinguishes inherited stubs from empty overrides and propagates init errors', () => {
    const script = join(process.cwd(), 'architecture-audit', 'evidence', 'python-capabilities.probe.py');
    const result = spawnSync(python as string, [script], { encoding: 'utf8', windowsHide: true });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 6 tests');
  });
});
