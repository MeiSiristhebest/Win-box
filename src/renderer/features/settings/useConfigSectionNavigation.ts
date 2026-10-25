import { useCallback, useEffect } from 'react';

export type ConfigSectionNavigationOptions = {
  requestedSection: string;
  requestedTab: string | undefined;
  activeTab: string;
};

/** Applies deep links to settings sections after conditional panels are mounted. */
export function useConfigSectionNavigation({
  requestedSection,
  requestedTab,
  activeTab,
}: ConfigSectionNavigationOptions): { focusSectionHeading(): void } {
  const focusSectionHeading = useCallback(() => {
    requestAnimationFrame(() => document.getElementById('cfg-section-title')?.focus());
  }, []);

  useEffect(() => {
    if (!requestedSection || requestedTab !== activeTab) return;

    const revealAndScroll = (): boolean => {
      const targetId = requestedSection === requestedTab ? 'cfg-section-title' : `cfg-${requestedSection}`;
      const element = document.getElementById(targetId);
      if (!element) return false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      element.scrollIntoView({ block: 'start' });
      return true;
    };

    if (revealAndScroll()) return;
    const panel = document.getElementById('config-panel');
    if (!panel) return;
    const observer = new MutationObserver(() => {
      if (revealAndScroll()) observer.disconnect();
    });
    observer.observe(panel, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [requestedSection, requestedTab, activeTab]);

  return { focusSectionHeading };
}
