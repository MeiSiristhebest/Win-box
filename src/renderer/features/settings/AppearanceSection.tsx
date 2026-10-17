import { useEffect, useState } from 'react';
import { client } from '../../api/client';
import { UI_SCALE_OPTIONS, type UiScaleState } from '../../../shared/uiScale';
import { applyTheme, useTheme } from '../../lib/theme';
import { setShowDiscover, setMotionPref, useShowDiscover, useMotionPref, setNavMode, useNavMode, setWaterfall, useWaterfall, type MotionPref } from '../../lib/uiPrefs';
import { THEME_LABELS, type Theme } from '../../lib/themeTokens';
import styles from './AppearanceSection.module.css';

const MOTION_OPTIONS: Array<[MotionPref, string]> = [
  ['auto', '跟随系统'],
  ['on', '始终开启'],
  ['off', '关闭动效'],
];

export function AppearanceSection() {
  const theme = useTheme();
  const showDiscover = useShowDiscover();
  const motion = useMotionPref();
  const navMode = useNavMode();
  const waterfall = useWaterfall();
  const [uiScale, setUiScale] = useState<UiScaleState>({ pref: 'auto', scale: 1, work: { width: 0, height: 0 } });
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => client.uiGetScale()).then((value) => { if (active) setUiScale(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <>
      <section className={`card ${styles.card}`} id="cfg-appearance">
        <h2 className={styles.heading}>外观主题</h2>
        <div className={styles.options} role="radiogroup" aria-label="外观主题">
          {(Object.entries(THEME_LABELS) as [Theme, string][]).map(([id, label]) => (
            <label key={id} className={`tag ${styles.radioOption} ${theme === id ? 'active' : ''}`}>
              <input
                className={styles.radioInput}
                type="radio"
                name="appearance-theme"
                value={id}
                checked={theme === id}
                onChange={() => applyTheme(id)}
              />
              <span>{label}{theme === id ? ' ✓' : ''}</span>
            </label>
          ))}
        </div>
      </section>

      <section className={`card ${styles.card}`} id="cfg-motion">
        <h2 className={styles.heading}>界面动效</h2>
        <div className={styles.options} role="radiogroup" aria-label="界面动效">
          {MOTION_OPTIONS.map(([value, label]) => (
            <label key={value} className={`tag ${styles.radioOption} ${motion === value ? 'active' : ''}`}>
              <input
                className={styles.radioInput}
                type="radio"
                name="motion-preference"
                value={value}
                checked={motion === value}
                onChange={() => setMotionPref(value)}
              />
              <span>{label}{motion === value ? ' ✓' : ''}</span>
            </label>
          ))}
        </div>
      </section>

      <section className={`card ${styles.card}`} id="cfg-show-discover">
        <label className={styles.discoverToggle}>
          <input
            type="checkbox"
            checked={showDiscover}
            onChange={(event) => setShowDiscover(event.currentTarget.checked)}
          />
          <span>展示「发现」页</span>
        </label>
        <div className={`muted ${styles.help}`}>
          关闭后导航里不再出现「发现」，打开软件直接进「点播」（源主页）。默认开启。
        </div>
      </section>

      <section className={`card ${styles.card}`} id="cfg-ui-scale">
        <h2 className={styles.heading}>界面缩放</h2>
        <div className={styles.options} role="radiogroup" aria-label="界面缩放">
          {UI_SCALE_OPTIONS.map((option) => (
            <label key={String(option.value)} className={`tag ${styles.radioOption} ${uiScale.pref === option.value ? 'active' : ''}`}>
              <input className={styles.radioInput} type="radio" name="ui-scale" value={String(option.value)} checked={uiScale.pref === option.value} onChange={() => { void client.uiSetScale(option.value).then(setUiScale).catch(() => undefined); }} />
              <span>{option.value === 'auto' ? '跟随屏幕（当前 ' + Math.round(uiScale.scale * 100) + '%）' : option.label}</span>
            </label>
          ))}
        </div>
      </section>
      <section className={`card ${styles.card}`} id="cfg-nav-mode">
        <h2 className={styles.heading}>详情与搜索的打开方式</h2>
        <div className={styles.options} role="radiogroup" aria-label="页面打开方式">
          {(['inline', 'window'] as const).map((value) => (
            <label key={value} className={`tag ${styles.radioOption} ${navMode === value ? 'active' : ''}`}>
              <input className={styles.radioInput} type="radio" name="nav-mode" value={value} checked={navMode === value} onChange={() => setNavMode(value)} />
              <span>{value === 'inline' ? '本页内' : '独立窗口'}</span>
            </label>
          ))}
        </div>
      </section>
      <section className={`card ${styles.card}`} id="cfg-home-browse">
        <h2 className={styles.heading}>点播页浏览方式</h2>
        <div className={styles.options} role="radiogroup" aria-label="点播页浏览方式">
          {[false, true].map((value) => (
            <label key={String(value)} className={`tag ${styles.radioOption} ${waterfall === value ? 'active' : ''}`}>
              <input className={styles.radioInput} type="radio" name="home-browse" value={String(value)} checked={waterfall === value} onChange={() => setWaterfall(value)} />
              <span>{value ? '瀑布模式' : '逐页翻页'}</span>
            </label>
          ))}
        </div>
      </section>
    </>
  );
}
