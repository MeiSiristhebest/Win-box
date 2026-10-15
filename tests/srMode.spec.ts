// tests/srMode.spec.ts — 超分档位契约（纯函数）：
//   `srModeUsable` 收敛规则 + `normalizePlayerSettings` 对 srMode 的容错。
import { describe, it, expect } from 'vitest';
import { normalizePlayerSettings, srModeUsable, isSrMode, SR_MODE_LABEL } from '../src/shared/player';

describe('srModeUsable — 未就绪一律 off', () => {
  it('档位在可用集内 → 原样返回', () => {
    expect(srModeUsable('efficiency', ['efficiency', 'quality'])).toBe('efficiency');
    expect(srModeUsable('high', ['high'])).toBe('high');
  });

  it('未装插件（可用集空）→ off', () => {
    for (const m of ['efficiency', 'quality', 'general', 'high']) {
      expect(srModeUsable(m, [])).toBe('off');
    }
  });

  it('档位不在可用集 / 非法值 → off', () => {
    expect(srModeUsable('general', ['efficiency'])).toBe('off');
    expect(srModeUsable('nope', ['efficiency'])).toBe('off');
    expect(srModeUsable(null, ['efficiency'])).toBe('off');
    expect(srModeUsable(undefined, ['efficiency'])).toBe('off');
  });

  it('off 恒为 off', () => {
    expect(srModeUsable('off', ['efficiency'])).toBe('off');
  });

  it('isSrMode / 标签表覆盖全部档位', () => {
    expect(isSrMode('general')).toBe(true);
    expect(isSrMode('off')).toBe(true);
    expect(isSrMode('ultra')).toBe(false);
    expect(Object.keys(SR_MODE_LABEL).sort()).toEqual(['efficiency', 'general', 'high', 'off', 'quality']);
  });
});

describe('normalizePlayerSettings — srMode 容错', () => {
  it('缺字段（旧配置）→ off', () => {
    expect(normalizePlayerSettings({}).srMode).toBe('off');
    expect(normalizePlayerSettings(null).srMode).toBe('off');
  });

  it('白名单值保留；非法值回落 off', () => {
    expect(normalizePlayerSettings({ srMode: 'quality' }).srMode).toBe('quality');
    expect(normalizePlayerSettings({ srMode: 'ultra' as never }).srMode).toBe('off');
    expect(normalizePlayerSettings({ srMode: 3 as never }).srMode).toBe('off');
  });
});
