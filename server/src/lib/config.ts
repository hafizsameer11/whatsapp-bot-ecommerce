import { prisma } from './db.js';
import { DEFAULT_SETTINGS, DEFAULT_TEXTS } from './defaults.js';

// Small in-memory cache, invalidated whenever admin saves settings/texts.
let settingsCache: Record<string, string> | null = null;
let textsCache: Record<string, string> | null = null;

export function invalidateConfig() {
  settingsCache = null;
  textsCache = null;
}

export async function getSettings(): Promise<Record<string, string>> {
  if (!settingsCache) {
    const rows = await prisma.setting.findMany();
    settingsCache = { ...DEFAULT_SETTINGS };
    for (const r of rows) settingsCache[r.key] = r.value;
  }
  return settingsCache;
}

export async function setting(key: string): Promise<string> {
  return (await getSettings())[key] ?? '';
}

export async function settingNum(key: string): Promise<number> {
  const n = Number(await setting(key));
  return Number.isFinite(n) ? n : 0;
}

export async function settingBool(key: string): Promise<boolean> {
  return (await setting(key)) === 'true';
}

export async function text(key: string, vars: Record<string, string | number> = {}): Promise<string> {
  if (!textsCache) {
    const rows = await prisma.botText.findMany();
    textsCache = Object.fromEntries(Object.entries(DEFAULT_TEXTS).map(([k, v]) => [k, v.text]));
    for (const r of rows) textsCache[r.key] = r.text;
  }
  let t = textsCache[key] ?? key;
  const all = { store: await setting('storeName'), ...vars };
  for (const [k, v] of Object.entries(all)) t = t.split(`{${k}}`).join(String(v));
  return t;
}

export async function money(n: number): Promise<string> {
  return `${await setting('currency')} ${n.toLocaleString('en-US')}`;
}
