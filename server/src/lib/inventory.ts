import { Prisma } from '@prisma/client';
import { prisma } from './db.js';

type Tx = Prisma.TransactionClient;
export type StockReason = 'ORDER' | 'CANCEL' | 'ADJUST' | 'EDIT' | 'IMPORT' | 'COUNT' | 'INITIAL';

/**
 * The ONLY way stock should change. Uses an atomic increment (never "read then write"), so an order placed
 * at the same moment is never lost. Stock can't go below 0. Every change is written to InventoryMovement.
 */
export async function changeStock(
  tx: Tx, variantId: number, delta: number, reason: StockReason,
  meta: { note?: string; by?: string; orderId?: number } = {},
) {
  if (!delta) return null;
  let v = await tx.variant.update({ where: { id: variantId }, data: { stock: { increment: delta } } });
  let applied = delta;
  if (v.stock < 0) {
    applied = delta - v.stock; // only remove what was there
    v = await tx.variant.update({ where: { id: variantId }, data: { stock: 0 } });
  }
  if (applied) {
    await tx.inventoryMovement.create({
      data: { variantId, delta: applied, reason, note: meta.note ?? '', by: meta.by ?? '', orderId: meta.orderId, stockAfter: v.stock },
    });
  }
  return v;
}

/** Physical count: set stock to an exact number (records the difference). */
export async function setStock(tx: Tx, variantId: number, qty: number, reason: StockReason, meta: { note?: string; by?: string } = {}) {
  const v = await tx.variant.findUniqueOrThrow({ where: { id: variantId } });
  return changeStock(tx, variantId, Math.max(0, Math.round(qty)) - v.stock, reason, meta) ?? v;
}

export async function adjust(variantId: number, mode: 'add' | 'remove' | 'set', qty: number, note: string, by: string) {
  if (!Number.isFinite(qty) || qty < 0) throw Object.assign(new Error('Quantity must be 0 or more'), { status: 400 });
  return prisma.$transaction((tx) =>
    mode === 'set' ? setStock(tx, variantId, qty, 'COUNT', { note, by })
      : changeStock(tx, variantId, mode === 'add' ? qty : -qty, 'ADJUST', { note, by }),
  );
}
