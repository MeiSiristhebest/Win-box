// src/renderer/components/CascadeBar.tsx
// 「级联分类条」—— 逐级点击才展开下一级（★ 2026-10-15，用户要求）。
//
// 交互契约：
//   · 每级一行（左小标签 + 右胶囊 chips）；**只有上一级已选定**，下级才由调用方放进 `levels` 渲染出来；
//   · `value === null` = 该级尚未选（不显示任何 chip 高亮）；`value === ''` = 已选「全部」；
//   · 点某个 chip → 回调 `onPick(该级 key, 选项 id)`；**是否允许再点取消由调用方决定**（组件只管派发）。
//
// 皮肤：豆风走已有 `.db-filters` 组（与顶栏胶囊导航同观感）；其余皮肤走基类 `.cascade*`（global.css）。
import { useTheme } from '../lib/theme';

export interface CascadeOption {
  id: string;
  label: string;
}

export interface CascadeLevel {
  key: string;
  /** 级别名（如 分类 / 地区 / 类型 / 年份 / 排序） */
  label: string;
  /** 已选值；null = 未选（该级无高亮，也不展开下级） */
  value: string | null;
  options: CascadeOption[];
  /** 「全部」选项文案：给定时在选项最前插入 `id=''` 的这一项；不给则无「全部」 */
  allLabel?: string;
  /** 选项为空时显示的占位文案（如类型清单仍在加载） */
  pendingLabel?: string;
}

export default function CascadeBar({
  levels,
  onPick,
  style,
}: {
  levels: CascadeLevel[];
  onPick: (levelKey: string, id: string) => void;
  style?: React.CSSProperties;
}) {
  const db = useTheme() === 'douban';
  return (
    <div className={db ? 'db-filters cascade' : 'cascade'} style={style}>
      {levels.map((lv) => {
        const opts: CascadeOption[] =
          lv.allLabel !== undefined ? [{ id: '', label: lv.allLabel }, ...lv.options] : lv.options;
        const chosen = lv.value !== null && lv.value !== undefined;
        return (
          <div key={lv.key} className={db ? 'db-filter-row' : 'cascade-row'}>
            <span className={db ? 'db-filter-label' : 'cascade-label'}>{lv.label}</span>
            {opts.length === 0 ? (
              <span className="muted" style={{ fontSize: 11 }}>{lv.pendingLabel || '加载中…'}</span>
            ) : (
              opts.map((o) => (
                <button
                  type="button"
                  key={`${lv.key}:${o.id === '' ? '_all' : o.id}`}
                  className={`tag${chosen && lv.value === o.id ? ' active' : ''}`}
                  aria-pressed={chosen && lv.value === o.id}
                  onClick={() => onPick(lv.key, o.id)}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
