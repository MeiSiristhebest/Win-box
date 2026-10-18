export const SOURCES_CHANGED_EVENT = 'winbox:sources-changed';
export const PROFILE_CHANGED_EVENT = 'winbox:profile-changed';

export function notifyProfileChanged(sourceKey = ''): void {
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT, { detail: sourceKey }));
  window.dispatchEvent(new Event(SOURCES_CHANGED_EVENT));
}
