import { createContext, ReactNode, useContext, useEffect, useMemo, useReducer } from 'react';
import { AppState, Platform } from 'react-native';
import { getLocales, useLocales } from 'expo-localization';
import { AppLanguage, resolveAppLanguage } from './language';
import { createTranslator, Translator } from './translations';

const LocalizationContext = createContext<{ language: AppLanguage; t: Translator } | null>(null);

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const locales = useLocales();
  const [resumeRevision, refresh] = useReducer((revision: number) => revision + 1, 0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Android can change its language while the app is in the background.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, []);

  const language = useMemo(
    () => resolveAppLanguage(getLocales()),
    [locales, resumeRevision],
  );
  const value = useMemo(() => ({ language, t: createTranslator(language) }), [language]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useI18n() {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error('useI18n must be used inside LocalizationProvider');
  return value;
}
