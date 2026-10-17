// End-to-end bot flow test against the real engine + DB (no WhatsApp, no AI).
// Run: npm run test:flow -w server
import 'dotenv/config';
import crypto from 'node:crypto';
import { prisma } from '../lib/db.js';
import { handleInbound } from '../bot/engine.js';

delete process.env.OPENAI_API_KEY; // deterministic path
const WA = `sim:flowtest-${Date.now()}`;
let lastId = 0;
let failures = 0;

async function send(input: { text?: string; replyId?: string }, wamid = `t.${crypto.randomUUID()}`) {
  await handleInbound({ waId: WA, name: 'Ayesha Khan', waMessageId: wamid, ...(input.replyId ? { kind: 'reply', replyId: input.replyId } : { kind: 'text', text: input.text }) });
  const c = await prisma.customer.findUnique({ where: { waId: WA }, include: { conversation: true } });
  const msgs = await prisma.message.findMany({ where: { conversationId: c!.conversation!.id, id: { gt: lastId }, direction: 'OUT' }, orderBy: { id: 'asc' } });
  if (msgs.length) lastId = msgs[msgs.length - 1].id;
  const outs = msgs.map((m) => JSON.parse(m.payloadJson));
  const ids = outs.flatMap((o: any) => o.buttons?.map((b: any) => b.id) ?? o.sections?.flatMap((s: any) => s.rows.map((r: any) => r.id)) ?? []);
  console.log(`\n> ${input.text ?? '[tap ' + input.replyId + ']'}  (state=${c!.conversation!.state})`);
  for (const m of msgs) console.log('  ' + m.body.replace(/\n/g, '\n  '));
  return { outs, ids, state: c!.conversation!.state, bodies: msgs.map((m) => m.body).join('\n') };
}
function expect(cond: boolean, label: string) {
  console.log(cond ? `  ✅ ${label}` : `  ❌ ${label}`);
  if (!cond) failures++;
}

async function main() {
  let r = await send({ text: 'Hi' });
  expect(r.ids.includes('browse'), 'welcome menu has Browse');

  r = await send({ replyId: 'browse' });
  const lawn = r.ids.find((i) => i.startsWith('cat:'))!;
  expect(!!lawn, 'category list shown');

  r = await send({ replyId: lawn });
  expect(r.ids.includes('st:STITCHED') && r.ids.includes('st:UNSTITCHED'), 'stitching asked (lawn has both)');

  r = await send({ replyId: 'st:STITCHED' });
  expect(r.ids.includes('size:M'), 'only sizes in stock offered');

  r = await send({ replyId: 'size:M' });
  const pid = r.ids.find((i) => i.startsWith('p:'))!;
  expect(!!pid, 'product cards shown');

  r = await send({ replyId: pid });
  const vid = r.ids.find((i) => i.startsWith('v:'))!;
  expect(!!vid && r.bodies.includes('M /'), 'variants filtered to size M');

  expect(r.outs.filter((o: any) => o.type === 'image').length >= 2 && r.bodies.includes('🎨'), 'one photo per colour shown');
  r = await send({ replyId: vid });
  expect(r.ids.some((i) => i.startsWith('q:')), 'quantity buttons');
  const chosen = await prisma.variant.findUnique({ where: { id: Number(vid.split(':')[1]) } });
  const colorImg = await prisma.productImage.findFirst({ where: { productId: chosen!.productId, color: chosen!.color } });
  expect(!!colorImg && r.outs[0]?.headerImage === colorImg.url, `quantity step shows the ${chosen!.color} photo`);

  // stale: tap a strict quantity button from this turn AFTER moving on
  const qBtn = r.ids.find((i) => i.startsWith('q:'))!;
  r = await send({ replyId: qBtn });
  expect(r.ids.includes('checkout'), 'added to cart, cart shown');
  const cartAfterFirst = await prisma.cartItem.findMany({ where: { customer: { waId: WA } } });

  r = await send({ replyId: qBtn });
  expect(r.bodies.includes('no longer current'), 'stale quantity tap rejected');
  const cartAfterStale = await prisma.cartItem.findMany({ where: { customer: { waId: WA } } });
  expect(cartAfterStale[0].quantity === cartAfterFirst[0].quantity, 'stale tap did NOT change cart');

  // duplicate webhook delivery
  const dup = `t.dup-${Date.now()}`;
  await send({ replyId: 'cart' }, dup);
  r = await send({ replyId: 'cart' }, dup);
  expect(r.outs.length === 0, 'duplicate wamid ignored');

  r = await send({ replyId: 'checkout' });
  expect(r.state === 'CHECKOUT_NAME', 'asks name');
  r = await send({ text: 'Ayesha Khan' });
  r = await send({ text: 'Lahore' });
  r = await send({ text: 'House 12, Street 4, DHA Phase 5' });
  expect(r.ids.includes('phone:wa'), 'phone step offers WhatsApp number');
  r = await send({ text: '0300 1234567' });
  expect(r.ids.includes('confirm') && r.bodies.includes('Lahore'), 'review shown with address');

  // typed "yes" must NOT place the order, and must not lose checkout progress
  r = await send({ text: 'yes' });
  expect((await prisma.order.count({ where: { customer: { waId: WA } } })) === 0, 'typed text did not place order');
  expect(r.state === 'CHECKOUT_REVIEW' && r.ids.includes('confirm'), 'review re-sent, progress kept');

  // question in the middle of the address step
  await send({ replyId: 'addr:new' }); await send({ text: 'Ayesha Khan' });
  r = await send({ text: 'delivery charges kitne hain?' });
  expect(r.state === 'CHECKOUT_CITY', 'question during city step re-asks the city');
  await send({ text: 'Lahore' }); await send({ text: 'House 12, Street 4, DHA Phase 5' });
  r = await send({ replyId: 'phone:wa' });
  const variantId = Number(vid.split(':')[1]);
  const stockBefore = (await prisma.variant.findUnique({ where: { id: variantId } }))!.stock;
  r = await send({ replyId: 'confirm' });
  const order = await prisma.order.findFirst({ where: { customer: { waId: WA } }, include: { items: true } });
  expect(!!order && r.bodies.includes(order.orderNo), 'order placed with order number');
  const stockAfter = (await prisma.variant.findUnique({ where: { id: variantId } }))!.stock;
  expect(stockAfter === stockBefore - 1, `stock decremented (${stockBefore} -> ${stockAfter})`);
  expect((await prisma.cartItem.count({ where: { customer: { waId: WA } } })) === 0, 'cart cleared');

  // double confirm
  r = await send({ replyId: 'confirm' });
  expect((await prisma.order.count({ where: { customer: { waId: WA } } })) === 1, 'second confirm tap did not create a second order');

  r = await send({ replyId: 'track' });
  expect(r.bodies.includes(order!.orderNo), 'tracking shows order');

  r = await send({ text: 'blue lawn' });
  expect(r.ids.some((i) => i.startsWith('p:')), 'keyword search fallback (no AI) finds products');

  r = await send({ text: 'shop address' });
  expect(r.bodies.includes('online store'), 'auto-reply rule fired');

  r = await send({ text: 'agent' });
  expect(r.bodies.includes('team member'), 'handoff message');
  r = await send({ text: 'hello?' });
  expect(r.outs.length === 0, 'bot silent while human has the chat');
  r = await send({ text: 'menu' });
  expect(r.ids.includes('browse'), '"menu" returns to bot');

  // >9 categories => paginated list
  const extra = await Promise.all(Array.from({ length: 9 }, (_, i) => prisma.category.create({ data: { name: `Test Cat ${i}`, slug: `test-cat-${Date.now()}-${i}` } })));
  const cat1 = (await prisma.product.findFirst({ where: { status: 'ACTIVE' }, include: { variants: true } }))!;
  const tmpProducts = await Promise.all(extra.map((c, i) => prisma.product.create({ data: { title: `Tmp ${i}`, categoryId: c.id, status: 'ACTIVE', variants: { create: [{ sku: `TMP-${Date.now()}-${i}`, color: 'Red', price: 100, stock: 1 }] } } })));
  r = await send({ replyId: 'browse' });
  expect(r.ids.includes('catpage:1') && r.ids.length === 10, 'categories paginated (8 + More + Main menu)');
  r = await send({ replyId: 'catpage:1' });
  expect(r.ids.some((i) => i.startsWith('cat:')) && r.ids.some((i) => i.startsWith('catpage:')), 'second page of categories');
  await prisma.product.deleteMany({ where: { id: { in: tmpProducts.map((p) => p.id) } } });
  await prisma.category.deleteMany({ where: { id: { in: extra.map((c) => c.id) } } });
  void cat1;

  // cleanup test order + restore stock
  if (order) {
    await prisma.variant.update({ where: { id: variantId }, data: { stock: { increment: 1 } } });
    await prisma.inventoryMovement.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
  }
  await prisma.customer.delete({ where: { waId: WA } });

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
}

main();
