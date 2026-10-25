const DISCLAIMER_AGREEMENT_KEY = 'winbox-disclaim-agreed';

export const disclaimerAgreementAdapter = {
  isAccepted(): boolean {
    try {
      return globalThis.localStorage.getItem(DISCLAIMER_AGREEMENT_KEY) === '1';
    } catch {
      return false;
    }
  },
  accept(): void {
    try {
      globalThis.localStorage.setItem(DISCLAIMER_AGREEMENT_KEY, '1');
    } catch {
      // Keep the agreement dialog usable when browser storage is disabled.
    }
  },
};
