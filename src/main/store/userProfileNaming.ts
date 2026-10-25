import type { UserProfile } from '../../shared/types';

export function profileIdSlug(value: string, fallbackId = 'profile'): string {
  const normalized = (value || '').trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallbackId;
}

/** Detect profile names that may still be refreshed from subscription metadata. */
export function isAutoProfileName(profile: UserProfile): boolean {
  const name = (profile.name || '').trim();
  if (!name) return true;
  if (/^(旧订阅|新订阅)\s/.test(name)) return true;
  if (name === '默认' || name === 'default' || name === '未命名配置') return true;
  const tail = (profile.apiUrl || '').split('/').pop()?.split('?')[0] ?? '';
  return !!tail && name === tail;
}

/** Local timestamp used in automatically generated subscription profile names. */
export function subscriptionStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
