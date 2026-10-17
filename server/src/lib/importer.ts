import ExcelJS from 'exceljs';
import { prisma } from './db.js';
import { changeStock, setStock } from './inventory.js';
import { importFromUrl } from './images.js';
import { normCode } from './catalog.js';
import { absoluteUrl } from '../bot/whatsapp.js';

// Spreadsheet format: ONE ROW PER SKU (colour/size). Rows with the same product_code form one product.
export const COLUMNS = [
  { key: 'product_code', label: 'product_code', required: true, help: 'Same code on every row of one product, e.g. ROSE-LAWN' },
  { key: 'title', label: 'title', requiredNew: true, help: 'Product name' },
  { key: 'category', label: 'category', requiredNew: true, help: 'Created automatically if it does not exist' },
  { key: 'stitching', label: 'stitching', help: 'Stitched or Unstitched (default Unstitched)' },
  { key: 'fabric', label: 'fabric', help: 'Lawn, Chiffon, Cotton…' },
  { key: 'pieces', label: 'pieces', help: '2 or 3' },
  { key: 'occasion', label: 'occasion', help: 'Casual, Party, Wedding…' },
  { key: 'description', label: 'description', help: 'Shown to customers' },
  { key: 'tags', label: 'tags', help: 'Search keywords, comma separated' },
  { key: 'status', label: 'status', help: 'Active, Draft or Hidden (default Active)' },
  { key: 'sku', label: 'sku', required: true, help: 'Unique per row' },
  { key: 'color', label: 'color', requiredNew: true, help: 'Colour name' },
  { key: 'size', label: 'size', help: 'Required for stitched (S, M, L, XL). Empty for unstitched' },
  { key: 'price', label: 'price', requiredNew: true, help: 'Whole number, no commas needed' },
  { key: 'sale_price', label: 'sale_price', help: 'Optional, must be lower than price' },
  { key: 'stock', label: 'stock', help: 'Empty = leave unchanged' },
  { key: 'images', label: 'images', help: 'Product photo links separated by | (only needed on one row). First = cover' },
  { key: 'color_images', label: 'color_images', help: 'Photo links for THIS colour, separated by |' },
] as const;
type Key = (typeof COLUMNS)[number]['key'];
type Row = Record<Key, string> & { _row: number };

// ---------------- Parsing ----------------

function cellText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r: any) => r.text).join('');
    if ('text' in v) return String(v.text); // hyperlink
    if ('result' in v) return cellText(v.result); // formula
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[\s\-]+/g, '_').replace(/colour/g, 'color').replace(/[^a-z_]/g, '');

export async function parseSheet(buf: Buffer, filename: string): Promise<{ rows: Row[]; unknownHeaders: string[] }> {
  let grid: string[][];
  if (/\.xlsx$/i.test(filename) || buf.subarray(0, 2).toString() === 'PK') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets.find((w) => w.name.toLowerCase() !== 'instructions') ?? wb.worksheets[0];
    grid = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      for (let c = 1; c <= r.cellCount; c++) vals.push(cellText(r.getCell(c).value).trim());
      grid.push(vals);
    });
  } else if (/\.xls$/i.test(filename)) {
    throw Object.assign(new Error('Old .xls format is not supported. In Excel use "Save As" → .xlsx or .csv'), { status: 400 });
  } else {
    grid = parseCsv(buf.toString('utf8'));
  }
  if (!grid.length) throw Object.assign(new Error('The file is empty'), { status: 400 });
  const headers = grid[0].map((h) => normHeader(h));
  const known = new Set<string>(COLUMNS.map((c) => c.key));
  const missing = COLUMNS.filter((c) => (c as any).required && !headers.includes(c.key)).map((c) => c.key);
  if (missing.length) throw Object.assign(new Error(`Missing column(s): ${missing.join(', ')}. Download the template to see the format.`), { status: 400 });
  const rows: Row[] = [];
  grid.slice(1).forEach((vals, i) => {
    if (vals.every((v) => !String(v ?? '').trim())) return;
    const r = { _row: i + 2 } as Row;
    for (const c of COLUMNS) r[c.key] = '';
    headers.forEach((h, j) => { if (known.has(h)) (r as any)[h] = String(vals[j] ?? '').trim(); });
    rows.push(r);
  });
  return { rows, unknownHeaders: grid[0].filter((_, j) => headers[j] && !known.has(headers[j])) };
}

// ---------------- Plan (validation / dry run) ----------------

const splitUrls = (s: string) => s.split(/[|\n]+/).map((u) => u.trim()).filter(Boolean);
const num = (s: string) => Number(s.replace(/[, ]|PKR|Rs\.?/gi, ''));

type PlanVariant = { row: number; sku: string; color: string; size: string | null; price?: number; salePrice: number | null | undefined; stock?: number; existingId?: number; colorImages: string[] };
type PlanProduct = {
  code: string; existingId?: number; title: string; category: string; stitching: 'STITCHED' | 'UNSTITCHED'; fabric: string; pieces: number;
  occasion: string; description: string; tags: string; status: string; images: string[]; variants: PlanVariant[];
};
export type ImportPlan = {
  products: PlanProduct[];
  errors: { row: number; message: string }[];
  warnings: string[];
  summary: { productsNew: number; productsUpdated: number; variantsNew: number; variantsUpdated: number; imageLinks: number; newCategories: string[] };
};

export async function planImport(rows: Row[]): Promise<ImportPlan> {
  const errors: ImportPlan['errors'] = [];
  const warnings: string[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const code = normCode(r.product_code);
    if (!code) { errors.push({ row: r._row, message: 'product_code is empty' }); continue; }
    groups.set(code, [...(groups.get(code) ?? []), r]);
  }
  const seenSku = new Map<string, number>();
  const cats = await prisma.category.findMany();
  const newCategories = new Set<string>();
  const products: PlanProduct[] = [];

  for (const [code, rs] of groups) {
    const first = (k: Key) => rs.find((r) => r[k])?.[k] ?? '';
    const existing = await prisma.product.findUnique({ where: { code }, include: { variants: { where: { archived: false } } } });
    const stitchRaw = first('stitching').toLowerCase();
    const stitching = stitchRaw ? (stitchRaw.startsWith('st') ? 'STITCHED' : stitchRaw.startsWith('un') ? 'UNSTITCHED' : null) : (existing?.stitchingType as any) ?? 'UNSTITCHED';
    if (!stitching) errors.push({ row: rs[0]._row, message: `stitching must be Stitched or Unstitched (got "${first('stitching')}")` });
    const statusRaw = first('status').toUpperCase();
    const status = statusRaw ? (['ACTIVE', 'DRAFT', 'HIDDEN'].includes(statusRaw) ? statusRaw : null) : existing?.status ?? 'ACTIVE';
    if (!status) errors.push({ row: rs[0]._row, message: `status must be Active, Draft or Hidden (got "${first('status')}")` });
    const title = first('title') || existing?.title || '';
    if (!title) errors.push({ row: rs[0]._row, message: `${code}: title is required` });
    const category = first('category');
    if (!category && !existing) errors.push({ row: rs[0]._row, message: `${code}: category is required` });
    if (category && !cats.some((c) => c.name.toLowerCase() === category.toLowerCase())) newCategories.add(category);
    const piecesRaw = first('pieces');
    const pieces = piecesRaw ? num(piecesRaw) : existing?.piecesCount ?? 3;
    if (!Number.isInteger(pieces) || pieces < 1 || pieces > 10) errors.push({ row: rs[0]._row, message: `pieces must be a number (got "${piecesRaw}")` });

    const variants: PlanVariant[] = [];
    const combos = new Set<string>();
    for (const r of rs) {
      const sku = r.sku.toUpperCase().trim();
      if (!sku) { errors.push({ row: r._row, message: 'sku is empty' }); continue; }
      if (seenSku.has(sku)) { errors.push({ row: r._row, message: `SKU ${sku} also used on row ${seenSku.get(sku)}` }); continue; }
      seenSku.set(sku, r._row);
      const ex = existing?.variants.find((v) => v.sku === sku);
      const color = r.color || ex?.color || '';
      if (!color) errors.push({ row: r._row, message: `${sku}: color is empty` });
      const size = stitching === 'STITCHED' ? (r.size.toUpperCase() || ex?.size || null) : null;
      if (stitching === 'STITCHED' && !size) errors.push({ row: r._row, message: `${sku}: size is required for stitched products` });
      if (stitching === 'UNSTITCHED' && r.size) warnings.push(`Row ${r._row}: size "${r.size}" ignored (product is unstitched)`);
      const combo = `${color.toLowerCase()}|${size ?? ''}`;
      if (color && combos.has(combo)) errors.push({ row: r._row, message: `${code}: colour/size ${color} ${size ?? ''} appears twice` });
      combos.add(combo);

      if (!ex) {
        const other = await prisma.variant.findUnique({ where: { sku } });
        if (other) errors.push({ row: r._row, message: `SKU ${sku} already belongs to another product` });
      }
      const price = r.price ? num(r.price) : ex?.price;
      if (!price || !Number.isFinite(price) || price <= 0) errors.push({ row: r._row, message: `${sku}: price is missing or invalid ("${r.price}")` });
      const salePrice = r.sale_price ? num(r.sale_price) : ex ? ex.salePrice : null;
      if (salePrice != null && (!Number.isFinite(salePrice) || (price && salePrice >= price))) errors.push({ row: r._row, message: `${sku}: sale_price must be lower than price` });
      const stock = r.stock ? num(r.stock) : undefined;
      if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) errors.push({ row: r._row, message: `${sku}: stock must be a whole number ≥ 0 ("${r.stock}")` });
      variants.push({ row: r._row, sku, color, size, price, salePrice, stock, existingId: ex?.id, colorImages: splitUrls(r.color_images) });
    }
    if (existing) {
      const missing = existing.variants.filter((v) => !variants.some((p) => p.existingId === v.id));
      if (missing.length) warnings.push(`${code}: ${missing.length} existing SKU(s) not in the file were left unchanged (${missing.slice(0, 5).map((m) => m.sku).join(', ')}${missing.length > 5 ? '…' : ''})`);
    }
    const images = [...new Set(rs.flatMap((r) => splitUrls(r.images)))];
    if (!existing && !images.length && !variants.some((v) => v.colorImages.length)) warnings.push(`${code}: no images — product cards will show text only`);
    products.push({
      code, existingId: existing?.id, title, category: category || '', stitching: (stitching ?? 'UNSTITCHED') as any,
      fabric: first('fabric') || existing?.fabric || '', pieces, occasion: first('occasion') || existing?.occasion || '',
      description: first('description') || existing?.description || '', tags: first('tags') || existing?.tags || '',
      status: status ?? 'ACTIVE', images, variants,
    });
  }

  return {
    products, errors, warnings,
    summary: {
      productsNew: products.filter((p) => !p.existingId).length,
      productsUpdated: products.filter((p) => p.existingId).length,
      variantsNew: products.reduce((s, p) => s + p.variants.filter((v) => !v.existingId).length, 0),
      variantsUpdated: products.reduce((s, p) => s + p.variants.filter((v) => v.existingId).length, 0),
      imageLinks: new Set(products.flatMap((p) => [...p.images, ...p.variants.flatMap((v) => v.colorImages)])).size,
      newCategories: [...newCategories],
    },
  };
}

// ---------------- Apply ----------------

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  }));
  return out;
}

export async function applyImport(plan: ImportPlan, opts: { stockMode: 'set' | 'add'; by: string }) {
  if (plan.errors.length) throw Object.assign(new Error('Fix the errors first'), { status: 400 });
  const warnings = [...plan.warnings];

  // 1) Download & convert images BEFORE touching the DB (slow network work outside the transaction).
  const existingImgs = await prisma.productImage.findMany({ where: { productId: { in: plan.products.map((p) => p.existingId!).filter(Boolean) } } });
  const known = new Map<string, string>();
  for (const im of existingImgs) {
    if (im.sourceUrl) known.set(im.sourceUrl, im.url);
    known.set(im.url, im.url);
    known.set(absoluteUrl(im.url), im.url);
  }
  const allLinks = [...new Set(plan.products.flatMap((p) => [...p.images, ...p.variants.flatMap((v) => v.colorImages)]))].filter((u) => !known.has(u));
  const stored = new Map<string, string>();
  await mapLimit(allLinks, 4, async (link) => {
    try { stored.set(link, await importFromUrl(link)); } catch (e: any) { warnings.push(`Image skipped: ${e.message}`); }
  });
  const resolve = (u: string) => known.get(u) ?? stored.get(u);

  // 2) All database changes in one transaction: either everything is imported or nothing.
  await prisma.$transaction(async (tx) => {
    for (const p of plan.products) {
      let categoryId: number | undefined;
      if (p.category) {
        const all = await tx.category.findMany();
        const c = all.find((x) => x.name.toLowerCase() === p.category.toLowerCase())
          ?? await tx.category.create({ data: { name: p.category, slug: `${p.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`, sortOrder: all.length } });
        categoryId = c.id;
      }
      const data = {
        title: p.title, fabric: p.fabric, piecesCount: p.pieces, stitchingType: p.stitching, occasion: p.occasion,
        description: p.description, tags: p.tags, status: p.status, ...(categoryId ? { categoryId } : {}),
      };
      const prod = p.existingId
        ? await tx.product.update({ where: { id: p.existingId }, data })
        : await tx.product.create({ data: { ...data, code: p.code, categoryId: categoryId! } });

      // images: replace general images if the file lists any; replace a colour's images if that row lists any
      const colorSets = new Map<string, { color: string; urls: string[] }>();
      for (const v of p.variants) if (v.colorImages.length) colorSets.set(v.color.toLowerCase(), { color: v.color, urls: v.colorImages });
      if (p.images.length || colorSets.size) {
        const current = await tx.productImage.findMany({ where: { productId: prod.id }, orderBy: { position: 'asc' } });
        type Im = { url: string | undefined; sourceUrl: string; color: string | null };
        const general: Im[] = p.images.length
          ? p.images.map((u) => ({ url: resolve(u), sourceUrl: u, color: null }))
          : current.filter((im) => !im.color).map((im) => ({ url: im.url, sourceUrl: im.sourceUrl, color: null }));
        const keptColored: Im[] = current
          .filter((im) => im.color && !colorSets.has(im.color.toLowerCase()))
          .map((im) => ({ url: im.url, sourceUrl: im.sourceUrl, color: im.color }));
        const newColored: Im[] = [...colorSets.values()].flatMap(({ color, urls }) => urls.map((u) => ({ url: resolve(u), sourceUrl: u, color })));
        const finalList = [...general, ...keptColored, ...newColored].filter((im) => im.url);
        await tx.productImage.deleteMany({ where: { productId: prod.id } });
        if (finalList.length)
          await tx.productImage.createMany({ data: finalList.map((im, position) => ({ productId: prod.id, url: im.url!, sourceUrl: im.sourceUrl, color: im.color, position })) });
      }

      for (const v of p.variants) {
        const vd = { color: v.color, size: v.size, ...(v.price ? { price: Math.round(v.price) } : {}), salePrice: v.salePrice ?? null, active: true };
        if (v.existingId) {
          await tx.variant.update({ where: { id: v.existingId }, data: vd });
          if (v.stock !== undefined) {
            if (opts.stockMode === 'add') await changeStock(tx, v.existingId, v.stock, 'IMPORT', { by: opts.by, note: 'import (add)' });
            else await setStock(tx, v.existingId, v.stock, 'IMPORT', { by: opts.by, note: 'import (set)' });
          }
        } else {
          const created = await tx.variant.create({ data: { ...vd, price: Math.round(v.price!), sku: v.sku, productId: prod.id, stock: 0 } });
          await changeStock(tx, created.id, v.stock ?? 0, 'IMPORT', { by: opts.by, note: 'import (new)' });
        }
      }
    }
  }, { timeout: 120000, maxWait: 10000 });

  return { ok: true, summary: plan.summary, warnings, imagesDownloaded: stored.size };
}

// ---------------- Export ----------------

export async function exportRows(template = false) {
  if (template) {
    return [
      { product_code: 'ROSE-LAWN', title: 'Rose Lawn', category: 'Lawn', stitching: 'Stitched', fabric: 'Lawn', pieces: '3', occasion: 'Casual', description: 'Printed lawn shirt, cambric trouser, chiffon dupatta', tags: 'floral,summer', status: 'Active', sku: 'ROSE-PINK-S', color: 'Pink', size: 'S', price: '6500', sale_price: '', stock: '5', images: 'https://example.com/rose-front.jpg | https://example.com/rose-detail.jpg', color_images: 'https://example.com/rose-pink.jpg' },
      { product_code: 'ROSE-LAWN', title: '', category: '', stitching: '', fabric: '', pieces: '', occasion: '', description: '', tags: '', status: '', sku: 'ROSE-PINK-M', color: 'Pink', size: 'M', price: '6500', sale_price: '', stock: '8', images: '', color_images: '' },
      { product_code: 'ROSE-LAWN', title: '', category: '', stitching: '', fabric: '', pieces: '', occasion: '', description: '', tags: '', status: '', sku: 'ROSE-BLUE-M', color: 'Blue', size: 'M', price: '6500', sale_price: '5800', stock: '3', images: '', color_images: 'https://example.com/rose-blue.jpg' },
      { product_code: 'MINT-UNST', title: 'Mint Breeze Lawn', category: 'Lawn', stitching: 'Unstitched', fabric: 'Lawn', pieces: '2', occasion: 'Casual', description: 'Embroidered shirt 3m + trouser 2.5m', tags: 'mint,embroidered', status: 'Active', sku: 'MINT-GREEN', color: 'Mint Green', size: '', price: '4200', sale_price: '', stock: '10', images: 'https://example.com/mint.jpg', color_images: '' },
    ];
  }
  const products = await prisma.product.findMany({
    where: { status: { not: 'ARCHIVED' } },
    include: { category: true, images: { orderBy: { position: 'asc' } }, variants: { where: { archived: false }, orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  });
  const rows: Record<string, string>[] = [];
  for (const p of products) {
    let code = p.code;
    if (!code) {
      code = `P${p.id}`;
      await prisma.product.update({ where: { id: p.id }, data: { code } }).catch(() => undefined);
    }
    const general = p.images.filter((i) => !i.color).map((i) => absoluteUrl(i.url)).join(' | ');
    p.variants.forEach((v, n) => {
      rows.push({
        product_code: code!, title: p.title, category: p.category.name, stitching: p.stitchingType === 'STITCHED' ? 'Stitched' : 'Unstitched',
        fabric: p.fabric, pieces: String(p.piecesCount), occasion: p.occasion, description: p.description, tags: p.tags,
        status: p.status[0] + p.status.slice(1).toLowerCase(), sku: v.sku, color: v.color, size: v.size ?? '', price: String(v.price),
        sale_price: v.salePrice ? String(v.salePrice) : '', stock: String(v.stock), images: n === 0 ? general : '',
        color_images: p.images.filter((i) => i.color && i.color.toLowerCase() === v.color.toLowerCase()).map((i) => absoluteUrl(i.url)).join(' | '),
      });
    });
  }
  return rows;
}

export function toCsv(rows: Record<string, string>[]) {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [COLUMNS.map((c) => c.key).join(','), ...rows.map((r) => COLUMNS.map((c) => esc(r[c.key] ?? '')).join(','))].join('\r\n');
}

export async function toXlsx(rows: Record<string, string>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.key, key: c.key, width: c.key === 'description' || c.key.includes('images') ? 40 : Math.max(12, c.key.length + 4) }));
  rows.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
  // keep price/stock/sku as text-friendly but numbers where numeric
  const help = wb.addWorksheet('Instructions');
  help.columns = [{ header: 'column', key: 'k', width: 16 }, { header: 'required', key: 'r', width: 10 }, { header: 'how to fill', key: 'h', width: 90 }];
  COLUMNS.forEach((c) => help.addRow({ k: c.key, r: (c as any).required ? 'always' : (c as any).requiredNew ? 'new items' : '', h: c.help }));
  help.addRow({});
  help.addRow({ h: 'One row per SKU (each colour/size). Rows with the same product_code are one product; product details only need to be on the first row.' });
  help.addRow({ h: 'Re-importing updates products by product_code and variants by sku. SKUs not in the file are left unchanged (not deleted).' });
  help.addRow({ h: 'Image links must be public (Google Drive: "Anyone with the link"). They are downloaded and optimised automatically.' });
  help.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
