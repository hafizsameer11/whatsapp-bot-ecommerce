const TOKEN_KEY = 'wa_admin_token';

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } },
  set(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    auth.clear();
    window.location.href = '/login';
  }
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json as T;
}

/** Upload one or more photos; the server converts them to optimised JPEGs. */
export async function uploadImages(files: File[], folder: 'products' | 'chat' = 'products'): Promise<{ urls: string[]; errors: string[] }> {
  const fd = new FormData();
  files.forEach((f) => fd.append('file', f));
  const res = await fetch(`/api/upload?folder=${folder}`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Upload failed');
  return { urls: json.urls ?? [json.url], errors: json.errors ?? [] };
}

/** Send a file (multipart) to an API endpoint and return JSON (errors returned, not thrown, so previews can show them). */
export async function postFile(path: string, file: File): Promise<any> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fd });
  const json = await res.json().catch(() => ({ error: `Error ${res.status}` }));
  return { ...json, ok: res.ok };
}

/** Download a file from an authenticated endpoint. */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Download failed');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const fmt = (n: number) => `PKR ${Number(n || 0).toLocaleString('en-US')}`;
export const dt = (s: string) => new Date(s).toLocaleString();
