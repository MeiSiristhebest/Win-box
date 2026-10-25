import { FluentProvider, createDarkTheme, createLightTheme, type BrandVariants } from '@fluentui/react-components';
import { useMemo, type ReactNode } from 'react';
import { useTheme } from '../lib/theme';
import { skinBase } from '../lib/themeTokens';

/** Fluent 2 brand ramp: shared by desktop navigation, controls and dialog primitives. */
const WINBOX_BRAND: BrandVariants = {
  10: '#06142f',
  20: '#0a2454',
  30: '#103878',
  40: '#174d9e',
  50: '#1e63c8',
  60: '#2878ed',
  70: '#4d8fff',
  80: '#75a7ff',
  90: '#9bbfff',
  100: '#b7d0ff',
  110: '#cddfff',
  120: '#dce9ff',
  130: '#e8f0ff',
  140: '#f1f6ff',
  150: '#f8faff',
  160: '#ffffff',
};

export function FluentDesignProvider({ children }: { children: ReactNode }) {
  const appTheme = useTheme();
  const theme = useMemo(
    () => {
      const base = skinBase(appTheme) === 'light' ? createLightTheme(WINBOX_BRAND) : createDarkTheme(WINBOX_BRAND);
      // Keep Fluent controls on the same semantic palette as the desktop UI. The old generated
      // light-blue brand background paired white text at only 2.41:1 contrast.
      return {
        ...base,
        colorBrandBackground: 'var(--color-accent, var(--accent, #245fbd))',
        colorBrandBackgroundHover: 'var(--accent-strong, var(--color-accent, var(--accent, #194b99)))',
        colorBrandBackgroundPressed: 'var(--accent-strong, var(--color-accent, var(--accent, #194b99)))',
        colorNeutralForegroundOnBrand: 'var(--on-accent, #ffffff)',
      };
    },
    [appTheme],
  );

  return (
    <FluentProvider theme={theme} className="winbox-fluent-provider">
      {children}
    </FluentProvider>
  );
}
