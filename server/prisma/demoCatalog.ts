// Demo catalog for testing on a server. Every demo product has a code starting with "DEMO-",
// so it can be removed in one go with `npm run demo:clear -w server`.
// Images are generated locally (no external image hosts needed) and stored like normal uploads (local or S3/R2).
import sharp from 'sharp';
import { prisma } from '../src/lib/db.js';
import { storeJpeg } from '../src/lib/images.js';
import { saveProduct, deleteProduct } from '../src/lib/catalog.js';

export const DEMO_PREFIX = 'DEMO-';

type V = { color: string; size?: string; price: number; sale?: number; stock: number };
type DemoProduct = {
  code: string; title: string; category: string; fabric: string; pieces: number; stitched: boolean;
  occasion: string; tags: string; description: string; status?: 'ACTIVE' | 'DRAFT'; variants: V[];
};

export const DEMO_CATEGORIES = ['Lawn', 'Cotton', 'Chiffon', 'Linen', 'Khaddar', 'Formal', 'Wedding', 'Kurtis', 'Eid Collection'];

// Colour name -> hex, used to paint the generated product photos.
const HEX: Record<string, string> = {
  Pink: '#e85d8a', Blue: '#3b6fd6', 'Mint Green': '#3fb68b', 'Sky Blue': '#5fb4e8', Yellow: '#f2c230', Indigo: '#3a3f9e',
  White: '#e9e6df', Peach: '#f4a582', 'Navy Blue': '#23325e', Maroon: '#7d1d2c', Black: '#2b2b2b', Grey: '#8a8f98',
  Beige: '#d8c3a0', Ivory: '#efe6cf', Emerald: '#1c7c54', Rust: '#b5532b', Olive: '#7a7a33', Camel: '#c19a6b',
  Charcoal: '#3c3f44', Teal: '#1f8a8a', Mustard: '#d4a017', 'Midnight Blue': '#1b2350', Wine: '#6b1f3a', Lilac: '#b39ddb',
  'Powder Pink': '#f3c1cf', Gold: '#c9a227', 'Bottle Green': '#145a32', Red: '#c0262d', 'Pearl White': '#f2efe8',
  Champagne: '#e8d5b0', Coral: '#ef7b62', 'Sea Green': '#2e9f86', Green: '#3f8f3f',
};

const S = ['S', 'M', 'L', 'XL'];
const sized = (colors: [string, number, number?][], sizes: string[], stock: (c: string, s: string) => number): V[] =>
  colors.flatMap(([color, price, sale]) => sizes.map((size) => ({ color, size, price, sale, stock: stock(color, size) })));

export const DEMO_PRODUCTS: DemoProduct[] = [
  // ---------- Lawn ----------
  { code: 'DEMO-MINT-BREEZE', title: 'Mint Breeze Lawn', category: 'Lawn', fabric: 'Lawn', pieces: 2, stitched: false, occasion: 'Casual',
    tags: 'mint,green,summer,embroidered,neckline', description: 'Embroidered lawn shirt 3m with dyed cambric trouser 2.5m. Soft, breathable summer wear.',
    variants: [{ color: 'Mint Green', price: 4200, stock: 10 }, { color: 'Sky Blue', price: 4200, stock: 6 }] },
  { code: 'DEMO-SUNFLOWER', title: 'Sunflower Printed Lawn', category: 'Lawn', fabric: 'Lawn', pieces: 3, stitched: true, occasion: 'Casual',
    tags: 'yellow,printed,floral,summer,ready to wear', description: 'Ready-to-wear printed lawn shirt, cambric trouser and voile dupatta.',
    variants: sized([['Yellow', 6500]], S, (_c, s) => (s === 'XL' ? 0 : 6)) },
  { code: 'DEMO-INDIGO-BLOCK', title: 'Indigo Block Print', category: 'Lawn', fabric: 'Lawn', pieces: 2, stitched: true, occasion: 'Casual',
    tags: 'block print,blue,indigo,office,daily', description: 'Hand block-printed lawn kurta with straight trouser. Office and daily wear.',
    variants: sized([['Indigo', 4800], ['White', 4800]], S, (c) => (c === 'White' ? 2 : 5)) },
  { code: 'DEMO-CHIKANKARI', title: 'Chikankari Lawn Shirt', category: 'Lawn', fabric: 'Lawn', pieces: 1, stitched: true, occasion: 'Casual',
    tags: 'chikankari,white,embroidered,kurta,shirt only', description: 'Single stitched chikankari lawn shirt. Pair with your own trouser or jeans.',
    variants: sized([['White', 3950], ['Peach', 3950, 3450]], S, () => 4) },

  // ---------- Cotton ----------
  { code: 'DEMO-COTTON-KURTA', title: 'Classic Cotton Kurta Set', category: 'Cotton', fabric: 'Cotton', pieces: 2, stitched: true, occasion: 'Casual',
    tags: 'daily wear,plain,office,cotton', description: 'Stitched cotton kurta with straight trouser. Perfect for office and daily wear.',
    variants: sized([['Navy Blue', 3900], ['Maroon', 3900], ['Black', 3900]], S, (c, s) => (c === 'Black' && s === 'S' ? 1 : 4)) },
  { code: 'DEMO-CAMBRIC-STRIPE', title: 'Striped Cambric Suit', category: 'Cotton', fabric: 'Cambric', pieces: 3, stitched: false, occasion: 'Casual',
    tags: 'stripes,cambric,grey,beige,daily', description: 'Unstitched striped cambric shirt, plain trouser and printed lawn dupatta.',
    variants: [{ color: 'Grey', price: 3600, stock: 12 }, { color: 'Beige', price: 3600, stock: 8 }] },

  // ---------- Chiffon ----------
  { code: 'DEMO-IVORY-CHIFFON', title: 'Ivory Chiffon Luxe', category: 'Chiffon', fabric: 'Chiffon', pieces: 3, stitched: false, occasion: 'Party',
    tags: 'embroidered,luxury,party,white,ivory', description: 'Embroidered chiffon front, sleeves and dupatta with raw silk trouser.',
    variants: [{ color: 'Ivory', price: 14500, stock: 4 }, { color: 'Black', price: 14500, stock: 2 }] },
  { code: 'DEMO-EMERALD-CHIFFON', title: 'Emerald Embroidered Chiffon', category: 'Chiffon', fabric: 'Chiffon', pieces: 3, stitched: true, occasion: 'Party',
    tags: 'green,emerald,embroidered,party,sequins', description: 'Stitched chiffon shirt with sequin embroidery, silk trouser and chiffon dupatta.',
    variants: sized([['Emerald', 18900, 16500]], ['S', 'M', 'L'], () => 3) },

  // ---------- Linen ----------
  { code: 'DEMO-AUTUMN-LINEN', title: 'Autumn Linen Print', category: 'Linen', fabric: 'Linen', pieces: 3, stitched: false, occasion: 'Casual',
    tags: 'autumn,printed,rust,olive,mid season', description: 'Unstitched printed linen shirt, dyed trouser and printed linen shawl.',
    variants: [{ color: 'Rust', price: 5900, stock: 7 }, { color: 'Olive', price: 5900, stock: 5 }] },
  { code: 'DEMO-PLAIN-LINEN', title: 'Plain Dyed Linen', category: 'Linen', fabric: 'Linen', pieces: 2, stitched: true, occasion: 'Casual',
    tags: 'plain,solid,office,camel,charcoal', description: 'Minimal stitched linen kurta with matching trouser.',
    variants: sized([['Camel', 4500], ['Charcoal', 4500]], S, () => 3) },

  // ---------- Khaddar ----------
  { code: 'DEMO-AJRAK-KHADDAR', title: 'Winter Ajrak Khaddar', category: 'Khaddar', fabric: 'Khaddar', pieces: 3, stitched: false, occasion: 'Casual',
    tags: 'winter,ajrak,warm,maroon,teal', description: 'Unstitched ajrak-print khaddar shirt and trouser with a warm khaddar shawl.',
    variants: [{ color: 'Maroon', price: 5200, stock: 9 }, { color: 'Teal', price: 5200, stock: 4 }] },
  { code: 'DEMO-KHADDAR-SHAWL', title: 'Embroidered Khaddar Shawl Suit', category: 'Khaddar', fabric: 'Khaddar', pieces: 3, stitched: true, occasion: 'Casual',
    tags: 'winter,shawl,embroidered,mustard', description: 'Stitched embroidered khaddar shirt, trouser and embroidered shawl.',
    variants: sized([['Mustard', 7800]], ['S', 'M', 'L'], (_c, s) => (s === 'M' ? 1 : 2)) },

  // ---------- Formal ----------
  { code: 'DEMO-VELVET-FORMAL', title: 'Velvet Evening Formal', category: 'Formal', fabric: 'Velvet', pieces: 3, stitched: true, occasion: 'Party',
    tags: 'velvet,winter wedding,evening,formal,embroidered', description: 'Stitched velvet shirt with zari embroidery, silk trouser and organza dupatta.',
    variants: sized([['Midnight Blue', 22000], ['Wine', 22000]], ['S', 'M', 'L'], () => 2) },
  { code: 'DEMO-ORGANZA-PASTEL', title: 'Organza Pastel Formal', category: 'Formal', fabric: 'Organza', pieces: 3, stitched: false, occasion: 'Party',
    tags: 'organza,pastel,lilac,pink,formal', description: 'Unstitched embroidered organza shirt, raw silk trouser and organza dupatta.',
    variants: [{ color: 'Lilac', price: 16800, stock: 3 }, { color: 'Powder Pink', price: 16800, stock: 5 }] },
  { code: 'DEMO-JAMAWAR-SILK', title: 'Silk Jamawar Suit', category: 'Formal', fabric: 'Silk', pieces: 3, stitched: false, occasion: 'Party',
    tags: 'jamawar,silk,gold,green,festive', description: 'Unstitched jamawar silk shirt, plain silk trouser and banarsi dupatta.',
    variants: [{ color: 'Gold', price: 12500, stock: 4 }, { color: 'Bottle Green', price: 12500, sale: 9900, stock: 3 }] },

  // ---------- Wedding ----------
  { code: 'DEMO-BRIDAL-LEHENGA', title: 'Maroon Bridal Lehenga', category: 'Wedding', fabric: 'Raw Silk', pieces: 3, stitched: true, occasion: 'Wedding',
    tags: 'bridal,barat,heavy,red,maroon,lehenga', description: 'Heavily hand-embellished raw silk choli, lehenga and net dupatta. Made to order on request.',
    variants: sized([['Maroon', 45000], ['Red', 45000]], ['S', 'M', 'L'], () => 1) },
  { code: 'DEMO-MEHNDI-GHARARA', title: 'Mehndi Yellow Gharara', category: 'Wedding', fabric: 'Cotton Silk', pieces: 3, stitched: true, occasion: 'Wedding',
    tags: 'mehndi,gharara,yellow,green,mayun', description: 'Short shirt with gota work, gharara and dyed dupatta for mehndi and mayun.',
    variants: sized([['Yellow', 28500], ['Green', 28500]], ['S', 'M', 'L'], () => 2) },
  { code: 'DEMO-WALIMA-MAXI', title: 'Walima Pearl Maxi', category: 'Wedding', fabric: 'Net', pieces: 3, stitched: true, occasion: 'Wedding',
    tags: 'walima,maxi,white,pearl,champagne', description: 'Pearl-embellished net maxi with silk inner, trouser and scalloped dupatta.',
    variants: sized([['Pearl White', 38000], ['Champagne', 38000]], ['S', 'M', 'L'], () => 1) },

  // ---------- Kurtis ----------
  { code: 'DEMO-PRINTED-KURTI', title: 'Everyday Printed Kurti', category: 'Kurtis', fabric: 'Cotton', pieces: 1, stitched: true, occasion: 'Casual',
    tags: 'kurti,printed,daily,university,budget', description: 'Single printed cotton kurti for everyday wear.',
    variants: sized([['Teal', 2490], ['Coral', 2490], ['Mustard', 2490]], ['XS', 'S', 'M', 'L', 'XL'], () => 6) },
  { code: 'DEMO-NECKLINE-KURTI', title: 'Embroidered Neckline Kurti', category: 'Kurtis', fabric: 'Lawn', pieces: 1, stitched: true, occasion: 'Casual',
    tags: 'kurti,embroidered,black,white,sale', description: 'Lawn kurti with embroidered neckline and sleeves.',
    variants: sized([['Black', 2990, 2490], ['White', 2990, 2490]], S, () => 5) },

  // ---------- Eid ----------
  { code: 'DEMO-EID-LAWN', title: 'Eid Festive Lawn', category: 'Eid Collection', fabric: 'Lawn', pieces: 3, stitched: false, occasion: 'Eid',
    tags: 'eid,festive,embroidered,pink,green', description: 'Unstitched embroidered lawn shirt with organza borders, dyed trouser and chiffon dupatta.',
    variants: [{ color: 'Pink', price: 6990, stock: 8 }, { color: 'Sea Green', price: 6990, stock: 6 }] },
  { code: 'DEMO-EID-CHIFFON', title: 'Eid Stitched Chiffon Set', category: 'Eid Collection', fabric: 'Chiffon', pieces: 3, stitched: true, occasion: 'Eid',
    tags: 'eid,chiffon,peach,lilac,ready to wear', description: 'Ready-to-wear embroidered chiffon shirt, trouser and dupatta.',
    variants: sized([['Peach', 11500], ['Lilac', 11500]], S, (c, s) => (c === 'Lilac' && s === 'XL' ? 0 : 3)) },

  // ---------- Draft (not visible in the bot until you set it Active) ----------
  { code: 'DEMO-NET-PREVIEW', title: 'Net Collection (coming soon)', category: 'Formal', fabric: 'Net', pieces: 3, stitched: false, occasion: 'Party',
    tags: 'net,coming soon', description: 'Draft product to show how unpublished items stay hidden from customers.', status: 'DRAFT',
    variants: [{ color: 'Black', price: 15000, stock: 5 }] },

  // Created last so it is the newest product and appears first in Lawn results (used by the automated flow test).
  { code: 'DEMO-ROSE-LAWN', title: 'Rose Lawn', category: 'Lawn', fabric: 'Lawn', pieces: 3, stitched: true, occasion: 'Casual',
    tags: 'floral,summer,printed,pink,blue', description: 'Printed lawn shirt, dyed cambric trouser, chiffon dupatta. Light and breathable for summer.',
    variants: sized([['Pink', 6500], ['Blue', 6500, 5800]], S, (c, s) => (c === 'Pink' && s === 'XL' ? 0 : c === 'Pink' ? 5 : 3)) },
];

// ---------------- Generated product photos ----------------

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `#${[n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function renderPhoto(p: DemoProduct, color: string): Promise<Buffer> {
  const c = HEX[color] ?? '#888888';
  const light = shade(c, 0.45), dark = shade(c, -0.35);
  const titleSize = p.title.length > 27 ? 32 : p.title.length > 21 ? 38 : 46;
  const sub = `${p.pieces}-Piece · ${p.stitched ? 'Stitched' : 'Unstitched'} · ${p.fabric}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${c}"/></linearGradient>
    <pattern id="motif" width="56" height="56" patternUnits="userSpaceOnUse">
      <circle cx="28" cy="28" r="6" fill="#fff" fill-opacity=".35"/><circle cx="0" cy="0" r="3" fill="#fff" fill-opacity=".25"/>
      <circle cx="56" cy="56" r="3" fill="#fff" fill-opacity=".25"/><path d="M28 14 L32 24 L28 22 L24 24 Z" fill="#fff" fill-opacity=".3"/>
    </pattern>
  </defs>
  <rect width="800" height="1000" fill="url(#bg)"/>
  <g transform="translate(0,10)">
    <path d="M300 120 L500 120 L560 150 L700 225 L660 345 L575 312 L600 760 L200 760 L225 312 L140 345 L100 225 L240 150 Z" fill="${c}" stroke="${dark}" stroke-width="6"/>
    <path d="M300 120 L500 120 L560 150 L700 225 L660 345 L575 312 L600 760 L200 760 L225 312 L140 345 L100 225 L240 150 Z" fill="url(#motif)"/>
    <path d="M345 120 L400 215 L455 120" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="8"/>
    <path d="M225 690 L575 690" stroke="#fff" stroke-opacity=".6" stroke-width="10" stroke-dasharray="4 14"/>
    ${p.pieces >= 3 ? `<path d="M610 160 C 720 300, 690 560, 740 790" fill="none" stroke="${shade(c, 0.25)}" stroke-width="46" stroke-linecap="round" opacity=".85"/>` : ''}
  </g>
  <rect x="40" y="800" width="720" height="160" rx="22" fill="#ffffff" fill-opacity=".93"/>
  <text x="70" y="858" font-family="Segoe UI, Arial, Helvetica, DejaVu Sans, sans-serif" font-size="${titleSize}" font-weight="700" fill="#1d2330">${esc(p.title)}</text>
  <text x="70" y="902" font-family="Segoe UI, Arial, Helvetica, DejaVu Sans, sans-serif" font-size="27" fill="#4b5563">${esc(sub)}</text>
  <circle cx="84" cy="932" r="13" fill="${c}" stroke="#1d2330" stroke-opacity=".2" stroke-width="2"/>
  <text x="106" y="941" font-family="Segoe UI, Arial, Helvetica, DejaVu Sans, sans-serif" font-size="25" fill="#374151">${esc(color)}</text>
  <rect x="40" y="36" width="120" height="44" rx="10" fill="#111827" fill-opacity=".75"/>
  <text x="100" y="66" text-anchor="middle" font-family="Segoe UI, Arial, Helvetica, DejaVu Sans, sans-serif" font-size="22" font-weight="700" fill="#fff">DEMO</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

// ---------------- Add / clear ----------------

export async function addDemoCatalog(log = console.log) {
  const cats: Record<string, number> = {};
  const existing = await prisma.category.findMany();
  for (const [i, name] of DEMO_CATEGORIES.entries()) {
    const found = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
    cats[name] = found?.id ?? (await prisma.category.create({
      data: { name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`, sortOrder: existing.length + i },
    })).id;
  }

  let added = 0, skipped = 0, sku = 0;
  for (const p of DEMO_PRODUCTS) {
    if (await prisma.product.findUnique({ where: { code: p.code } })) { skipped++; continue; }
    const colors = [...new Set(p.variants.map((v) => v.color))];
    // cover (first colour) + one tagged photo per colour when there are several colours
    const images = [{ url: await storeJpeg(await renderPhoto(p, colors[0]), 'demo'), color: null as string | null }];
    if (colors.length > 1) for (const c of colors) images.push({ url: await storeJpeg(await renderPhoto(p, c), 'demo'), color: c });
    const base = p.code.replace(DEMO_PREFIX, '');
    await saveProduct(null, {
      code: p.code, title: p.title, description: p.description, fabric: p.fabric, piecesCount: p.pieces,
      stitchingType: p.stitched ? 'STITCHED' : 'UNSTITCHED', occasion: p.occasion, tags: p.tags, status: p.status ?? 'ACTIVE',
      categoryId: cats[p.category], images,
      variants: p.variants.map((v) => ({
        sku: `D-${base}-${v.color.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}${v.size ? `-${v.size}` : ''}-${++sku}`,
        color: v.color, size: v.size ?? null, price: v.price, salePrice: v.sale ?? null, stock: v.stock,
      })),
    }, 'seed');
    added++;
  }
  log(`Demo catalog: ${added} products added, ${skipped} already existed (${DEMO_CATEGORIES.length} categories).`);
}

/** Removes demo products. Ones that already have orders are archived instead (keeps order history correct). */
export async function clearDemoCatalog(log = console.log) {
  const products = await prisma.product.findMany({ where: { code: { startsWith: DEMO_PREFIX } } });
  let deleted = 0, archived = 0;
  for (const p of products) {
    const hasOrders = await prisma.orderItem.count({ where: { variantId: { in: (await prisma.variant.findMany({ where: { productId: p.id } })).map((v) => v.id) } } });
    if (hasOrders) { await deleteProduct(p.id); archived++; }
    else { await prisma.product.delete({ where: { id: p.id } }); deleted++; }
  }
  // remove demo categories that are now empty
  const empty = await prisma.category.findMany({ where: { name: { in: DEMO_CATEGORIES }, products: { none: {} } } });
  await prisma.category.deleteMany({ where: { id: { in: empty.map((c) => c.id) } } });
  log(`Demo catalog removed: ${deleted} deleted, ${archived} archived (had orders), ${empty.length} empty categories removed.`);
}
