import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { webhookRouter } from './routes/webhook.js';
import { authRouter, requireAuth, allow } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { simulatorRouter } from './routes/simulator.js';

const app = express();
app.set('trust proxy', 'loopback'); // trust only the local Nginx for client IPs
app.use(cors());
// Keep the raw body: the WhatsApp signature must be computed over the exact bytes Meta sent.
app.use(express.json({ limit: '2mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/webhook', webhookRouter);
app.use('/uploads', express.static(path.resolve('uploads'), { maxAge: '7d' }));
app.use('/api/auth', authRouter);
app.use('/api/simulator', requireAuth, allow('STAFF', 'AGENT'), simulatorRouter);
app.use('/api', requireAuth, adminRouter);

// Serve the built admin panel (npm run build) from the same server in production.
const adminDist = path.resolve('../admin/dist');
if (fs.existsSync(adminDist)) {
  app.use(express.static(adminDist));
  app.get(/^\/(?!api|webhook|uploads).*/, (_req, res) => res.sendFile(path.join(adminDist, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status ?? (err?.code === 'P2002' ? 409 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err?.code === 'P2002' ? 'Duplicate value (e.g. SKU already used)' : err?.message ?? 'Server error' });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0'; // on a server behind Nginx use HOST=127.0.0.1
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('change-me'))) {
  console.error('❌ Set a real JWT_SECRET in server/.env before running in production.');
  process.exit(1);
}
app.listen(port, host, () => {
  console.log(`\n🚀 Server on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}   (webhook: /webhook, admin API: /api)`);
  if (!process.env.WHATSAPP_APP_SECRET) console.warn('⚠️  WHATSAPP_APP_SECRET not set: webhook signatures are NOT verified (ok for local testing only).');
  if (!process.env.WHATSAPP_TOKEN) console.warn('⚠️  WHATSAPP_TOKEN not set: only the admin Simulator will work.');
  if (!process.env.OPENAI_API_KEY) console.warn('⚠️  OPENAI_API_KEY not set: AI replies disabled, keyword search + menus only.');
  if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET not set: using an insecure default.');
});
