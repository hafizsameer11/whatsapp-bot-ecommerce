import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { settingNum } from './config.js';
import { changeStock } from './inventory.js';

export type Filters = {
  categoryId?: number;
  stitching?: 'STITCHED' | 'UNSTITCHED';
  size?: string;
  color?: string;
  fabric?: string;
  pieces?: number;
  minPrice?: number;
  maxPrice?: number;
  query?: string;
};

export const unitPrice = (v: { price: number; salePrice: number | null }) => v.salePrice ?? v.price;

const productInclude = {
  category: true,
  images: { orderBy: { position: 'asc' } },
  variants: { where: { active: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.ProductInclude;
export type FullProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const norm = (s: string) => s.toLowerCase().trim();

function variantMatches(v: FullProduct['variants'][number], f: Filters) {
  if (v.stock <= 0) return false;
  if (f.size && norm(v.size ?? '') !== norm(f.size)) return false;
  if (f.color && !norm(v.color).includes(norm(f.color))) return false;
  const p = unitPrice(v);
  if (f.maxPrice && p > f.maxPrice) return false;
  if (f.minPrice && p < f.minPrice) return false;
  return true;
}

function textScore(p: FullProduct, query: string): number {
  const hay = norm(
    [p.title, p.description, p.fabric, p.occasion, p.tags, p.category.name, ...p.variants.map((v) => v.color)].join(' '),
  );
  const tokens = norm(query).split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  if (!tokens.length) return 1;
  return tokens.filter((t) => hay.includes(t)).length / tokens.length;
}

/** Products that have at least one IN-STOCK variant matching all filters. Never returns hidden/draft items. */
export async function searchProducts(f: Filters): Promise<{ product: FullProduct; variants: FullProduct['variants'] }[]> {
  const products = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      category: { active: true },
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.stitching ? { stitchingType: f.stitching } : {}),
      ...(f.pieces ? { piecesCount: f.pieces } : {}),
      ...(f.fabric ? { fabric: { contains: f.fabric } } : {}),
    },
    include: productInclude,
    orderBy: { createdAt: 'desc' },
  });
  const out = products
    .map((product) => ({ product, variants: product.variants.filter((v) => variantMatches(v, f)) }))
    .filter((r) => r.variants.length > 0);
  if (!f.query) return out;
  const scored = out.map((r) => ({ r, s: textScore(r.product, f.query!) }));
  const best = Math.max(0, ...scored.map((x) => x.s));
  // If some products match every word, show only those; otherwise allow partial (>=50%) matches.
  return scored
    .filter((x) => x.s >= 0.5 && (best < 1 || x.s === 1))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}

export async function getProduct(id: number) {
  return prisma.product.findFirst({ where: { id, status: 'ACTIVE' }, include: productInclude });
}

export async function availableCategories() {
  const cats = await prisma.category.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  const res = [];
  for (const c of cats) if ((await searchProducts({ categoryId: c.id })).length) res.push(c);
  return res;
}

export async function availableStitching(f: Filters) {
  const r = await searchProducts({ ...f, stitching: undefined });
  return [...new Set(r.map((x) => x.product.stitchingType))] as ('STITCHED' | 'UNSTITCHED')[];
}

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
export async function availableSizes(f: Filters) {
  const r = await searchProducts({ ...f, size: undefined });
  const sizes = new Set<string>();
  for (const x of r) for (const v of x.variants) if (v.size) sizes.add(v.size);
  return [...sizes].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.toUpperCase()), ib = SIZE_ORDER.indexOf(b.toUpperCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

export function priceRange(variants: { price: number; salePrice: number | null }[]) {
  const ps = variants.map(unitPrice);
  return { min: Math.min(...ps), max: Math.max(...ps) };
}

export function variantLabel(v: { color: string; size: string | null }) {
  return v.size ? `${v.size} / ${v.color}` : v.color;
}

// ---------------- Cart ----------------

export async function getCart(customerId: number) {
  const items = await prisma.cartItem.findMany({
    where: { customerId },
    include: { variant: { include: { product: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const subtotal = items.reduce((s, i) => s + unitPrice(i.variant) * i.quantity, 0);
  const fee = await settingNum('shippingFee');
  const freeOver = await settingNum('freeShippingOver');
  const shipping = items.length === 0 || (freeOver > 0 && subtotal >= freeOver) ? 0 : fee;
  return { items, subtotal, shipping, total: subtotal + shipping };
}

export class CommerceError extends Error {
  constructor(public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function addToCart(customerId: number, variantId: number, qty: number) {
  if (!Number.isInteger(qty) || qty < 1) throw new CommerceError('BAD_QTY', 'Invalid quantity');
  const v = await prisma.variant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!v || !v.active || v.product.status !== 'ACTIVE') throw new CommerceError('NOT_FOUND', 'Item not available');
  const existing = await prisma.cartItem.findUnique({ where: { customerId_variantId: { customerId, variantId } } });
  const newQty = (existing?.quantity ?? 0) + qty;
  const maxQty = (await settingNum('maxQtyPerItem')) || 10;
  if (newQty > maxQty) throw new CommerceError('MAX_QTY', `Max ${maxQty} per item`, { max: maxQty });
  if (newQty > v.stock) throw new CommerceError('OUT_OF_STOCK', 'Not enough stock', { stock: v.stock });
  await prisma.cartItem.upsert({
    where: { customerId_variantId: { customerId, variantId } },
    update: { quantity: newQty },
    create: { customerId, variantId, quantity: newQty },
  });
  return v;
}

export async function removeCartItem(customerId: number, cartItemId: number) {
  await prisma.cartItem.deleteMany({ where: { id: cartItemId, customerId } });
}

export async function clearCart(customerId: number) {
  await prisma.cartItem.deleteMany({ where: { customerId } });
}

/** Returns problems with the cart (stock dropped, item hidden) without changing it. */
export async function validateCart(customerId: number) {
  const cart = await getCart(customerId);
  const problems: string[] = [];
  for (const i of cart.items) {
    if (!i.variant.active || i.variant.product.status !== 'ACTIVE') problems.push(`${i.variant.product.title} is no longer available`);
    else if (i.variant.stock < i.quantity)
      problems.push(`${i.variant.product.title} (${variantLabel(i.variant)}): only ${i.variant.stock} left`);
  }
  return { cart, problems };
}

// ---------------- Orders ----------------

export type AddressInput = { name: string; phone: string; city: string; address: string };

function makeOrderNo() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ORD-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Atomically: re-check & decrement stock (conditional update, so two buyers can't take the last piece),
 * snapshot prices, create the order, clear the cart. Prices are always recomputed on the server.
 */
export async function placeOrder(customerId: number, addr: AddressInput) {
  const fee = await settingNum('shippingFee');
  const freeOver = await settingNum('freeShippingOver');
  return prisma.$transaction(async (tx) => {
    const items = await tx.cartItem.findMany({ where: { customerId }, include: { variant: { include: { product: true } } } });
    if (!items.length) throw new CommerceError('EMPTY', 'Cart is empty');
    for (const i of items) {
      const r = await tx.variant.updateMany({
        where: { id: i.variantId, active: true, stock: { gte: i.quantity } },
        data: { stock: { decrement: i.quantity } },
      });
      if (r.count === 0)
        throw new CommerceError('OUT_OF_STOCK', `${i.variant.product.title} (${variantLabel(i.variant)}) is out of stock`);
    }
    const subtotal = items.reduce((s, i) => s + unitPrice(i.variant) * i.quantity, 0);
    const shippingFee = freeOver > 0 && subtotal >= freeOver ? 0 : fee;
    let orderNo = makeOrderNo();
    while (await tx.order.findUnique({ where: { orderNo } })) orderNo = makeOrderNo();
    const order = await tx.order.create({
      data: {
        orderNo, customerId, subtotal, shippingFee, total: subtotal + shippingFee, ...addr,
        items: {
          create: items.map((i) => ({
            variantId: i.variantId, sku: i.variant.sku, title: i.variant.product.title, color: i.variant.color,
            size: i.variant.size, unitPrice: unitPrice(i.variant), quantity: i.quantity,
          })),
        },
      },
      include: { items: true },
    });
    for (const i of items) {
      const v = await tx.variant.findUniqueOrThrow({ where: { id: i.variantId } });
      await tx.inventoryMovement.create({
        data: { variantId: i.variantId, delta: -i.quantity, reason: 'ORDER', orderId: order.id, by: 'bot', note: order.orderNo, stockAfter: v.stock },
      });
    }
    await tx.cartItem.deleteMany({ where: { customerId } });
    return order;
  });
}

/** Cancel and put stock back exactly once. */
export async function cancelOrder(orderId: number, by = '') {
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!o) throw new CommerceError('NOT_FOUND', 'Order not found');
    if (o.status === 'CANCELLED') return o;
    for (const i of o.items) {
      if (!i.variantId) continue;
      if (!(await tx.variant.findUnique({ where: { id: i.variantId } }))) continue; // variant deleted since
      await changeStock(tx, i.variantId, i.quantity, 'CANCEL', { orderId, note: o.orderNo, by });
    }
    return tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
  });
}

export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
export const STATUS_LABEL: Record<string, string> = {
  PENDING: '🕒 Pending confirmation',
  CONFIRMED: '✅ Confirmed',
  PROCESSING: '📦 Being packed',
  SHIPPED: '🚚 Shipped',
  DELIVERED: '🎉 Delivered',
  CANCELLED: '❌ Cancelled',
};
