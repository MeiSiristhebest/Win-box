import PosterSizeControl from '../../components/PosterSizeControl';
import { UI_SCALE_OPTIONS } from '../../../shared/uiScale';
import type {
  AppearanceSectionViewActions,
  AppearanceSectionViewModel,
} from './presentation/appearanceSectionViewModel';
import styles from './AppearanceSection.module.css';

interface AppearanceSectionViewProps {
  model: AppearanceSectionViewModel;
  actions: AppearanceSectionViewActions;
}

const MOTION_OPTIONS = [
  ['auto', '跟随系统'],
  ['on', '始终开启'],
  ['off', '关闭动效'],
] as const;

export function AppearanceSectionView({ model, actions }: AppearanceSectionViewProps) {
  return (
    <>
      <section className={`card ${styles.card} appearance-theme-card`} id="cfg-appearance">
        <h2 className={styles.heading}>外观主题</h2>
        <div className={styles.options} role="radiogroup" aria-label="外观主题">
          {model.skins.map(({ id, label }) => (
            <label key={id} className={`appearance-theme-option ${styles.radioOption} ${model.theme === id ? 'active' : ''}`}>
              <input
                className={styles.radioInput}
                type="radio"
                name="appearance-theme"
                value={id}
                checked={model.theme === id}
                onChange={() => actions.changeTheme(id)}
              />
              <span className="theme-preview" data-mode={id} aria-hidden="true"><span className="theme-preview-nav" /><span className="theme-preview-cards"><span /><span /><span /></span></span>
              <span>{label}{model.theme === id ? <small>已选</small> : null}</span>
            </label>
          ))}
        </div>
      </section>

      <section className={`card ${styles.card} appearance-setting-card`} id="cfg-motion">
        <h2 className={styles.heading}>界面动效</h2>
        <div className={styles.options} role="radiogroup" aria-label="界面动效">
          {MOTION_OPTIONS.map(([value, label]) => (
            <label key={value} className={`tag ${styles.radioOption} ${model.motion === value ? 'active' : ''}`}>
              <input
                className={styles.radioInput}
                type="radio"
                name="motion-preference"
                value={value}
                checked={model.motion === value}
                onChange={() => actions.changeMotion(value)}
              />
              <span>{label}{model.motion === value ? ' ✓' : ''}</span>
            </label>
          ))}
        </div>
      </section>

      <section className={`card ${styles.card} appearance-discover-card`} id="cfg-show-discover">
        <label className={styles.discoverToggle}>
          <input
            type="checkbox"
            checked={model.showDiscover}
            onChange={(event) => actions.changeDiscoverVisibility(event.currentTarget.checked)}
          />
          <span>展示「发现」页</span>
        </label>
        <div className={`muted ${styles.help}`}>
          关闭后导航里不再出现「发现」，打开软件直接进「点播」（源主页）。默认开启。
        </div>
      </section>

      <section className={`card ${styles.card} appearance-setting-card`} id="cfg-ui-scale">
        <h2 className={styles.heading}>文字与控件缩放</h2>
        <div className={styles.options} role="radiogroup" aria-label="界面缩放">
          {UI_SCALE_OPTIONS.map((option) => (
            <label key={String(option.value)} className={`tag ${styles.radioOption} ${model.uiScale.pref === option.value ? 'active' : ''}`}>
              <input
                className={styles.radioInput}
                type="radio"
                name="ui-scale"
                value={String(option.value)}
                checked={model.uiScale.pref === option.value}
                onChange={() => actions.changeUiScale(option.value)}
              />
              <span>{option.value === 'auto' ? `跟随屏幕（当前 ${Math.round(model.uiScale.scale * 100)}%）` : option.label}</span>
            </label>
          ))}
        </div>
      </section>
      {model.scaleError && <p role="alert">{model.scaleError}</p>}
      <section className={`card ${styles.card} appearance-setting-card`} id="cfg-poster-size">
        <div><h2 className={styles.heading}>列表海报大小</h2><p className={`muted ${styles.help}`}>独立于文字缩放，所有影片列表共用。</p></div>
        <PosterSizeControl size={model.posterSize} onChange={actions.changePosterSize} />
      </section>
      <section className={`card ${styles.card} appearance-setting-card`} id="cfg-nav-mode">
        <h2 className={styles.heading}>详情与搜索的打开方式</h2>
        <div className={styles.options} role="radiogroup" aria-label="页面打开方式">
          {(['inline', 'window'] as const).map((value) => (
            <label key={value} className={`tag ${styles.radioOption} ${model.navMode === value ? 'active' : ''}`}>
              <input className={styles.radioInput} type="radio" name="nav-mode" value={value} checked={model.navMode === value} onChange={() => actions.changeNavMode(value)} />
              <span>{value === 'inline' ? '本页内' : '独立窗口'}</span>
            </label>
          ))}
        </div>
      </section>
      <section className={`card ${styles.card} appearance-setting-card`} id="cfg-home-browse">
        <h2 className={styles.heading}>点播页浏览方式</h2>
        <div className={styles.options} role="radiogroup" aria-label="点播页浏览方式">
          {[false, true].map((value) => (
            <label key={String(value)} className={`tag ${styles.radioOption} ${model.waterfall === value ? 'active' : ''}`}>
              <input className={styles.radioInput} type="radio" name="home-browse" value={String(value)} checked={model.waterfall === value} onChange={() => actions.changeWaterfall(value)} />
              <span>{value ? '瀑布模式' : '逐页翻页'}</span>
            </label>
          ))}
        </div>
      </section>
    </>
  );
}
