import { prisma } from '../lib/db.js';
import { Outbound } from './types.js';
import { normalize, sendToWhatsApp } from './whatsapp.js';

export const isSimulator = (waId: string) => waId.startsWith('sim:');

export function optionIds(m: Outbound): string[] {
  if (m.type === 'buttons') return m.buttons.map((b) => b.id);
  if (m.type === 'list') return m.sections.flatMap((s) => s.rows.map((r) => r.id));
  return [];
}

export function summarize(m: Outbound): string {
  switch (m.type) {
    case 'text':
      return m.text;
    case 'image':
      return `[image] ${m.caption ?? ''}`.trim();
    case 'buttons':
      return `${m.body}\n${m.buttons.map((b) => `[${b.title}]`).join(' ')}`;
    case 'list':
      return `${m.body}\n[${m.buttonText}: ${m.sections.flatMap((s) => s.rows.map((r) => r.title)).join(', ')}]`;
  }
}

/**
 * Persist and deliver one outbound message. Simulator conversations are stored only.
 * Interactive messages also record their option IDs (OutboundMenu) for stale-tap protection.
 */
export async function deliver(
  conv: { id: number; turn: number },
  waId: string,
  raw: Outbound,
  sender: 'bot' | 'ai' | 'agent' = 'bot',
) {
  const m = normalize(raw);
  const ids = optionIds(m);
  if (ids.length) {
    await prisma.outboundMenu.create({
      data: { conversationId: conv.id, turn: conv.turn, optionIds: JSON.stringify(ids), payloadJson: JSON.stringify(m) },
    });
  }
  const row = await prisma.message.create({
    data: {
      conversationId: conv.id, direction: 'OUT', sender, type: m.type === 'text' || m.type === 'image' ? m.type : 'interactive',
      body: summarize(m), payloadJson: JSON.stringify(m), status: 'queued',
    },
  });
  if (isSimulator(waId)) {
    await prisma.message.update({ where: { id: row.id }, data: { status: 'delivered' } });
    return;
  }
  try {
    const wamid = await sendToWhatsApp(waId, m);
    await prisma.message.update({ where: { id: row.id }, data: { status: 'sent', waMessageId: wamid || null } });
  } catch (e: any) {
    console.error(`[whatsapp] send failed to ${waId}:`, e?.message);
    await prisma.message.update({ where: { id: row.id }, data: { status: 'failed', error: String(e?.message ?? e) } });
  }
}

/** WhatsApp only allows free-form replies within 24h of the customer's last message. */
export function inServiceWindow(lastInboundAt: Date | null | undefined) {
  return !!lastInboundAt && Date.now() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000;
}
