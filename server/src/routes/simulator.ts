import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../lib/db.js';
import { handleInbound } from '../bot/engine.js';

// Test the bot from the admin panel without WhatsApp (no Meta account / test recipients needed).
// Uses exactly the same engine; only delivery is skipped.
export const simulatorRouter = Router();

const waId = (sid: string) => `sim:${sid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'default'}`;

async function messages(sid: string, afterId = 0) {
  const c = await prisma.customer.findUnique({ where: { waId: waId(sid) }, include: { conversation: true } });
  if (!c?.conversation) return { state: null, messages: [] };
  const msgs = await prisma.message.findMany({ where: { conversationId: c.conversation.id, id: { gt: afterId } }, orderBy: { id: 'asc' } });
  return { state: c.conversation.state, botPaused: c.conversation.botPaused, messages: msgs };
}

simulatorRouter.get('/:sid', async (req, res) => res.json(await messages(req.params.sid, Number(req.query.after ?? 0))));

simulatorRouter.post('/:sid/send', async (req, res) => {
  const { text, replyId, replyTitle, name, imageUrl } = req.body ?? {};
  await handleInbound({
    waId: waId(req.params.sid), name: name || 'Test Customer', waMessageId: `sim.${crypto.randomUUID()}`,
    ...(replyId ? { kind: 'reply', replyId, replyTitle }
      : imageUrl ? { kind: 'image', imageUrl: String(imageUrl), text: text ? String(text) : undefined }
        : { kind: 'text', text: String(text ?? '') }),
  });
  res.json(await messages(req.params.sid));
});

simulatorRouter.post('/:sid/reset', async (req, res) => {
  await prisma.customer.deleteMany({ where: { waId: waId(req.params.sid), orders: { none: {} } } });
  const c = await prisma.customer.findUnique({ where: { waId: waId(req.params.sid) } });
  if (c) {
    // keep customer (has orders) but wipe chat + cart
    await prisma.conversation.deleteMany({ where: { customerId: c.id } });
    await prisma.cartItem.deleteMany({ where: { customerId: c.id } });
  }
  res.json({ ok: true });
});
