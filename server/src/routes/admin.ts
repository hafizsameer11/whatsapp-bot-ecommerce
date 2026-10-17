import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { prisma } from '../lib/db.js';
import { allow, AuthUser } from './auth.js';
import { getSettings, invalidateConfig, money, settingNum } from '../lib/config.js';
import { DEFAULT_TEXTS } from '../lib/defaults.js';
import { cancelOrder, ORDER_STATUSES, STATUS_LABEL } from '../lib/commerce.js';
import { deliver, inServiceWindow } from '../bot/outbox.js';
import { isConfigured } from '../bot/whatsapp.js';
import { TOOL_DEFS } from '../ai/agent.js';
import { processAndStore, importFromUrl, storageMode } from '../lib/images.js';
import { saveProduct, validateProduct, deleteProduct } from '../lib/catalog.js';
import { adjust } from '../lib/inventory.js';
import { applyImport, exportRows, parseSheet, planImport, toCsv, toXlsx } from '../lib/importer.js';

export const adminRouter = Router();

type H = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: H) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const id = (req: Request) => Number(req.params.id);
const user = (req: Request) => (req as any).user as AuthUser;

const STAFF = allow('STAFF');
const AGENT = allow('STAFF', 'AGENT');

// ---------------- Status & dashboard ----------------
adminRouter.get('/status', wrap(async (_req, res) => {
  res.json({
    whatsappConfigured: isConfigured(),
    appSecretSet: Boolean(process.env.WHATSAPP_APP_SECRET),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    imageStorage: storageMode(),
    webhookPath: '/webhook',
  });
}));

adminRouter.get('/dashboard', wrap(async (_req, res) => {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const low = await settingNum('lowStockThreshold');
  const [ordersToday, pending, revenueAgg, lowStock, needsHuman, customers, recent, statusCounts] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { status: { not: 'CANCELLED' } } }),
    prisma.variant.findMany({ where: { active: true, archived: false, stock: { lte: low }, product: { status: 'ACTIVE' } }, include: { product: true }, take: 20, orderBy: { stock: 'asc' } }),
    prisma.conversation.count({ where: { needsHuman: true } }),
    prisma.customer.count({ where: { NOT: { waId: { startsWith: 'sim:' } } } }),
    prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.order.groupBy({ by: ['status'], _count: true }),
  ]);
  res.json({
    ordersToday, pending, revenue: revenueAgg._sum.total ?? 0, needsHuman, customers, recent,
    lowStock: lowStock.map((v) => ({ id: v.id, sku: v.sku, product: v.product.title, productId: v.productId, color: v.color, size: v.size, stock: v.stock })),
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count])),
  });
}));

// ---------------- Images ----------------
// Every image is converted to an optimised JPEG (HEIC/WEBP/PNG/large photos all accepted) and stored locally or in S3/R2.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });
adminRouter.post('/upload', AGENT, upload.array('file', 20), wrap(async (req, res) => {
  const folder = req.query.folder === 'chat' ? 'chat' : 'products';
  if (folder === 'products' && user(req).role === 'AGENT') return res.status(403).json({ error: 'Not allowed for your role' });
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) return res.status(400).json({ error: 'No file received' });
  const urls: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try { urls.push(await processAndStore(f.buffer, folder)); } catch (e: any) { errors.push(`${f.originalname}: ${e.message}`); }
  }
  if (!urls.length) return res.status(400).json({ error: errors.join('; ') });
  res.json({ url: urls[0], urls, errors });
}));
adminRouter.post('/images/import-url', STAFF, wrap(async (req, res) => {
  const url = String(req.body.url ?? '').trim();
  if (!url) return res.status(400).json({ error: 'URL required' });
  res.json({ url: await importFromUrl(url), sourceUrl: url });
}));

// ---------------- Categories ----------------
adminRouter.get('/categories', wrap(async (_req, res) => {
  res.json(await prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: true } } } }));
}));
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
adminRouter.post('/categories', STAFF, wrap(async (req, res) => {
  const { name, sortOrder = 0, active = true } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.json(await prisma.category.create({ data: { name, slug: `${slugify(name)}-${Date.now().toString(36)}`, sortOrder: Number(sortOrder), active } }));
}));
adminRouter.put('/categories/:id', STAFF, wrap(async (req, res) => {
  const { name, sortOrder, active } = req.body;
  res.json(await prisma.category.update({ where: { id: id(req) }, data: { name, sortOrder: Number(sortOrder ?? 0), active } }));
}));
adminRouter.delete('/categories/:id', STAFF, wrap(async (req, res) => {
  if (await prisma.product.count({ where: { categoryId: id(req) } })) return res.status(400).json({ error: 'Category has products. Move or delete them first.' });
  await prisma.category.delete({ where: { id: id(req) } });
  res.json({ ok: true });
}));

// ---------------- Products & variants ----------------
adminRouter.get('/products', wrap(async (req, res) => {
  const q = String(req.query.q ?? '');
  const products = await prisma.product.findMany({
    where: {
      status: { not: 'ARCHIVED' },
      ...(q ? { OR: [{ title: { contains: q } }, { code: { contains: q } }, { tags: { contains: q } }, { variants: { some: { sku: { contains: q } } } }] } : {}),
    },
    include: { category: true, images: { orderBy: { position: 'asc' }, take: 1 }, variants: { where: { archived: false } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(products.map((p) => ({
    ...p, totalStock: p.variants.reduce((s, v) => s + (v.active ? v.stock : 0), 0), variantCount: p.variants.length,
    minPrice: p.variants.length ? Math.min(...p.variants.map((v) => v.salePrice ?? v.price)) : 0,
  })));
}));
adminRouter.get('/products/:id', wrap(async (req, res) => {
  const p = await prisma.product.findUnique({
    where: { id: id(req) },
    include: { images: { orderBy: { position: 'asc' } }, variants: { where: { archived: false }, orderBy: { id: 'asc' } } },
  });
  p && p.status !== 'ARCHIVED' ? res.json(p) : res.status(404).json({ error: 'Not found' });
}));
adminRouter.post('/products', STAFF, wrap(async (req, res) => {
  const err = validateProduct(req.body);
  if (err) return res.status(400).json({ error: err });
  res.json(await saveProduct(null, req.body, user(req).name));
}));
adminRouter.put('/products/:id', STAFF, wrap(async (req, res) => {
  const err = validateProduct(req.body);
  if (err) return res.status(400).json({ error: err });
  res.json(await saveProduct(id(req), req.body, user(req).name));
}));
adminRouter.delete('/products/:id', STAFF, wrap(async (req, res) => res.json(await deleteProduct(id(req)))));

// ---------------- Bulk import / export (CSV or Excel, one row per SKU) ----------------
adminRouter.get('/products-export', STAFF, wrap(async (req, res) => {
  const template = req.query.template === '1';
  const rows = await exportRows(template);
  const name = template ? 'products-template' : `products-${new Date().toISOString().slice(0, 10)}`;
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(toCsv(rows));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  res.send(await toXlsx(rows));
}));
const sheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
adminRouter.post('/products-import', STAFF, sheetUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a .xlsx or .csv file' });
  const { rows, unknownHeaders } = await parseSheet(req.file.buffer, req.file.originalname);
  if (!rows.length) return res.status(400).json({ error: 'No data rows found' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Max 5000 rows per import. Split the file.' });
  const plan = await planImport(rows);
  if (unknownHeaders.length) plan.warnings.unshift(`Ignored unknown column(s): ${unknownHeaders.join(', ')}`);
  const preview = { summary: plan.summary, errors: plan.errors.slice(0, 200), errorCount: plan.errors.length, warnings: plan.warnings.slice(0, 100), rows: rows.length,
    products: plan.products.slice(0, 300).map((p) => ({ code: p.code, title: p.title, action: p.existingId ? 'update' : 'create', variants: p.variants.length, images: p.images.length })) };
  if (req.query.apply !== '1') return res.json({ ...preview, applied: false });
  if (plan.errors.length) return res.status(400).json({ ...preview, applied: false, error: 'Fix the errors and upload again' });
  const r = await applyImport(plan, { stockMode: req.query.stockMode === 'add' ? 'add' : 'set', by: user(req).name });
  res.json({ ...preview, warnings: r.warnings.slice(0, 100), applied: true, imagesDownloaded: r.imagesDownloaded });
}));

// ---------------- Inventory ----------------
adminRouter.get('/inventory', wrap(async (req, res) => {
  const q = String(req.query.q ?? '');
  const filter = String(req.query.filter ?? 'all');
  const low = await settingNum('lowStockThreshold');
  const variants = await prisma.variant.findMany({
    where: {
      archived: false,
      product: { status: { not: 'ARCHIVED' } },
      ...(filter === 'low' ? { stock: { lte: low }, active: true } : filter === 'out' ? { stock: 0, active: true } : {}),
      ...(q ? { OR: [{ sku: { contains: q } }, { color: { contains: q } }, { product: { title: { contains: q } } }, { product: { code: { contains: q } } }] } : {}),
    },
    include: { product: { include: { category: true } } },
    orderBy: [{ product: { title: 'asc' } }, { id: 'asc' }],
    take: 500,
  });
  const totals = await prisma.variant.aggregate({ _sum: { stock: true }, _count: true, where: { archived: false, active: true, product: { status: { not: 'ARCHIVED' } } } });
  res.json({ variants, lowThreshold: low, totalUnits: totals._sum.stock ?? 0, totalSkus: totals._count });
}));
adminRouter.post('/inventory/adjust', STAFF, wrap(async (req, res) => {
  const { variantId, mode, qty, note } = req.body ?? {};
  if (!['add', 'remove', 'set'].includes(mode)) return res.status(400).json({ error: 'mode must be add, remove or set' });
  const v = await adjust(Number(variantId), mode, Number(qty), String(note ?? ''), user(req).name);
  res.json(v);
}));
adminRouter.get('/inventory/movements', wrap(async (req, res) => {
  const variantId = req.query.variantId ? Number(req.query.variantId) : undefined;
  res.json(await prisma.inventoryMovement.findMany({
    where: variantId ? { variantId } : {},
    include: { variant: { include: { product: { select: { id: true, title: true } } } } },
    orderBy: { id: 'desc' },
    take: Math.min(500, Number(req.query.limit ?? 200)),
  }));
}));

// ---------------- Orders ----------------
adminRouter.get('/orders', wrap(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const q = req.query.q ? String(req.query.q) : undefined;
  res.json(await prisma.order.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ orderNo: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }, { city: { contains: q } }] } : {}),
    },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }));
}));
adminRouter.get('/orders/:id', wrap(async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: id(req) }, include: { items: true, customer: { include: { conversation: true } } } });
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.json({ ...o, inServiceWindow: inServiceWindow(o.customer.conversation?.lastInboundAt) });
}));
adminRouter.put('/orders/:id', STAFF, wrap(async (req, res) => {
  const { status, courier, trackingNo, notes, paymentStatus, notify } = req.body;
  if (status && !ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });
  const before = await prisma.order.findUnique({ where: { id: id(req) }, include: { customer: { include: { conversation: true } } } });
  if (!before) return res.status(404).json({ error: 'Not found' });
  if (before.status === 'CANCELLED' && status && status !== 'CANCELLED') return res.status(400).json({ error: 'Cancelled orders cannot be reopened (stock was returned).' });
  if (status === 'CANCELLED') await cancelOrder(before.id, user(req).name);
  const o = await prisma.order.update({
    where: { id: before.id },
    data: {
      ...(status && status !== 'CANCELLED' ? { status } : {}),
      ...(courier !== undefined ? { courier } : {}), ...(trackingNo !== undefined ? { trackingNo } : {}),
      ...(notes !== undefined ? { notes } : {}), ...(paymentStatus ? { paymentStatus } : {}),
    },
  });
  let notice = '';
  if (notify && before.customer.conversation) {
    const conv = before.customer.conversation;
    if (!inServiceWindow(conv.lastInboundAt) && !before.customer.waId.startsWith('sim:')) {
      notice = 'Customer not notified: outside the 24h WhatsApp window. An approved template message is required.';
    } else {
      const tracking = o.trackingNo ? `\n🚚 ${o.courier} tracking: ${o.trackingNo}` : '';
      await deliver(conv, before.customer.waId, {
        type: 'buttons', body: `📦 Update on order *${o.orderNo}*\nStatus: ${STATUS_LABEL[o.status]}${tracking}\nTotal: ${await money(o.total)}`,
        buttons: [{ id: 'track', title: 'My orders' }, { id: 'human', title: 'Need help' }],
      }, 'agent');
      notice = 'Customer notified on WhatsApp.';
    }
  }
  res.json({ order: o, notice });
}));

// ---------------- Inbox ----------------
adminRouter.get('/conversations', AGENT, wrap(async (req, res) => {
  const filter = String(req.query.filter ?? 'all');
  const convs = await prisma.conversation.findMany({
    where: filter === 'human' ? { needsHuman: true } : {},
    include: { customer: true, messages: { orderBy: { id: 'desc' }, take: 1 } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  res.json(convs.map((c) => ({
    id: c.id, state: c.state, botPaused: c.botPaused, needsHuman: c.needsHuman, assignedTo: c.assignedTo,
    customer: c.customer, lastMessage: c.messages[0] ?? null, updatedAt: c.updatedAt,
    inServiceWindow: inServiceWindow(c.lastInboundAt),
  })));
}));
adminRouter.get('/conversations/:id/messages', AGENT, wrap(async (req, res) => {
  const c = await prisma.conversation.findUnique({ where: { id: id(req) }, include: { customer: true } });
  if (!c) return res.status(404).json({ error: 'Not found' });
  const messages = await prisma.message.findMany({ where: { conversationId: c.id }, orderBy: { id: 'asc' }, take: 300 });
  const orders = await prisma.order.findMany({ where: { customerId: c.customerId }, orderBy: { createdAt: 'desc' }, take: 5 });
  res.json({ conversation: { ...c, inServiceWindow: inServiceWindow(c.lastInboundAt) }, messages, orders });
}));
adminRouter.post('/conversations/:id/reply', AGENT, wrap(async (req, res) => {
  const c = await prisma.conversation.findUnique({ where: { id: id(req) }, include: { customer: true } });
  const t = String(req.body.text ?? '').trim();
  if (!c || !t) return res.status(400).json({ error: 'Missing text' });
  if (!inServiceWindow(c.lastInboundAt) && !c.customer.waId.startsWith('sim:'))
    return res.status(400).json({ error: 'Outside the 24h service window. Only approved template messages can be sent.' });
  // Agent replying = agent owns the chat; pause the bot so it doesn't talk over the agent.
  await prisma.conversation.update({ where: { id: c.id }, data: { botPaused: true, assignedTo: user(req).name } });
  await deliver(c, c.customer.waId, { type: 'text', text: t }, 'agent');
  res.json({ ok: true });
}));
adminRouter.post('/conversations/:id/bot', AGENT, wrap(async (req, res) => {
  const paused = Boolean(req.body.paused);
  const c = await prisma.conversation.update({
    where: { id: id(req) },
    data: paused ? { botPaused: true, assignedTo: user(req).name } : { botPaused: false, needsHuman: false, assignedTo: null, state: 'WELCOME' },
  });
  res.json(c);
}));

// ---------------- Bot configuration ----------------
adminRouter.get('/bot/texts', wrap(async (_req, res) => {
  const rows = await prisma.botText.findMany();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  res.json(Object.entries(DEFAULT_TEXTS).map(([key, d]) => ({ key, text: byKey[key]?.text ?? d.text, description: d.description, default: d.text })));
}));
adminRouter.put('/bot/texts', STAFF, wrap(async (req, res) => {
  for (const { key, text } of req.body as { key: string; text: string }[]) {
    if (!(key in DEFAULT_TEXTS)) continue;
    await prisma.botText.upsert({ where: { key }, update: { text }, create: { key, text, description: DEFAULT_TEXTS[key].description } });
  }
  invalidateConfig();
  res.json({ ok: true });
}));

const ACTION_RE = /^(BROWSE|SEARCH|CART|TRACK|HUMAN|FAQ|MENU:\d+|TEXT:[\s\S]+)$/;
function checkItems(items: any[], limitLabel: number) {
  for (const i of items) {
    if (!i.label?.trim()) return 'Every item needs a label';
    if (i.label.length > limitLabel) return `Label "${i.label}" is longer than ${limitLabel} characters`;
    if (!ACTION_RE.test(i.action ?? '')) return `Invalid action "${i.action}"`;
    if ((i.description ?? '').length > 72) return `Description for "${i.label}" is longer than 72 characters`;
  }
  return null;
}

adminRouter.get('/bot/main-menu', wrap(async (_req, res) => res.json(await prisma.mainMenuItem.findMany({ orderBy: { sortOrder: 'asc' } }))));
adminRouter.put('/bot/main-menu', STAFF, wrap(async (req, res) => {
  const items: any[] = req.body ?? [];
  const active = items.filter((i) => i.active !== false);
  if (active.length > 10) return res.status(400).json({ error: 'WhatsApp lists allow max 10 rows' });
  const err = checkItems(items, active.length <= 3 ? 20 : 24);
  if (err) return res.status(400).json({ error: err });
  await prisma.$transaction([
    prisma.mainMenuItem.deleteMany(),
    prisma.mainMenuItem.createMany({
      data: items.map((i, n) => ({ label: i.label.trim(), description: i.description ?? '', action: i.action, sortOrder: n, active: i.active !== false })),
    }),
  ]);
  res.json({ ok: true });
}));

adminRouter.get('/bot/menus', wrap(async (_req, res) => res.json(await prisma.customMenu.findMany({ include: { items: { orderBy: { sortOrder: 'asc' } } } }))));
async function saveMenu(menuId: number | null, b: any) {
  const items: any[] = b.items ?? [];
  if (!b.title?.trim() || !b.body?.trim()) throw Object.assign(new Error('Title and message are required'), { status: 400 });
  if (items.length > 9) throw Object.assign(new Error('Max 9 items (1 row is reserved for "Main menu")'), { status: 400 });
  const err = checkItems(items, items.length <= 3 ? 20 : 24);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  return prisma.$transaction(async (tx) => {
    const data = { title: b.title.trim(), body: b.body, buttonText: (b.buttonText || 'View options').slice(0, 20), active: b.active !== false };
    const m = menuId ? await tx.customMenu.update({ where: { id: menuId }, data }) : await tx.customMenu.create({ data });
    await tx.customMenuItem.deleteMany({ where: { menuId: m.id } });
    await tx.customMenuItem.createMany({ data: items.map((i, n) => ({ menuId: m.id, label: i.label.trim(), description: i.description ?? '', action: i.action, sortOrder: n })) });
    return m;
  });
}
adminRouter.post('/bot/menus', STAFF, wrap(async (req, res) => res.json(await saveMenu(null, req.body))));
adminRouter.put('/bot/menus/:id', STAFF, wrap(async (req, res) => res.json(await saveMenu(id(req), req.body))));
adminRouter.delete('/bot/menus/:id', STAFF, wrap(async (req, res) => {
  await prisma.customMenu.delete({ where: { id: id(req) } });
  res.json({ ok: true });
}));

// Simple CRUD for auto-replies and knowledge base
function crud(name: string, model: any, fields: string[]) {
  const pick = (b: any) => Object.fromEntries(fields.filter((f) => b[f] !== undefined).map((f) => [f, b[f]]));
  adminRouter.get(`/${name}`, wrap(async (_req, res) => res.json(await model.findMany({ orderBy: { id: 'asc' } }))));
  adminRouter.post(`/${name}`, STAFF, wrap(async (req, res) => res.json(await model.create({ data: pick(req.body) }))));
  adminRouter.put(`/${name}/:id`, STAFF, wrap(async (req, res) => res.json(await model.update({ where: { id: id(req) }, data: pick(req.body) }))));
  adminRouter.delete(`/${name}/:id`, STAFF, wrap(async (req, res) => { await model.delete({ where: { id: id(req) } }); res.json({ ok: true }); }));
}
crud('auto-replies', prisma.autoReply, ['keywords', 'matchType', 'response', 'action', 'priority', 'active']);
crud('knowledge', prisma.knowledgeEntry, ['question', 'answer', 'tags', 'active']);

// ---------------- Settings & users (owner only) ----------------
adminRouter.get('/settings', wrap(async (_req, res) => {
  res.json({ settings: await getSettings(), tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, sideEffect: !!t.sideEffect })) });
}));
adminRouter.put('/settings', allow(), wrap(async (req, res) => {
  for (const [key, value] of Object.entries(req.body ?? {})) {
    await prisma.setting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } });
  }
  invalidateConfig();
  res.json({ ok: true });
}));

adminRouter.get('/users', allow(), wrap(async (_req, res) => {
  res.json(await prisma.adminUser.findMany({ select: { id: true, email: true, name: true, role: true, createdAt: true } }));
}));
adminRouter.post('/users', allow(), wrap(async (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !password || String(password).length < 8) return res.status(400).json({ error: 'Email and password (min 8 chars) required' });
  if (!['OWNER', 'STAFF', 'AGENT'].includes(role)) return res.status(400).json({ error: 'Bad role' });
  const u = await prisma.adminUser.create({ data: { email: String(email).toLowerCase().trim(), name: name || email, role, passwordHash: await bcrypt.hash(password, 10) } });
  res.json({ id: u.id });
}));
adminRouter.delete('/users/:id', allow(), wrap(async (req, res) => {
  if (id(req) === user(req).id) return res.status(400).json({ error: 'You cannot delete yourself' });
  await prisma.adminUser.delete({ where: { id: id(req) } });
  res.json({ ok: true });
}));
