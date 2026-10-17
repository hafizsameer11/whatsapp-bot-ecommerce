import { prisma } from '../lib/db.js';
import { money, setting, settingBool, settingNum, text } from '../lib/config.js';
import {
  addToCart, availableCategories, availableSizes, availableStitching, CommerceError, Filters, getCart, getProduct,
  placeOrder, priceRange, removeCartItem, clearCart, searchProducts, STATUS_LABEL, unitPrice, validateCart, variantLabel,
} from '../lib/commerce.js';
import { Button, Inbound, ListRow, Outbound } from './types.js';
import { deliver } from './outbox.js';
import { downloadMedia } from './whatsapp.js';
import { processAndStore } from '../lib/images.js';
import { aiRespond, aiAvailable } from '../ai/agent.js';

// ------------------------------------------------------------------------------------------------
// Conversation session: loaded once per inbound event, mutated by handlers, saved, then flushed.
// ------------------------------------------------------------------------------------------------

export type Ctx = {
  filters: Filters;
  page: number;
  productId?: number;
  variantId?: number;
  checkout?: { name?: string; city?: string; address?: string; phone?: string };
};

export type Session = {
  conv: { id: number; turn: number; state: string; botPaused: boolean };
  customer: { id: number; waId: string; name: string | null };
  ctx: Ctx;
  state: string;
  out: { msg: Outbound; sender: 'bot' | 'ai' }[];
};

const say = (s: Session, msg: Outbound, sender: 'bot' | 'ai' = 'bot'): void => { s.out.push({ msg, sender }); };

// IDs that are always accepted, even from an old message (pure navigation).
const GLOBAL_IDS = new Set(['menu', 'browse', 'cart', 'track', 'human', 'faq', 'search', 'checkout']);
// IDs that change cart/order: must come from the most recent bot turn, otherwise rejected as stale.
const STRICT_PREFIXES = ['q:', 'rm:', 'clearcart', 'confirm', 'cancelco', 'addr:', 'phone:'];

// ------------------------------------------------------------------------------------------------
// Per-customer serialization: messages from one customer are processed strictly in order.
// (In-memory: fine for a single server process. Use a Redis lock/queue if you run several instances.)
// ------------------------------------------------------------------------------------------------
const locks = new Map<string, Promise<unknown>>();
export function handleInbound(ev: Inbound): Promise<void> {
  const prev = locks.get(ev.waId) ?? Promise.resolve();
  const next = prev.then(() => processInbound(ev)).catch((e) => console.error('[engine]', e));
  locks.set(ev.waId, next);
  next.finally(() => { if (locks.get(ev.waId) === next) locks.delete(ev.waId); });
  return next;
}

async function processInbound(ev: Inbound) {
  // Exactly-once: the wamid is unique on Message, so a re-delivered webhook is ignored.
  if (ev.waMessageId && (await prisma.message.findUnique({ where: { waMessageId: ev.waMessageId } }))) return;

  const customer = await prisma.customer.upsert({
    where: { waId: ev.waId },
    update: ev.name ? { name: ev.name } : {},
    create: { waId: ev.waId, name: ev.name ?? null },
  });
  let conv = await prisma.conversation.upsert({
    where: { customerId: customer.id },
    update: {},
    create: { customerId: customer.id },
  });

  const body = ev.kind === 'reply' ? `[tapped] ${ev.replyTitle ?? ev.replyId}` : ev.kind === 'image' ? `[image] ${ev.text ?? ''}` : ev.text ?? `[${ev.kind}]`;
  let inboundId = 0;
  try {
    inboundId = (await prisma.message.create({
      data: {
        conversationId: conv.id, waMessageId: ev.waMessageId ?? null, direction: 'IN', sender: 'customer',
        type: ev.kind, body, payloadJson: JSON.stringify(ev),
      },
    })).id;
  } catch {
    return; // unique violation = duplicate delivered concurrently
  }

  conv = await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastInboundAt: new Date(), turn: { increment: 1 } },
  });

  const s: Session = {
    conv, customer, ctx: { filters: {}, page: 0, ...safeJson(conv.contextJson) }, state: conv.state, out: [],
  };

  if (conv.botPaused) {
    // Human agent is handling this chat. Customer can type "menu" to return to the bot.
    if (ev.kind === 'text' && /^(menu|bot)$/i.test((ev.text ?? '').trim())) {
      await prisma.conversation.update({ where: { id: conv.id }, data: { botPaused: false, needsHuman: false } });
      await sendWelcome(s);
    } else return;
  } else if (ev.kind === 'reply' && ev.replyId) {
    await handleReply(s, ev.replyId);
  } else if (ev.kind === 'text') {
    await handleText(s, (ev.text ?? '').trim());
  } else if (ev.kind === 'image') {
    await handleImage(s, ev, inboundId);
  } else {
    await sendWelcome(s);
  }

  await prisma.conversation.update({
    where: { id: conv.id },
    data: { state: s.state, contextJson: JSON.stringify(s.ctx) },
  });
  for (const o of s.out) await deliver(s.conv, s.customer.waId, o.msg, o.sender);
}

/** Customer sent a photo: store it (so agents can see it in the Inbox), then let the AI find similar suits. */
async function handleImage(s: Session, ev: Inbound, inboundId: number): Promise<void> {
  let url = ev.imageUrl;
  if (!url && ev.mediaId) {
    try {
      url = await processAndStore(await downloadMedia(ev.mediaId), 'chat');
    } catch (e: any) {
      console.error('[image] could not download customer photo:', e?.message);
    }
  }
  if (url && inboundId) {
    await prisma.message.update({ where: { id: inboundId }, data: { payloadJson: JSON.stringify({ ...ev, imageUrl: url }) } });
  }
  if (url && (await aiAvailable())) {
    try {
      return await aiRespond(s, ev.text?.trim() || '', { imageUrl: url });
    } catch (e: any) {
      console.error('[ai] photo search failed:', e?.message);
    }
  }
  if (ev.text?.trim()) return handleText(s, ev.text.trim());
  say(s, { type: 'text', text: await text('image_received') });
  return sendWelcome(s, false);
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}

// ------------------------------------------------------------------------------------------------
// Taps (button_reply / list_reply)
// ------------------------------------------------------------------------------------------------

async function isOptionValid(s: Session, id: string): Promise<boolean> {
  if (GLOBAL_IDS.has(id)) return true;
  const strict = STRICT_PREFIXES.some((p) => id.startsWith(p));
  const lastBotTurn = s.conv.turn - 1;
  const menus = await prisma.outboundMenu.findMany({
    where: {
      conversationId: s.conv.id,
      ...(strict ? { turn: lastBotTurn } : { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } }),
    },
    orderBy: { id: 'desc' },
    take: 60,
  });
  return menus.some((m) => (JSON.parse(m.optionIds) as string[]).includes(id));
}

async function resendLatestMenus(s: Session): Promise<void> {
  const latest = await prisma.outboundMenu.findFirst({ where: { conversationId: s.conv.id }, orderBy: { id: 'desc' } });
  if (!latest) return sendWelcome(s);
  const menus = await prisma.outboundMenu.findMany({ where: { conversationId: s.conv.id, turn: latest.turn }, orderBy: { id: 'asc' } });
  for (const m of menus) say(s, JSON.parse(m.payloadJson));
}

export async function handleReply(s: Session, id: string): Promise<void> {
  if (!(await isOptionValid(s, id))) {
    say(s, { type: 'text', text: await text('stale_option') });
    return resendLatestMenus(s);
  }
  return runAction(s, id);
}

/** Single router for every action ID (buttons, list rows, admin-configured menu actions). */
export async function runAction(s: Session, id: string): Promise<void> {
  const [kind, a, b] = id.split(':');
  switch (kind) {
    case 'menu': return sendWelcome(s);
    case 'browse': s.ctx.filters = {}; s.ctx.page = 0; return sendCategories(s);
    case 'search':
      s.state = 'SEARCH';
      return say(s, { type: 'text', text: 'Type what you are looking for, e.g. “blue 3 piece lawn under 6000” 🔎' });
    case 'catpage': return sendCategories(s, Number(a) || 0);
    case 'cat': s.ctx.filters = { categoryId: Number(a) }; s.ctx.page = 0; return afterCategory(s);
    case 'st':
      s.ctx.filters.stitching = a === 'ANY' ? undefined : (a as 'STITCHED' | 'UNSTITCHED');
      delete s.ctx.filters.size; s.ctx.page = 0;
      if (a === 'STITCHED') return sendSizes(s);
      return sendResults(s);
    case 'size': s.ctx.filters.size = a === 'ANY' ? undefined : a; s.ctx.page = 0; return sendResults(s);
    case 'more': s.ctx.page += 1; return sendResults(s);
    case 'filters': return s.ctx.filters.categoryId ? afterCategory(s, true) : sendCategories(s);
    case 'results': return sendResults(s);
    case 'p': return sendProduct(s, Number(a), Number(b ?? 0));
    case 'v': return sendQuantity(s, Number(a));
    case 'q': return doAddToCart(s, Number(a), Number(b));
    case 'cart': return sendCart(s);
    case 'editcart': return sendEditCart(s);
    case 'rm': await removeCartItem(s.customer.id, Number(a)); return sendCart(s);
    case 'clearcart': await clearCart(s.customer.id); return sendCart(s);
    case 'addmore': return s.ctx.filters.categoryId || s.ctx.filters.query ? sendResults(s) : sendCategories(s);
    case 'checkout': return startCheckout(s);
    case 'addr':
      if (a === 'saved') return sendReview(s);
      s.ctx.checkout = {}; s.state = 'CHECKOUT_NAME';
      return say(s, { type: 'text', text: await text('ask_name') });
    case 'phone': s.ctx.checkout = { ...s.ctx.checkout, phone: localPhone(s.customer.waId) }; return sendReview(s);
    case 'confirm': return confirmOrder(s);
    case 'cancelco':
      s.state = 'CART'; s.ctx.checkout = undefined;
      return say(s, buttons(await text('order_cancelled'), [['cart', 'View cart'], ['menu', 'Main menu']]));
    case 'track': return sendOrders(s);
    case 'o': return sendOrder(s, Number(a));
    case 'human': return handoff(s);
    case 'faq': return sendFaqList(s);
    case 'kb': return sendFaqAnswer(s, Number(a));
    case 'cm': return sendCustomMenu(s, Number(a));
    case 'ci': return runCustomItem(s, Number(a));
    case 'mm': return runMainItem(s, Number(a));
    default: return sendWelcome(s);
  }
}

/** Converts an admin-configured action string to behaviour. */
async function runConfiguredAction(s: Session, action: string): Promise<void> {
  if (action.startsWith('TEXT:')) {
    return say(s, buttons(action.slice(5), [['menu', 'Main menu'], ['human', 'Talk to agent']]));
  }
  if (action.startsWith('MENU:')) return sendCustomMenu(s, Number(action.slice(5)));
  const map: Record<string, string> = { BROWSE: 'browse', CART: 'cart', TRACK: 'track', HUMAN: 'human', FAQ: 'faq', SEARCH: 'search', MENU: 'menu' };
  return runAction(s, map[action] ?? 'menu');
}

function actionToId(action: string, fallbackId: string) {
  const map: Record<string, string> = { BROWSE: 'browse', CART: 'cart', TRACK: 'track', HUMAN: 'human', FAQ: 'faq', SEARCH: 'search' };
  if (map[action]) return map[action];
  if (action.startsWith('MENU:')) return `cm:${action.slice(5)}`;
  return fallbackId; // TEXT: actions resolved by item id
}

// ------------------------------------------------------------------------------------------------
// Free text
// ------------------------------------------------------------------------------------------------

const GREETING = /^(hi+|hello|hey|salam|slam|assalam[\s-]?o[\s-]?alaikum|aoa|asalam o alaikum|menu|start|main menu|home)[\s!.]*$/i;

async function handleText(s: Session, t: string): Promise<void> {
  const lower = t.toLowerCase();
  if (GREETING.test(t)) return sendWelcome(s);
  if (/^(cart|my cart|basket)$/i.test(t)) return sendCart(s);
  if (/^(agent|human|talk to agent|support|representative)$/i.test(t)) return handoff(s);
  if (/^(cancel|stop)$/i.test(t) && s.state.startsWith('CHECKOUT')) return runAction(s, 'cancelco');

  // A question typed in the middle of checkout: answer it, then repeat the current step (don't lose progress).
  const checkoutStep = s.state.startsWith('CHECKOUT') ? s.state : null;
  const isQuestion = /\?$|^(what|how|when|kya|kitna|kitne|kab|delivery|price)\b/i.test(t);
  if (checkoutStep && (isQuestion || checkoutStep === 'CHECKOUT_REVIEW' || checkoutStep === 'CHECKOUT_SAVED')) {
    await answerFreeText(s, t, true);
    s.state = checkoutStep;
    return repeatCheckoutStep(s);
  }

  // 1) Text the current step expects
  switch (s.state) {
    case 'CHECKOUT_NAME':
      if (t.length < 2 || t.length > 60 || /\d{3,}/.test(t)) return say(s, { type: 'text', text: 'Please type a valid full name.' });
      s.ctx.checkout = { ...s.ctx.checkout, name: t }; s.state = 'CHECKOUT_CITY';
      return say(s, { type: 'text', text: await text('ask_city') });
    case 'CHECKOUT_CITY': {
      const cities = (await setting('serviceableCities')).split(',').map((c) => c.trim()).filter(Boolean);
      const match = cities.find((c) => c.toLowerCase() === lower);
      if (cities.length && !match)
        return say(s, { type: 'text', text: await text('city_not_served', { city: t, cities: cities.join(', ') }) });
      s.ctx.checkout = { ...s.ctx.checkout, city: match ?? titleCase(t) }; s.state = 'CHECKOUT_ADDRESS';
      return say(s, { type: 'text', text: await text('ask_address') });
    }
    case 'CHECKOUT_ADDRESS':
      if (t.length < 10) return say(s, { type: 'text', text: 'Please type the complete address (house, street, area).' });
      s.ctx.checkout = { ...s.ctx.checkout, address: t }; s.state = 'CHECKOUT_PHONE';
      return say(s, buttons(await text('ask_phone'), [['phone:wa', 'Use WhatsApp no.']]));
    case 'CHECKOUT_PHONE': {
      const p = parsePhone(t);
      if (!p) return say(s, buttons('Please type a valid mobile number, e.g. 03001234567', [['phone:wa', 'Use WhatsApp no.']]));
      s.ctx.checkout = { ...s.ctx.checkout, phone: p };
      return sendReview(s);
    }
    case 'QUANTITY': {
      const n = Number(t);
      if (Number.isInteger(n) && n > 0 && s.ctx.variantId) return doAddToCart(s, s.ctx.variantId, n);
      break;
    }
    case 'TRACK': {
      const o = await prisma.order.findFirst({ where: { orderNo: t.toUpperCase(), customerId: s.customer.id } });
      if (o) return sendOrder(s, o.id);
      break;
    }
  }

  return answerFreeText(s, t, false);
}

/** auto-reply -> AI -> keyword search -> fallback. `quiet` = don't send menus (caller re-sends its own step). */
async function answerFreeText(s: Session, t: string, quiet: boolean): Promise<void> {
  const lower = t.toLowerCase();
  // 2) Admin keyword auto-replies
  const auto = await matchAutoReply(lower);
  if (auto) {
    say(s, { type: 'text', text: auto.response });
    if (auto.action && !quiet) await runConfiguredAction(s, auto.action);
    return;
  }

  // 3) AI with grounded tools
  if (await aiAvailable()) {
    try {
      return await aiRespond(s, t);
    } catch (e: any) {
      console.error('[ai] failed, falling back to menus:', e?.message);
    }
  }

  if (quiet) return; // the checkout step prompt that follows is the fallback
  // 4) Deterministic fallback: keyword product search, else menu
  const found = await searchProducts({ query: t });
  if (found.length) {
    s.ctx.filters = { query: t }; s.ctx.page = 0;
    return sendResults(s);
  }
  say(s, { type: 'text', text: await text('fallback') });
  return sendWelcome(s, false);
}

async function repeatCheckoutStep(s: Session): Promise<void> {
  switch (s.state) {
    case 'CHECKOUT_NAME': return say(s, { type: 'text', text: await text('ask_name') });
    case 'CHECKOUT_CITY': return say(s, { type: 'text', text: await text('ask_city') });
    case 'CHECKOUT_ADDRESS': return say(s, { type: 'text', text: await text('ask_address') });
    case 'CHECKOUT_PHONE': return say(s, buttons(await text('ask_phone'), [['phone:wa', 'Use WhatsApp no.']]));
    case 'CHECKOUT_SAVED': return startCheckout(s);
    default: return sendReview(s);
  }
}

async function matchAutoReply(lower: string) {
  const rules = await prisma.autoReply.findMany({ where: { active: true }, orderBy: { priority: 'desc' } });
  return rules.find((r) =>
    r.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
      .some((k) => (r.matchType === 'EXACT' ? lower === k : lower.includes(k))),
  );
}

const titleCase = (t: string) => t.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function parsePhone(t: string): string | null {
  const d = t.replace(/[\s-()]/g, '');
  if (/^(\+?92|0092)3\d{9}$/.test(d)) return '0' + d.replace(/^(\+?92|0092)/, '');
  if (/^03\d{9}$/.test(d)) return d;
  if (/^\+?\d{10,15}$/.test(d)) return d;
  return null;
}
function localPhone(waId: string) {
  if (waId.startsWith('sim:')) return '03000000000';
  return waId.startsWith('92') ? '0' + waId.slice(2) : '+' + waId;
}

// ------------------------------------------------------------------------------------------------
// Message builders
// ------------------------------------------------------------------------------------------------

export function buttons(body: string, btns: [string, string][], extra: Partial<Extract<Outbound, { type: 'buttons' }>> = {}): Outbound {
  return { type: 'buttons', body, buttons: btns.map(([id, title]) => ({ id, title })), ...extra };
}

function list(body: string, buttonText: string, rows: ListRow[], sectionTitle = 'Options'): Outbound {
  return { type: 'list', body, buttonText, sections: [{ title: sectionTitle, rows }] };
}

/** <=3 options -> buttons, else list (max 10 rows). */
function choice(body: string, rows: ListRow[], buttonText = 'Choose'): Outbound {
  if (rows.length <= 3) return { type: 'buttons', body, buttons: rows.map((r) => ({ id: r.id, title: r.title })) };
  return list(body, buttonText, rows.slice(0, 10));
}

export async function sendWelcome(s: Session, withGreeting = true): Promise<void> {
  s.state = 'WELCOME';
  s.ctx = { filters: {}, page: 0 };
  const items = await prisma.mainMenuItem.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  const rows: ListRow[] = items.length
    ? items.map((i) => ({ id: actionToId(i.action, `mm:${i.id}`), title: i.label, description: i.description || undefined }))
    : [{ id: 'browse', title: 'Browse Suits' }, { id: 'track', title: 'Track Order' }, { id: 'human', title: 'Talk to Agent' }];
  const body = withGreeting
    ? await text('welcome', { name: s.customer.name?.split(' ')[0] ?? '' }).then((t) => t.replace(/ !/, '!'))
    : 'What would you like to do?';
  say(s, choice(body, rows, 'Menu'));
}

async function runMainItem(s: Session, itemId: number): Promise<void> {
  const item = await prisma.mainMenuItem.findUnique({ where: { id: itemId } });
  return item ? runConfiguredAction(s, item.action) : sendWelcome(s);
}

async function sendCategories(s: Session, page = 0): Promise<void> {
  s.state = 'CATEGORY';
  const cats = await availableCategories();
  if (!cats.length) return say(s, buttons(await text('no_results'), [['human', 'Talk to agent'], ['menu', 'Main menu']]));
  // WhatsApp lists hold 10 rows: up to 9 categories + Main menu, or 8 + "More" + Main menu when there are more.
  const PER = cats.length <= 9 ? 9 : 8;
  if (page * PER >= cats.length) page = 0;
  const rows: ListRow[] = cats.slice(page * PER, page * PER + PER).map((c) => ({ id: `cat:${c.id}`, title: c.name }));
  if (cats.length > (page + 1) * PER) rows.push({ id: `catpage:${page + 1}`, title: 'More collections ▶' });
  else if (page > 0) rows.push({ id: 'catpage:0', title: '◀ First collections' });
  rows.push({ id: 'menu', title: '⬅ Main menu' });
  const pages = Math.ceil(cats.length / PER);
  say(s, list(`${await text('choose_category')}${pages > 1 ? ` (${page + 1}/${pages})` : ''}`, 'Collections', rows, 'Collections'));
}

async function afterCategory(s: Session, forceAsk = false): Promise<void> {
  const kinds = await availableStitching({ categoryId: s.ctx.filters.categoryId });
  if (kinds.length > 1 || (forceAsk && kinds.length)) {
    s.state = 'STITCHING';
    const btns: [string, string][] = [];
    if (kinds.includes('STITCHED')) btns.push(['st:STITCHED', 'Stitched']);
    if (kinds.includes('UNSTITCHED')) btns.push(['st:UNSTITCHED', 'Unstitched']);
    btns.push(['st:ANY', 'Show both']);
    return say(s, buttons(await text('choose_stitching'), btns));
  }
  if (kinds[0] === 'STITCHED') { s.ctx.filters.stitching = 'STITCHED'; return sendSizes(s); }
  return sendResults(s);
}

async function sendSizes(s: Session): Promise<void> {
  const sizes = await availableSizes(s.ctx.filters);
  if (sizes.length <= 1) return sendResults(s);
  s.state = 'SIZE';
  const rows: ListRow[] = sizes.slice(0, 8).map((z) => ({ id: `size:${z}`, title: z }));
  rows.push({ id: 'size:ANY', title: 'Any size' }, { id: 'filters', title: '⬅ Back' });
  say(s, list(await text('choose_size'), 'Sizes', rows, 'Sizes'));
}

type Img = { url: string; color: string | null };
/** Best photo for a colour: that colour's own photo, else the cover. */
export function imageFor(images: Img[], color?: string | null): string | undefined {
  if (color) {
    const c = images.find((i) => i.color && i.color.toLowerCase() === color.toLowerCase());
    if (c) return c.url;
  }
  return (images.find((i) => !i.color) ?? images[0])?.url;
}

export async function productCard(p: NonNullable<Awaited<ReturnType<typeof getProduct>>>, variants = p.variants): Promise<Outbound> {
  const inStock = variants.filter((v) => v.stock > 0);
  const { min, max } = priceRange(inStock.length ? inStock : p.variants);
  const price = min === max ? await money(min) : `${await money(min)} – ${await money(max)}`;
  const colors = [...new Set(inStock.map((v) => v.color))].join(', ');
  const onSale = inStock.some((v) => v.salePrice);
  const body = [
    `*${p.title}*`,
    `${p.fabric} · ${p.piecesCount}-piece · ${p.stitchingType === 'STITCHED' ? 'Stitched' : 'Unstitched'}`,
    `💰 ${price}${onSale ? ' (SALE)' : ''}`,
    colors ? `🎨 ${colors}` : '',
  ].filter(Boolean).join('\n');
  // If the customer's filters leave only one colour, show that colour's photo on the card.
  const onlyColor = new Set(inStock.map((v) => v.color.toLowerCase())).size === 1 ? inStock[0].color : null;
  const img = imageFor(p.images, onlyColor);
  return buttons(body, [[`p:${p.id}`, 'View & Buy']], img ? { headerImage: img } : { headerText: p.title });
}

async function sendResults(s: Session): Promise<void> {
  const per = Math.max(1, Math.min(5, await settingNum('resultsPerPage')));
  const all = await searchProducts(s.ctx.filters);
  if (!all.length) {
    s.state = 'RESULTS';
    return say(s, buttons(await text('no_results'), [['filters', 'Change filters'], ['browse', 'Collections'], ['human', 'Talk to agent']]));
  }
  if (s.ctx.page * per >= all.length) s.ctx.page = 0;
  const pageItems = all.slice(s.ctx.page * per, s.ctx.page * per + per);
  s.state = 'RESULTS';
  for (const r of pageItems) say(s, await productCard(r.product, r.variants));
  const from = s.ctx.page * per + 1, to = s.ctx.page * per + pageItems.length;
  const nav: [string, string][] = [];
  if (to < all.length) nav.push(['more', 'More suits ▶']);
  nav.push(['filters', 'Change filters'], ['menu', 'Main menu']);
  say(s, buttons(await text('results_more', { from, to, total: all.length }), nav));
}

async function sendProduct(s: Session, productId: number, vpage = 0): Promise<void> {
  const p = await getProduct(productId);
  if (!p) return say(s, buttons('Sorry, this suit is no longer available.', [['results', 'Back to results'], ['menu', 'Main menu']]));
  s.state = 'PRODUCT'; s.ctx.productId = p.id;
  // Respect size/colour the customer already picked, but fall back to all in-stock variants.
  let variants = p.variants.filter((v) => v.stock > 0 && (!s.ctx.filters.size || v.size === s.ctx.filters.size));
  if (!variants.length) variants = p.variants.filter((v) => v.stock > 0);

  const details = [
    `*${p.title}*`,
    p.description,
    `Fabric: ${p.fabric} | Pieces: ${p.piecesCount} | ${p.stitchingType === 'STITCHED' ? 'Stitched' : 'Unstitched'}`,
    p.occasion ? `Occasion: ${p.occasion}` : '',
  ].filter(Boolean).join('\n');

  if (!variants.length) {
    return say(s, buttons(`${details}\n\n❌ Currently out of stock.`, [['results', 'Back to results'], ['human', 'Ask an agent']]));
  }
  const low = await settingNum('lowStockThreshold');
  const PER = 8;
  const pageV = variants.slice(vpage * PER, vpage * PER + PER);
  const rows: ListRow[] = await Promise.all(pageV.map(async (v) => ({
    id: `v:${v.id}`,
    title: variantLabel(v),
    description: `${await money(unitPrice(v))}${v.salePrice ? ` (was ${v.price})` : ''}${v.stock <= low ? ` · only ${v.stock} left` : ''}`,
  })));
  if (variants.length > (vpage + 1) * PER) rows.push({ id: `p:${p.id}:${vpage + 1}`, title: 'More options ▶' });
  rows.push({ id: 'results', title: '⬅ Back to results' });
  if (rows.length < 10) rows.push({ id: 'human', title: 'Ask a question' });
  const out = list(details, 'Choose option', rows, p.stitchingType === 'STITCHED' ? 'Size / Colour' : 'Colour');
  if (vpage === 0) for (const im of await productGallery(p.images, variants, p.title)) say(s, im);
  say(s, out);
}

/**
 * Max 3 photos per product view (each photo is a separate WhatsApp message).
 * If 2+ in-stock colours have their own photos, show one photo per colour, captioned with the colour name,
 * so the customer can compare colours. Otherwise show the cover + extra general photos.
 */
async function productGallery(images: Img[], variants: { color: string }[], title = ''): Promise<Outbound[]> {
  const colors = [...new Set(variants.map((v) => v.color))];
  const perColor = colors
    .map((c) => ({ c, im: images.find((i) => i.color && i.color.toLowerCase() === c.toLowerCase()) }))
    .filter((x) => x.im);
  if (perColor.length >= 2) return perColor.slice(0, 3).map((x) => ({ type: 'image', url: x.im!.url, caption: `🎨 ${x.c}` }));
  const general = images.filter((i) => !i.color);
  const pick = (general.length ? general : images).slice(0, 3);
  return pick.map((im, n) => ({ type: 'image', url: im.url, ...(n === 0 && title ? { caption: title } : {}) }));
}

async function sendQuantity(s: Session, variantId: number): Promise<void> {
  const v = await prisma.variant.findUnique({ where: { id: variantId }, include: { product: { include: { images: { orderBy: { position: 'asc' } } } } } });
  if (!v || !v.active || v.stock <= 0 || v.product.status !== 'ACTIVE') return say(s, buttons('Sorry, this option just went out of stock.', [['results', 'Back to results']]));
  s.state = 'QUANTITY'; s.ctx.variantId = v.id;
  const maxQ = Math.min(v.stock, (await settingNum('maxQtyPerItem')) || 10, 3);
  const btns: [string, string][] = [];
  for (let i = 1; i <= maxQ; i++) btns.push([`q:${v.id}:${i}`, i === 1 ? 'Add 1 to cart' : `Add ${i}`]);
  const img = imageFor(v.product.images, v.color);
  say(s, buttons(`*${v.product.title}* — ${variantLabel(v)}\n${await money(unitPrice(v))}\n\n${await text('ask_quantity')} (or type a number)`, btns,
    img ? { headerImage: img } : {}));
}

async function doAddToCart(s: Session, variantId: number, qty: number): Promise<void> {
  try {
    await addToCart(s.customer.id, variantId, qty);
  } catch (e) {
    if (e instanceof CommerceError) {
      const msg = e.code === 'OUT_OF_STOCK' ? await text('out_of_stock', { stock: String(e.data.stock ?? 0) })
        : e.code === 'MAX_QTY' ? `You can order at most ${e.data.max} of one item.` : e.message;
      return say(s, buttons(msg, [['cart', 'View cart'], ['results', 'Back to results']]));
    }
    throw e;
  }
  say(s, { type: 'text', text: await text('added_to_cart') });
  return sendCart(s);
}

export async function cartText(customerId: number) {
  const cart = await getCart(customerId);
  if (!cart.items.length) return { cart, text: '' };
  const lines = await Promise.all(cart.items.map(async (i, n) =>
    `${n + 1}. ${i.variant.product.title} (${variantLabel(i.variant)}) × ${i.quantity} — ${await money(unitPrice(i.variant) * i.quantity)}`));
  const t = `🛒 *Your cart*\n${lines.join('\n')}\n\nSubtotal: ${await money(cart.subtotal)}\nDelivery: ${cart.shipping ? await money(cart.shipping) : 'FREE'}\n*Total: ${await money(cart.total)}*`;
  return { cart, text: t };
}

export async function sendCart(s: Session): Promise<void> {
  s.state = 'CART';
  const { cart, text: t } = await cartText(s.customer.id);
  if (!cart.items.length) return say(s, buttons(await text('cart_empty'), [['browse', 'Browse suits'], ['menu', 'Main menu']]));
  say(s, buttons(t, [['checkout', 'Checkout ✅'], ['addmore', 'Add more'], ['editcart', 'Edit cart']]));
}

async function sendEditCart(s: Session): Promise<void> {
  const cart = await getCart(s.customer.id);
  if (!cart.items.length) return sendCart(s);
  const rows: ListRow[] = cart.items.slice(0, 8).map((i) => ({
    id: `rm:${i.id}`, title: `Remove ${i.variant.product.title}`, description: `${variantLabel(i.variant)} × ${i.quantity}`,
  }));
  rows.push({ id: 'clearcart', title: 'Empty the cart' }, { id: 'cart', title: '⬅ Back to cart' });
  say(s, list(await text('edit_cart'), 'Edit cart', rows, 'Items'));
}

async function startCheckout(s: Session): Promise<void> {
  if (!(await settingBool('codEnabled')))
    return say(s, buttons('Online ordering is paused right now. Please talk to our team.', [['human', 'Talk to agent']]));
  const { cart, problems } = await validateCart(s.customer.id);
  if (!cart.items.length) return sendCart(s);
  if (problems.length) {
    say(s, { type: 'text', text: `⚠️ Please update your cart:\n• ${problems.join('\n• ')}` });
    return sendEditCart(s);
  }
  const last = await prisma.order.findFirst({ where: { customerId: s.customer.id }, orderBy: { createdAt: 'desc' } });
  if (last) {
    s.ctx.checkout = { name: last.name, city: last.city, address: last.address, phone: last.phone };
    s.state = 'CHECKOUT_SAVED';
    return say(s, buttons(await text('saved_address', { address: `${last.name}\n${last.address}, ${last.city}\n${last.phone}` }),
      [['addr:saved', 'Yes, use this'], ['addr:new', 'New address']]));
  }
  s.ctx.checkout = {}; s.state = 'CHECKOUT_NAME';
  say(s, { type: 'text', text: await text('ask_name') });
}

async function sendReview(s: Session): Promise<void> {
  const c = s.ctx.checkout;
  if (!c?.name || !c.city || !c.address || !c.phone) { s.state = 'CHECKOUT_NAME'; return say(s, { type: 'text', text: await text('ask_name') }); }
  const { cart, text: t } = await cartText(s.customer.id);
  if (!cart.items.length) return sendCart(s);
  s.state = 'CHECKOUT_REVIEW';
  say(s, buttons(
    `${t}\n\n📍 *Deliver to*\n${c.name}\n${c.address}, ${c.city}\n📞 ${c.phone}\n\n💵 Payment: Cash on Delivery\n\nPlease confirm your order:`,
    [['confirm', 'Confirm order ✅'], ['addr:new', 'Edit details'], ['cancelco', 'Cancel']],
  ));
}

async function confirmOrder(s: Session): Promise<void> {
  const c = s.ctx.checkout;
  if (s.state !== 'CHECKOUT_REVIEW' || !c?.name || !c.city || !c.address || !c.phone) return sendCart(s);
  try {
    const order = await placeOrder(s.customer.id, { name: c.name, city: c.city, address: c.address, phone: c.phone });
    s.ctx = { filters: {}, page: 0 }; s.state = 'WELCOME';
    say(s, buttons(await text('order_confirmed', { orderNo: order.orderNo, total: await money(order.total) }),
      [['track', 'Track order'], ['browse', 'Shop more']]));
  } catch (e) {
    if (e instanceof CommerceError) {
      say(s, { type: 'text', text: `⚠️ ${e.message}. Please update your cart.` });
      return sendEditCart(s);
    }
    throw e;
  }
}

async function sendOrders(s: Session): Promise<void> {
  const orders = await prisma.order.findMany({ where: { customerId: s.customer.id }, orderBy: { createdAt: 'desc' }, take: 8 });
  if (!orders.length) return say(s, buttons(await text('track_none'), [['browse', 'Browse suits'], ['human', 'Talk to agent']]));
  if (orders.length === 1) return sendOrder(s, orders[0].id);
  s.state = 'TRACK';
  const rows: ListRow[] = await Promise.all(orders.map(async (o) => ({
    id: `o:${o.id}`, title: o.orderNo, description: `${STATUS_LABEL[o.status] ?? o.status} · ${await money(o.total)}`,
  })));
  rows.push({ id: 'menu', title: '⬅ Main menu' });
  say(s, list(await text('track_pick'), 'My orders', rows, 'Orders'));
}

async function sendOrder(s: Session, orderId: number): Promise<void> {
  const o = await prisma.order.findFirst({ where: { id: orderId, customerId: s.customer.id }, include: { items: true } });
  if (!o) return sendOrders(s);
  const items = o.items.map((i) => `• ${i.title} (${variantLabel(i)}) × ${i.quantity}`).join('\n');
  const tracking = o.trackingNo ? `\n🚚 ${o.courier} tracking: ${o.trackingNo}` : '';
  say(s, buttons(
    `📦 *Order ${o.orderNo}*\nStatus: ${STATUS_LABEL[o.status] ?? o.status}${tracking}\n\n${items}\n\nTotal: ${await money(o.total)} (${o.paymentMethod})`,
    [['human', 'Need help'], ['menu', 'Main menu']],
  ));
}

export async function handoff(s: Session, reason = ''): Promise<void> {
  await prisma.conversation.update({ where: { id: s.conv.id }, data: { botPaused: true, needsHuman: true } });
  s.conv.botPaused = true;
  s.state = 'HANDOFF';
  if (reason) console.log(`[handoff] ${s.customer.waId}: ${reason}`);
  say(s, { type: 'text', text: await text('handoff') });
}

async function sendFaqList(s: Session): Promise<void> {
  const kb = await prisma.knowledgeEntry.findMany({ where: { active: true }, take: 9 });
  const rows: ListRow[] = kb.map((k) => ({ id: `kb:${k.id}`, title: k.question }));
  rows.push({ id: 'human', title: 'Talk to agent' });
  say(s, list('Frequently asked questions:', 'Questions', rows, 'FAQ'));
}

async function sendFaqAnswer(s: Session, id: number): Promise<void> {
  const k = await prisma.knowledgeEntry.findUnique({ where: { id } });
  say(s, buttons(k ? `*${k.question}*\n${k.answer}` : 'Not found', [['faq', 'More questions'], ['menu', 'Main menu']]));
}

async function sendCustomMenu(s: Session, menuId: number): Promise<void> {
  const m = await prisma.customMenu.findFirst({ where: { id: menuId, active: true }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  if (!m) return sendWelcome(s);
  s.state = 'CUSTOM_MENU';
  const rows: ListRow[] = m.items.slice(0, 9).map((i) => ({ id: actionToId(i.action, `ci:${i.id}`), title: i.label, description: i.description || undefined }));
  if (rows.length > 3 && rows.length < 10) rows.push({ id: 'menu', title: '⬅ Main menu' });
  say(s, choice(m.body, rows, m.buttonText));
}

async function runCustomItem(s: Session, itemId: number): Promise<void> {
  const item = await prisma.customMenuItem.findUnique({ where: { id: itemId } });
  return item ? runConfiguredAction(s, item.action) : sendWelcome(s);
}

// Re-export for the AI layer
export { sendResults, sendCart as showCart };
export const aiButtons = (): Button[] => [{ id: 'menu', title: 'Main menu' }, { id: 'cart', title: 'View cart' }, { id: 'human', title: 'Talk to agent' }];
