import { prisma } from '../lib/db.js';
import { setting, settingBool } from '../lib/config.js';
import {
  addToCart, CommerceError, getCart, getProduct, searchProducts, STATUS_LABEL, unitPrice, variantLabel,
} from '../lib/commerce.js';
import type { Session } from '../bot/engine.js';
import { loadStoredImage, toWhatsAppJpeg } from '../lib/images.js';

// The AI never touches the database directly. It can only call these tools, each of which is validated
// by the commerce layer. It cannot change prices, confirm orders or mark anything as paid.

type ToolDef = { name: string; description: string; parameters: Record<string, unknown>; sideEffect?: boolean };

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'search_products',
    description: 'Search IN-STOCK products. Use for any product/price/colour/availability question. Returns only real items.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'keywords e.g. "embroidered lawn", "bridal"' },
        category: { type: 'string', description: 'collection name e.g. Lawn, Chiffon, Wedding' },
        stitching: { type: 'string', enum: ['STITCHED', 'UNSTITCHED'] },
        color: { type: 'string' },
        size: { type: 'string', description: 'S, M, L, XL (stitched only)' },
        pieces: { type: 'integer', description: '2 or 3 piece' },
        max_price: { type: 'integer' },
        min_price: { type: 'integer' },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Full details and in-stock variants (variant_id, size, colour, price) of one product.',
    parameters: { type: 'object', properties: { product_id: { type: 'integer' } }, required: ['product_id'] },
  },
  {
    name: 'search_knowledge',
    description: 'Store policies and info: delivery, payment, exchange, size chart, fabric care, custom stitching.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  { name: 'view_cart', description: 'Current cart contents and totals.', parameters: { type: 'object', properties: {} } },
  {
    name: 'add_to_cart',
    description: 'Add a variant to the cart. Only when the customer clearly asked to add/buy a specific size & colour. variant_id must come from get_product.',
    parameters: {
      type: 'object',
      properties: { variant_id: { type: 'integer' }, quantity: { type: 'integer', minimum: 1 } },
      required: ['variant_id', 'quantity'],
    },
    sideEffect: true,
  },
  {
    name: 'get_order_status',
    description: "Status of this customer's own orders (most recent first). Optionally a specific order number.",
    parameters: { type: 'object', properties: { order_no: { type: 'string' } } },
  },
  {
    name: 'show_products',
    description: 'Display product cards (photo + "View & Buy" button) to the customer after your reply. Use whenever you recommend products. Max 3.',
    parameters: {
      type: 'object',
      properties: { product_ids: { type: 'array', items: { type: 'integer' }, maxItems: 3 } },
      required: ['product_ids'],
    },
  },
  {
    name: 'request_human',
    description: 'Hand the chat to a human agent: complaints, custom orders, payment issues, anything you cannot answer from tools.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    sideEffect: true,
  },
];

export async function aiAvailable() {
  return Boolean(process.env.OPENAI_API_KEY) && (await settingBool('aiEnabled'));
}

type Effects = { showIds: number[]; handoff?: string; cartChanged: boolean };

async function runTool(s: Session, name: string, args: any, fx: Effects): Promise<unknown> {
  switch (name) {
    case 'search_products': {
      let categoryId: number | undefined;
      if (args.category) {
        const c = await prisma.category.findFirst({ where: { name: { contains: String(args.category) } } });
        categoryId = c?.id;
      }
      const res = await searchProducts({
        query: args.query, categoryId, stitching: args.stitching, color: args.color, size: args.size,
        pieces: args.pieces, maxPrice: args.max_price, minPrice: args.min_price,
      });
      return {
        count: res.length,
        products: res.slice(0, 8).map((r) => ({
          product_id: r.product.id, title: r.product.title, category: r.product.category.name, fabric: r.product.fabric,
          pieces: r.product.piecesCount, stitching: r.product.stitchingType,
          prices: [...new Set(r.variants.map(unitPrice))], colors: [...new Set(r.variants.map((v) => v.color))],
          sizes: [...new Set(r.variants.map((v) => v.size).filter(Boolean))],
        })),
      };
    }
    case 'get_product': {
      const p = await getProduct(Number(args.product_id));
      if (!p) return { error: 'not found' };
      return {
        product_id: p.id, title: p.title, description: p.description, fabric: p.fabric, pieces: p.piecesCount,
        stitching: p.stitchingType, occasion: p.occasion,
        variants: p.variants.filter((v) => v.stock > 0).map((v) => ({
          variant_id: v.id, label: variantLabel(v), price: unitPrice(v), on_sale: !!v.salePrice, in_stock: v.stock,
        })),
      };
    }
    case 'search_knowledge': {
      const all = await prisma.knowledgeEntry.findMany({ where: { active: true } });
      const tokens = String(args.query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
      const scored = all
        .map((k) => {
          const hay = `${k.question} ${k.answer} ${k.tags}`.toLowerCase();
          return { k, score: tokens.filter((t) => hay.includes(t)).length };
        })
        .sort((a, b) => b.score - a.score);
      const hits = scored.filter((x) => x.score > 0).slice(0, 3);
      return { results: (hits.length ? hits : scored.slice(0, 3)).map((x) => ({ q: x.k.question, a: x.k.answer })) };
    }
    case 'view_cart': {
      const c = await getCart(s.customer.id);
      return {
        items: c.items.map((i) => ({ title: i.variant.product.title, option: variantLabel(i.variant), qty: i.quantity, price: unitPrice(i.variant) })),
        subtotal: c.subtotal, delivery: c.shipping, total: c.total,
      };
    }
    case 'add_to_cart': {
      try {
        const v = await addToCart(s.customer.id, Number(args.variant_id), Number(args.quantity ?? 1));
        fx.cartChanged = true;
        return { ok: true, added: `${v.product.title} ${variantLabel(v)}` };
      } catch (e) {
        if (e instanceof CommerceError) return { ok: false, error: e.code, ...e.data };
        throw e;
      }
    }
    case 'get_order_status': {
      const orders = await prisma.order.findMany({
        where: { customerId: s.customer.id, ...(args.order_no ? { orderNo: String(args.order_no).toUpperCase() } : {}) },
        orderBy: { createdAt: 'desc' }, take: 3, include: { items: true },
      });
      return {
        orders: orders.map((o) => ({
          order_no: o.orderNo, status: STATUS_LABEL[o.status] ?? o.status, total: o.total, placed: o.createdAt.toISOString().slice(0, 10),
          tracking: o.trackingNo ? `${o.courier} ${o.trackingNo}` : null, items: o.items.map((i) => `${i.title} x${i.quantity}`),
        })),
      };
    }
    case 'show_products': {
      const ids = (Array.isArray(args.product_ids) ? args.product_ids : []).map(Number).slice(0, 3);
      fx.showIds.push(...ids);
      return { ok: true, note: 'Cards will be shown after your message. Do not list prices again in detail.' };
    }
    case 'request_human':
      fx.handoff = String(args.reason ?? 'requested');
      return { ok: true };
  }
  return { error: 'unknown tool' };
}

const RULES = `
STRICT RULES:
- Only mention products, prices, colours, sizes and stock returned by tools. Never invent items, discounts or delivery dates.
- Prices are in the store currency; never change or negotiate prices.
- You cannot place or confirm orders or take payments. To order, tell the customer to tap "View cart" then "Checkout".
- Policy questions: answer only from search_knowledge. If nothing relevant, offer a human agent.
- If the customer is angry, wants a custom order, or you are unsure: call request_human.
- When recommending products, call show_products with up to 3 product_ids.
- Keep replies under 600 characters. Use WhatsApp formatting (*bold*) sparingly.`;

const PHOTO_INSTRUCTIONS =
  'The customer sent this photo of a suit they like. Look at colour, fabric look (lawn/chiffon/cotton/silk), embroidery or print, ' +
  'number of pieces and occasion. Call search_products with those attributes (if nothing matches, search again more broadly, e.g. only colour or only fabric). ' +
  'Show the closest IN-STOCK matches with show_products. Say honestly that these are similar options from our store, not the exact same suit. ' +
  'If the photo is not clothing, politely ask what they are looking for.';

async function history(convId: number) {
  const rows = await prisma.message.findMany({ where: { conversationId: convId }, orderBy: { id: 'desc' }, take: 14 });
  return rows.reverse().slice(0, -1) // drop the current inbound (added separately)
    .map((m) => ({ role: m.direction === 'IN' ? 'user' : 'assistant', content: m.body.slice(0, 600) }));
}

export async function aiRespond(s: Session, userText: string, opts: { imageUrl?: string } = {}) {
  const { buttons, productCard, showCart } = await import('../bot/engine.js');
  const enabled = new Set((await setting('aiTools')).split(',').map((x) => x.trim()));
  const tools = TOOL_DEFS.filter((t) => enabled.has(t.name)).map((t) => ({
    type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const cats = (await prisma.category.findMany({ where: { active: true } })).map((c) => c.name).join(', ');
  const system = `${await setting('aiSystemPrompt')}
Store: ${await setting('storeName')}. Currency: ${await setting('currency')}. Collections: ${cats}.
Customer name: ${s.customer.name ?? 'unknown'}. Current bot step: ${s.state}.
${RULES}`;

  let userContent: any = userText;
  if (opts.imageUrl) {
    // Small JPEG as a data URL: works for local files too, and keeps vision cost low.
    const jpeg = await toWhatsAppJpeg(await loadStoredImage(opts.imageUrl), 768, 768);
    userContent = [
      { type: 'text', text: `${userText ? `Customer wrote: "${userText}". ` : ''}${PHOTO_INSTRUCTIONS}` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'low' } },
    ];
  }
  const messages: any[] = [{ role: 'system', content: system }, ...(await history(s.conv.id)), { role: 'user', content: userContent }];
  const fx: Effects = { showIds: [], cartChanged: false };
  const model = await setting('aiModel');
  let reply = '';

  for (let step = 0; step < 6; step++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) }),
      signal: AbortSignal.timeout(25000),
    });
    const json = (await res.json()) as any;
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json?.error?.message ?? 'error'}`);
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error('OpenAI: empty response');
    messages.push(msg);
    if (!msg.tool_calls?.length) { reply = msg.content ?? ''; break; }
    for (const call of msg.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* ignore bad JSON */ }
      const result = enabled.has(call.function.name) ? await runTool(s, call.function.name, args, fx) : { error: 'tool disabled' };
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  if (fx.handoff) {
    const { handoff } = await import('../bot/engine.js');
    if (reply) s.out.push({ msg: { type: 'text', text: reply }, sender: 'ai' });
    return handoff(s, fx.handoff);
  }

  if (!reply && !fx.showIds.length) throw new Error('AI returned nothing');
  const btns: [string, string][] = fx.cartChanged
    ? [['checkout', 'Checkout ✅'], ['cart', 'View cart'], ['menu', 'Main menu']]
    : [['browse', 'Browse suits'], ['cart', 'View cart'], ['menu', 'Main menu']];

  const cards = [];
  for (const id of [...new Set(fx.showIds)]) {
    const p = await getProduct(id); // validates the AI's ids against the real catalog
    if (p && p.variants.some((v) => v.stock > 0)) cards.push(await productCard(p));
  }
  if (cards.length) {
    if (reply) s.out.push({ msg: { type: 'text', text: reply }, sender: 'ai' });
    for (const c of cards) s.out.push({ msg: c, sender: 'ai' });
    s.out.push({ msg: buttons('Tap *View & Buy* on any suit, or:', btns), sender: 'ai' });
  } else if (fx.cartChanged) {
    if (reply) s.out.push({ msg: { type: 'text', text: reply }, sender: 'ai' });
    await showCart(s);
  } else {
    s.out.push({ msg: buttons(reply, btns), sender: 'ai' });
  }
  if (!s.state.startsWith('CHECKOUT')) s.state = 'AI_CHAT';
}
