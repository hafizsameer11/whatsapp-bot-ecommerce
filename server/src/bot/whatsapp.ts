import crypto from 'node:crypto';
import { Inbound, LIMITS, Outbound } from './types.js';

const cut = (s: string | undefined, n: number) => {
  const v = (s ?? '').trim();
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
};

export function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base + (url.startsWith('/') ? url : '/' + url);
}

/** Clamp a message to WhatsApp limits so Meta never rejects it for length/count. */
export function normalize(msg: Outbound): Outbound {
  switch (msg.type) {
    case 'text':
      return { type: 'text', text: cut(msg.text, LIMITS.text) || ' ' };
    case 'image':
      return { type: 'image', url: msg.url, caption: msg.caption ? cut(msg.caption, LIMITS.caption) : undefined };
    case 'buttons':
      return {
        ...msg,
        body: cut(msg.body, LIMITS.body) || ' ',
        footer: msg.footer ? cut(msg.footer, LIMITS.footer) : undefined,
        headerText: msg.headerText ? cut(msg.headerText, LIMITS.header) : undefined,
        buttons: msg.buttons.slice(0, LIMITS.buttons).map((b) => ({ id: b.id.slice(0, LIMITS.id), title: cut(b.title, LIMITS.buttonTitle) })),
      };
    case 'list': {
      let remaining = LIMITS.listRowsTotal;
      const sections = msg.sections
        .map((s) => {
          const rows = s.rows.slice(0, remaining).map((r) => ({
            id: r.id.slice(0, LIMITS.id),
            title: cut(r.title, LIMITS.listRowTitle),
            description: r.description ? cut(r.description, LIMITS.listRowDescription) : undefined,
          }));
          remaining -= rows.length;
          return { title: cut(s.title, LIMITS.listSectionTitle), rows };
        })
        .filter((s) => s.rows.length > 0);
      return {
        ...msg,
        body: cut(msg.body, LIMITS.body) || ' ',
        buttonText: cut(msg.buttonText, LIMITS.listButtonText),
        headerText: msg.headerText ? cut(msg.headerText, LIMITS.header) : undefined,
        footer: msg.footer ? cut(msg.footer, LIMITS.footer) : undefined,
        sections,
      };
    }
  }
}

export function toGraphPayload(to: string, m: Outbound): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (m.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: m.text, preview_url: false } };
    case 'image':
      return { ...base, type: 'image', image: { link: absoluteUrl(m.url), caption: m.caption } };
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(m.headerImage
            ? { header: { type: 'image', image: { link: absoluteUrl(m.headerImage) } } }
            : m.headerText
              ? { header: { type: 'text', text: m.headerText } }
              : {}),
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: { buttons: m.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      };
    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(m.headerText ? { header: { type: 'text', text: m.headerText } } : {}),
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: { button: m.buttonText, sections: m.sections },
        },
      };
  }
}

export function isConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Sends via Graph API. Returns the wamid. Throws with Meta's error message on failure. */
export async function sendToWhatsApp(to: string, m: Outbound): Promise<string> {
  if (!isConfigured()) throw new Error('WhatsApp credentials missing (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
  const version = process.env.GRAPH_API_VERSION || 'v23.0';
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(toGraphPayload(to, m)),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (res.ok) return json?.messages?.[0]?.id ?? '';
      const errMsg = json?.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`;
      // Retry only on rate limit / server errors. 4xx (bad payload, recipient not allowed) won't fix itself.
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(errMsg), { fatal: true });
      lastErr = new Error(errMsg);
    } catch (e: any) {
      if (e?.fatal) throw e;
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  throw lastErr;
}

/** Verify X-Hub-Signature-256 using the raw request body. */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // allowed in local dev only; a warning is printed at startup
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export type StatusUpdate = { waMessageId: string; status: string; error?: string };

/** Flatten Meta's entry[].changes[].value structure into inbound messages and delivery statuses. */
export function parseWebhook(body: any): { inbound: Inbound[]; statuses: StatusUpdate[] } {
  const inbound: Inbound[] = [];
  const statuses: StatusUpdate[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const names: Record<string, string> = {};
      for (const c of value.contacts ?? []) names[c.wa_id] = c.profile?.name;
      for (const m of value.messages ?? []) {
        const base = { waId: m.from, name: names[m.from], waMessageId: m.id };
        if (m.type === 'text') inbound.push({ ...base, kind: 'text', text: m.text?.body ?? '' });
        else if (m.type === 'interactive') {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
          if (r) inbound.push({ ...base, kind: 'reply', replyId: r.id, replyTitle: r.title });
          else inbound.push({ ...base, kind: 'other' });
        } else if (m.type === 'button') {
          // quick-reply button on an approved template
          inbound.push({ ...base, kind: 'reply', replyId: m.button?.payload, replyTitle: m.button?.text });
        } else if (m.type === 'image') inbound.push({ ...base, kind: 'image', text: m.image?.caption, mediaId: m.image?.id });
        else inbound.push({ ...base, kind: 'other', text: m.type });
      }
      for (const s of value.statuses ?? []) {
        statuses.push({
          waMessageId: s.id,
          status: s.status,
          error: s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title ?? s.errors[0].message}` : undefined,
        });
      }
    }
  }
  return { inbound, statuses };
}

/** Download media a customer sent (2 steps: get a short-lived URL, then fetch it with the token). */
export async function downloadMedia(mediaId: string): Promise<Buffer> {
  if (!isConfigured()) throw new Error('WhatsApp not configured');
  const version = process.env.GRAPH_API_VERSION || 'v23.0';
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const meta = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(15000) });
  const json = (await meta.json().catch(() => ({}))) as any;
  if (!meta.ok || !json.url) throw new Error(`Media lookup failed: ${json?.error?.message ?? meta.status}`);
  const file = await fetch(json.url, { headers: auth, signal: AbortSignal.timeout(30000) });
  if (!file.ok) throw new Error(`Media download failed: ${file.status}`);
  return Buffer.from(await file.arrayBuffer());
}
