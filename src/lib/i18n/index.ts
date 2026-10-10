import { DEFAULT_LOCALE, LOCALES, en, ur, type Locale, type MessageKey } from "./messages";

const catalogues: Record<Locale, Partial<Record<MessageKey, string>>> = { en, ur };

export function getT(locale: Locale = DEFAULT_LOCALE) {
  return (key: MessageKey): string => catalogues[locale][key] ?? en[key];
}

export const dirFor = (locale: Locale) => LOCALES[locale].dir;
export { DEFAULT_LOCALE, type Locale, type MessageKey };
