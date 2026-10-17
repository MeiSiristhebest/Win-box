import { useEffect, useState, type KeyboardEvent } from 'react';
import { client } from '../../api/client';
import type { BossKeySettings } from '../../../shared/types';

const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+B';

function displayAccelerator(accelerator: string) {
  return accelerator.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ');
}

function acceleratorFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const { key } = event;
  const isLetterDigit = /^[A-Za-z0-9]$/.test(key);
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key);
  const isNavigationKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(key);
  if (!isLetterDigit && !isFunctionKey && !isNavigationKey) return null;
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'Dead'].includes(key)) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (modifiers.length === 0) return null;
  return [...modifiers, isLetterDigit ? key.toUpperCase() : key].join('+');
}

export function ShortcutSettingsSection({ active }: { active: boolean }) {
  const [bossKey, setBossKey] = useState<BossKeySettings | null>(null);
  const [acceleratorDraft, setAcceleratorDraft] = useState('');
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    client.bossGet().then(setBossKey).catch(() => setBossKey({ enabled: false, accel: DEFAULT_ACCELERATOR }));
  }, []);

  async function save() {
    if (!bossKey) return;
    const accelerator = (acceleratorDraft || bossKey.accel).trim();
    try {
      const result = await client.bossSet({ enabled: bossKey.enabled, accel: accelerator });
      setBossKey(result.settings);
      setAcceleratorDraft('');
      if (result.settings.enabled && !result.registered) {
        setMessage({ text: '快捷键注册失败：可能已被其它程序占用，请换一个组合', kind: 'err' });
      } else {
        setMessage({ text: result.settings.enabled ? `已启用：${displayAccelerator(result.settings.accel)}` : '已停用老板键', kind: 'ok' });
      }
    } catch (error) {
      setMessage({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    }
  }

  if (!active) return null;

  return (
    <div className="card" id="cfg-shortcut" style={{ padding: 12, marginBottom: 16 }}>
      {bossKey ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={bossKey.enabled}
                onChange={(event) => setBossKey((current) => current ? { ...current, enabled: event.target.checked } : current)}
              />
              <span style={{ fontWeight: 600 }}>启用老板键</span>
            </label>
            <span className="muted" style={{ fontSize: 11 }}>
              当前：{bossKey.enabled ? displayAccelerator(bossKey.accel || DEFAULT_ACCELERATOR) : '未启用'}
            </span>
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 11, flex: 'none' }}>快捷键：</span>
            <input
              aria-label="全局快捷键"
              style={{ width: 220, fontFamily: 'monospace' }}
              value={acceleratorDraft || displayAccelerator(bossKey.accel || DEFAULT_ACCELERATOR)}
              placeholder="按 Ctrl + Shift + B 等组合"
              readOnly
              onKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const accelerator = acceleratorFromEvent(event);
                if (accelerator) {
                  setAcceleratorDraft(accelerator);
                  setMessage(null);
                }
              }}
            />
            <span className="muted" style={{ fontSize: 11 }}>点击输入框后按下快捷键组合</span>
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
            按下快捷键后，视频暂停并静音，软件最小化并隐藏任务栏图标。再次按下可恢复播放状态和窗口模式。快捷键在软件未获焦点时也能使用。
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <button className="primary" onClick={() => void save()}>保存老板键</button>
            {bossKey.enabled && acceleratorDraft && (
              <button onClick={() => setAcceleratorDraft('')}>取消修改</button>
            )}
            {message && (
              <span className={message.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }} aria-live="polite">
                {message.text}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
      )}
    </div>
  );
}
