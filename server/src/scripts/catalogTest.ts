// Inventory + import regression test (no network needed). Run: npm run test:catalog -w server
import 'dotenv/config';
import { prisma } from '../lib/db.js';
import { saveProduct, deleteProduct } from '../lib/catalog.js';
import { adjust } from '../lib/inventory.js';
import { parseSheet, planImport, applyImport, exportRows, toXlsx } from '../lib/importer.js';

let failures = 0;
const expect = (c: boolean, label: string) => { console.log(c ? `  ✅ ${label}` : `  ❌ ${label}`); if (!c) failures++; };
const T = Date.now().toString(36).toUpperCase();
const csv = (s: string) => Buffer.from(s.trim() + '\n');

async function main() {
  const cat = await prisma.category.create({ data: { name: `Test ${T}`, slug: `t-${T}` } });

  console.log('Stock is never overwritten by a stale form');
  const p = await saveProduct(null, {
    code: `T-${T}`, title: 'Test suit', categoryId: cat.id, stitchingType: 'UNSTITCHED', status: 'ACTIVE',
    variants: [{ sku: `T-${T}-RED`, color: 'Red', price: 1000, stock: 10 }],
  }, 'test');
  const v = (await prisma.variant.findFirst({ where: { productId: p.id } }))!;
  const formLoadedStock = v.stock; // admin opens the form: 10
  await prisma.variant.update({ where: { id: v.id }, data: { stock: { decrement: 3 } } }); // 3 sold meanwhile -> 7
  await saveProduct(p.id, {
    code: `T-${T}`, title: 'Test suit', categoryId: cat.id, stitchingType: 'UNSTITCHED', status: 'ACTIVE',
    variants: [{ id: v.id, sku: v.sku, color: 'Red', price: 1000, stock: formLoadedStock + 5, stockLoaded: formLoadedStock }], // admin adds 5
  }, 'test');
  expect((await prisma.variant.findUnique({ where: { id: v.id } }))!.stock === 12, 'stock = 10 - 3 sold + 5 added = 12');

  console.log('Adjustments');
  await adjust(v.id, 'remove', 20, 'test', 'test');
  expect((await prisma.variant.findUnique({ where: { id: v.id } }))!.stock === 0, 'remove more than available stops at 0');
  await adjust(v.id, 'set', 9, 'count', 'test');
  const mv = await prisma.inventoryMovement.findMany({ where: { variantId: v.id }, orderBy: { id: 'asc' } });
  expect(mv.map((m) => m.reason).join(',') === 'INITIAL,EDIT,ADJUST,COUNT' && mv.at(-1)!.stockAfter === 9, 'every change is logged with stock-after');

  console.log('Import');
  const file1 = csv(`
product_code,title,category,stitching,sku,color,size,price,sale_price,stock
T-${T},,,,T-${T}-RED,Red,,1200,,4
T2-${T},Second suit,Test ${T},Stitched,T2-${T}-S,Blue,S,"2,500",2000,3
T2-${T},,,,T2-${T}-M,Blue,M,2500,,6`);
  const { rows } = await parseSheet(file1, 'x.csv');
  const plan = await planImport(rows);
  expect(plan.errors.length === 0 && plan.summary.productsNew === 1 && plan.summary.productsUpdated === 1, 'plan: 1 new + 1 updated, no errors');
  await applyImport(plan, { stockMode: 'set', by: 'test' });
  const red = (await prisma.variant.findUnique({ where: { id: v.id } }))!;
  expect(red.price === 1200 && red.stock === 4, 'existing SKU updated (price 1200, stock set to 4)');
  const t2 = await prisma.product.findUnique({ where: { code: `T2-${T}` }, include: { variants: true } });
  expect(!!t2 && t2.variants.length === 2 && t2.stitchingType === 'STITCHED' && t2.variants.some((x) => x.price === 2500 && x.salePrice === 2000), 'new product with 2 sizes, "2,500" parsed');

  const add = await planImport((await parseSheet(csv(`product_code,sku,stock\nT2-${T},T2-${T}-M,4`), 'a.csv')).rows);
  await applyImport(add, { stockMode: 'add', by: 'test' });
  expect((await prisma.variant.findUnique({ where: { sku: `T2-${T}-M` } }))!.stock === 10, 'stock-only file in "add" mode: 6 + 4 = 10');

  const bad = await planImport((await parseSheet(csv(`product_code,title,category,stitching,sku,color,size,price,stock\nT3-${T},Bad,Test ${T},Stitched,T2-${T}-S,Red,,0,-1`), 'b.csv')).rows);
  expect(bad.errors.length >= 3, `bad rows rejected (${bad.errors.length} errors: SKU taken, size, price, stock)`);

  const xlsx = await toXlsx(await exportRows());
  const round = await planImport((await parseSheet(xlsx, 'r.xlsx')).rows);
  expect(round.errors.length === 0 && round.summary.productsNew === 0, 'exported Excel re-imports cleanly (updates only)');

  console.log('Delete keeps history');
  const r = await deleteProduct(p.id);
  const after = await prisma.product.findUnique({ where: { id: p.id } });
  expect(!!r.archived && after?.status === 'ARCHIVED' && (await prisma.inventoryMovement.count({ where: { variantId: v.id } })) > 0, 'product with history archived, movements kept');

  // cleanup
  const ids = (await prisma.product.findMany({ where: { categoryId: cat.id } })).map((x) => x.id);
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  await prisma.category.delete({ where: { id: cat.id } });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll catalog checks passed ✅');
  process.exit(failures ? 1 : 0);
}
main();
