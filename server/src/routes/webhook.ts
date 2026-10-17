import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { handleInbound } from '../bot/engine.js';
import { parseWebhook, verifySignature } from '../bot/whatsapp.js';

export const webhookRouter = Router();

// Meta verification handshake (GET) when you save the webhook URL in the dashboard.
webhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(String(challenge));
  return res.sendStatus(403);
});

// Events (POST). Verify signature on raw bytes, ACK fast, process asynchronously.
webhookRouter.post('/', async (req: any, res) => {
  if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
    console.warn('[webhook] invalid signature, rejected');
    return res.sendStatus(401);
  }
  res.sendStatus(200);

  const { inbound, statuses } = parseWebhook(req.body);
  for (const st of statuses) {
    await prisma.message
      .updateMany({ where: { waMessageId: st.waMessageId }, data: { status: st.status, ...(st.error ? { error: st.error } : {}) } })
      .catch(() => undefined);
  }
  for (const ev of inbound) void handleInbound(ev);
});
