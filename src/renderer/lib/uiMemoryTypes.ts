import type { HomeSearchMem } from '../features/home/application/HomeSearchMemory';

export type { HomeSearchMem } from '../features/home/application/HomeSearchMemory';

export interface HomeMem {
  profileId?: string;
  key: string;
  tid: string;
  pg: number;
  scrollTop: number;
  /** 当前分类已选中的筛选（gkey → value），与 tid/pg 同存（进详情返回时恢复筛选状态） */
  filters?: Record<string, string>;
  /** 上次搜索态；搜索 → 详情 → 返回时由 HomePage 恢复（exitSearch 清除） */
  search?: HomeSearchMem | null;
  /**
   * ★ 2026-09-28 修复「搜索返回栈错乱」：本份 home 状态的**最后有意变更时间**（ms）。
   *
   * 根因：`loadUiMemory()` 会用盘上的 home **整份覆盖**内存（挂载 / 窗口 focus / visibility 都会触发），
   * 而盘上那份可能是**上一次搜索**（第二次搜索的 2s 防抖还没落盘，或播放器窗口把自己的旧快照写了回去）
   * ⇒「搜 A → 详情 → 搜 B → 详情 → 返回」会退回 A 的结果。
   * 现在两个窗口写盘/载入都走 `pickNewerHome()`：**updatedAt 更大的那份胜出**（相等时按调用方偏好）。
   * 只有会改变「搜索/浏览态」的动作会 bump 它（saveSearchMem / exitSearch / 进浏览态）。
   */
  updatedAt?: number;
}
export interface DetailMem {
  flag: string;
  ep: number;
  scrollTop: number;
}
/** 单条观看历史（自动保存）：一部资源（url 去重）+ 刮削元数据 + 最后播放进度 + 观看时间 */
export interface WatchHistory {
  /** 资源展示名（如"狂飙 第12集"）；无名称时回退为 url */
  name: string;
  /**
   * ★ 历史条目的主键/回退地址。原则上保存**原始 episode url**（可重新走 client.play 转存/解析），
   *   不要存已过期的直链 —— 否则夸克这类"转存直链临时有效、播放完即删"的资源从历史续播必然失败。
   */
  url: string;
  /** ★ 原始 episode url（与 url 同值；显式字段便于历史页点开时重新转存/解析） */
  rawUrl?: string;
  /** ★ 播放源 flag（client.play 需要 key+flag 才能重新解析/转存） */
  flag?: string;
  /** 封面图（详情/搜索结果携带的 pic；缺失时卡片占位） */
  pic?: string;
  /** 集数/备注角标（如"第12集"、"HD"） */
  remarks?: string;
  /** 来源源名（展示在卡片左上 chip，与搜索结果一致） */
  sourceName?: string;
  /** 来源源 key（点击可回详情） */
  sourceKey?: string;
  /** ★ 所属订阅档案 ID；历史跨订阅播放时先恢复该档案 */
  profileId?: string;
  /** 详情 vod_id（回详情用） */
  vodId?: string;
  /** 最后播放位置（秒） */
  time: number;
  /** 最近观看时间戳（ms），用于历史排序 */
  updatedAt: number;
}
export interface UiMemory {
  home: HomeMem;
  /** 详情记忆：键 = "key:id" */
  detail: Map<string, DetailMem>;
  /** 播放进度（秒）：键 = 播放 url */
  playTime: Map<string, number>;
  /** 最近一次播放来源（返回目标与回退用） */
  playSource: { fromKey: string; id: string; name: string } | null;
  /** 观看历史：键 = 播放 url（去重，一资源一记录） */
  history: Map<string, WatchHistory>;
  /**
   * ★ 2026-09-28 修复「历史删一次删不掉（播放中尤甚）」：**删除标记**（url → 带符号时间戳 ms）。
   *
   * 根因：`saveUiMemory()` 会把 localStorage 里已有的 history 合并回内存（修「历史为空」时的多窗口
   * 覆盖问题），而被删条目在内存里已不存在（`!cur`）→ 于是**从 localStorage 原样补回**，
   * 删除在下一次写盘时原地复活；播放器窗口每 5s 写一次盘，所以「播放中」尤其明显。
   *
   * 带符号语义（撤销必须能压过删除，否则盘上墓碑会把撤销又抹掉）：
   *   `+ts` = ts 时刻执行了**删除**；`-ts` = ts 时刻执行了**撤销**。合并时取 |ts| 更大的那次动作。
   * 生效规则：某条记录仅当「其 url 的当前动作是删除，且删除时间晚于该条 updatedAt」时才被抑制。
   * 标记随同 `tvboxUiMemory` 一起落盘，两个窗口共享。
   */
  deleted: Map<string, number>;
}

export interface RecordWatchInput {
  name?: string;
  url: string;
  rawUrl?: string;
  flag?: string;
  pic?: string;
  remarks?: string;
  sourceName?: string;
  sourceKey?: string;
  profileId?: string;
  vodId?: string;
  time?: number;
}
