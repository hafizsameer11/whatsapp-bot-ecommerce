import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { changeStock } from './inventory.js';

type Tx = Prisma.TransactionClient;

export type VariantIn = {
  id?: number; sku: string; color: string; size?: string | null; price: number; salePrice?: number | null; active?: boolean;
  stock?: number | null; // desired stock as shown in the form
  stockLoaded?: number | null; // stock value when the form was opened (delta = stock - stockLoaded)
};
export type ImageIn = { url: string; color?: string | null; sourceUrl?: string };
export type ProductIn = {
  code?: string | null; title: string; description?: string; fabric?: string; piecesCount?: number; stitchingType?: string;
  occasion?: string; tags?: string; status?: string; categoryId: number; images?: (ImageIn | string)[]; variants: VariantIn[];
};

export const PRODUCT_STATUSES = ['ACTIVE', 'DRAFT', 'HIDDEN'];

export function normCode(c?: string | null) {
  const v = (c ?? '').trim().toUpperCase().replace(/\s+/g, '-');
  return v || null;
}

export function validateProduct(b: ProductIn): string | null {
  if (!b.title?.trim()) return 'Title is required';
  if (!b.categoryId) return 'Category is required';
  const vs = b.variants ?? [];
  if (!vs.length) return 'Add at least one variant';
  const skus = new Set<string>();
  const combos = new Set<string>();
  for (const v of vs) {
    if (!v.sku?.trim() || !v.color?.trim()) return 'Every variant needs SKU and colour';
    const sku = v.sku.trim().toUpperCase();
    if (skus.has(sku)) return `Duplicate SKU ${v.sku}`;
    skus.add(sku);
    const combo = `${v.color.trim().toLowerCase()}|${(v.size ?? '').trim().toLowerCase()}`;
    if (combos.has(combo)) return `Two variants have the same colour/size (${v.color} ${v.size ?? ''})`;
    combos.add(combo);
    if (!(Number(v.price) > 0)) return `Price missing for ${v.sku}`;
    if (v.salePrice && Number(v.salePrice) >= Number(v.price)) return `Sale price must be lower than price (${v.sku})`;
    if (b.stitchingType === 'STITCHED' && !v.size) return `Stitched products need a size on every variant (${v.sku})`;
    if (v.stock != null && (!Number.isFinite(Number(v.stock)) || Number(v.stock) < 0)) return `Stock can't be negative (${v.sku})`;
  }
  return null;
}

/**
 * Create/update a product with its images and variants in one transaction.
 * Stock for EXISTING variants is changed by delta (stock - stockLoaded), so orders placed while the
 * admin had the form open are not overwritten. Removed variants are archived (history kept), not deleted.
 */
export async function saveProduct(productId: number | null, b: ProductIn, by: string, txIn?: Tx) {
  const run = async (tx: Tx) => {
    const data = {
      code: normCode(b.code),
      title: b.title.trim(), description: b.description ?? '', fabric: b.fabric ?? '', piecesCount: Number(b.piecesCount ?? 3),
      stitchingType: b.stitchingType === 'STITCHED' ? 'STITCHED' : 'UNSTITCHED', occasion: b.occasion ?? '', tags: b.tags ?? '',
      status: PRODUCT_STATUSES.includes(b.status ?? '') ? b.status! : 'DRAFT', categoryId: Number(b.categoryId),
    };
    const p = productId ? await tx.product.update({ where: { id: productId }, data }) : await tx.product.create({ data });

    if (b.images) {
      await tx.productImage.deleteMany({ where: { productId: p.id } });
      const imgs = b.images.map((i) => (typeof i === 'string' ? { url: i } : i)).filter((i) => i.url);
      if (imgs.length)
        await tx.productImage.createMany({
          data: imgs.map((i, position) => ({ productId: p.id, url: i.url, color: i.color?.trim() || null, sourceUrl: i.sourceUrl ?? '', position })),
        });
    }

    const existing = await tx.variant.findMany({ where: { productId: p.id, archived: false } });
    const keep = new Set(b.variants.filter((v) => v.id).map((v) => Number(v.id)));
    for (const old of existing) {
      if (keep.has(old.id)) continue;
      await tx.cartItem.deleteMany({ where: { variantId: old.id } });
      await tx.variant.update({ where: { id: old.id }, data: { archived: true, active: false, sku: `${old.sku}~archived~${old.id}` } });
    }
    for (const v of b.variants) {
      const vd = {
        sku: v.sku.trim().toUpperCase(), color: v.color.trim(), size: data.stitchingType === 'STITCHED' ? (v.size?.trim() || null) : null,
        price: Math.round(Number(v.price)), salePrice: v.salePrice ? Math.round(Number(v.salePrice)) : null, active: v.active !== false,
      };
      if (v.id) {
        const old = existing.find((e) => e.id === Number(v.id));
        if (!old) throw Object.assign(new Error(`Variant ${v.sku} does not belong to this product`), { status: 400 });
        await tx.variant.update({ where: { id: old.id }, data: vd });
        if (v.stock != null && v.stockLoaded != null) {
          const delta = Math.round(Number(v.stock)) - Math.round(Number(v.stockLoaded));
          await changeStock(tx, old.id, delta, 'EDIT', { by, note: 'product form' });
        }
      } else {
        const created = await tx.variant.create({ data: { ...vd, productId: p.id, stock: 0 } });
        await changeStock(tx, created.id, Math.max(0, Math.round(Number(v.stock) || 0)), 'INITIAL', { by });
      }
    }
    return p;
  };
  return txIn ? run(txIn) : prisma.$transaction(run, { timeout: 30000 });
}

/** Delete = archive when there is history (orders / stock movements), so reports stay correct. */
export async function deleteProduct(productId: number) {
  return prisma.$transaction(async (tx) => {
    const variants = await tx.variant.findMany({ where: { productId } });
    const hasHistory = await tx.inventoryMovement.count({ where: { variantId: { in: variants.map((v) => v.id) }, reason: { notIn: ['INITIAL'] } } });
    if (!hasHistory) {
      await tx.product.delete({ where: { id: productId } });
      return { deleted: true };
    }
    for (const v of variants) {
      await tx.cartItem.deleteMany({ where: { variantId: v.id } });
      if (!v.archived) await tx.variant.update({ where: { id: v.id }, data: { archived: true, active: false, sku: `${v.sku}~archived~${v.id}` } });
    }
    const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    await tx.product.update({ where: { id: productId }, data: { status: 'ARCHIVED', code: p.code ? `${p.code}~archived~${p.id}` : null } });
    return { archived: true };
  });
}
