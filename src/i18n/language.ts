export type AppLanguage = 'en' | 'ru';

type DeviceLocale = {
  languageCode?: string | null;
  languageTag?: string | null;
};

/** Only the primary language matters; region and secondary languages do not. */
export function resolveAppLanguage(locales: readonly DeviceLocale[]): AppLanguage {
  const primary = locales[0];
  const language = (primary?.languageCode?.trim() || primary?.languageTag?.trim() || '')
    .toLowerCase()
    .split(/[-_]/)[0];
  return language === 'ru' ? 'ru' : 'en';
}
