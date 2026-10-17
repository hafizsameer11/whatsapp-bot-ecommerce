import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db.js';
import { DEFAULT_SETTINGS, DEFAULT_TEXTS } from '../src/lib/defaults.js';
import { addDemoCatalog, clearDemoCatalog } from './demoCatalog.js';


async function main() {
  // Settings & texts: insert missing keys only (never overwrite admin edits)
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  for (const [key, v] of Object.entries(DEFAULT_TEXTS)) {
    await prisma.botText.upsert({ where: { key }, update: {}, create: { key, text: v.text, description: v.description } });
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase().trim();
  if (!(await prisma.adminUser.findUnique({ where: { email } }))) {
    await prisma.adminUser.create({
      data: {
        email,
        name: 'Owner',
        role: 'OWNER',
        passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10),
      },
    });
    console.log(`Admin created: ${email}`);
  }

  // ---- Bot menus, auto-reply and FAQ: only when those tables are empty (never overwrite your edits) ----
  if ((await prisma.mainMenuItem.count()) === 0 && (await prisma.customMenu.count()) === 0) {
  const help = await prisma.customMenu.create({
    data: {
      title: 'Help & Info',
      body: 'What would you like to know?',
      buttonText: 'Help topics',
      items: {
        create: [
          { label: 'Size guide', description: 'Find your perfect fit', sortOrder: 0,
            action: 'TEXT:📏 *Size guide* (chest / length, inches)\nS: 36 / 40\nM: 38 / 41\nL: 40 / 42\nXL: 43 / 43' },
          { label: 'Delivery info', description: 'Charges & delivery time', sortOrder: 1,
            action: 'TEXT:🚚 Delivery in 3-5 working days all over Pakistan. PKR 250 delivery, free above PKR 10,000.' },
          { label: 'Exchange policy', description: 'Size & exchange', sortOrder: 2,
            action: 'TEXT:🔄 Exchange within 7 days if the item is unused with tags. Contact us with your order number.' },
          { label: 'My cart', description: 'See items in your cart', sortOrder: 3, action: 'CART' },
          { label: 'Talk to agent', description: 'Chat with our team', sortOrder: 4, action: 'HUMAN' },
        ],
      },
    },
  });

  await prisma.mainMenuItem.createMany({
    data: [
      { label: 'Browse Suits', action: 'BROWSE', sortOrder: 0, description: 'See our collections' },
      { label: 'Track Order', action: 'TRACK', sortOrder: 1, description: 'Check your order status' },
      { label: 'Help', action: `MENU:${help.id}`, sortOrder: 2, description: 'Sizes, delivery, agent' },
    ],
  });
    console.log('Bot menus seeded.');
  }

  if ((await prisma.autoReply.count()) === 0) {
  await prisma.autoReply.create({
    data: {
      keywords: 'shop address,location,outlet',
      response: 'We are an online store 🛍️ We deliver all over Pakistan with Cash on Delivery.',
      action: 'BROWSE',
    },
  });
  }

  if ((await prisma.knowledgeEntry.count()) === 0) {
  await prisma.knowledgeEntry.createMany({
    data: [
      { question: 'What is the delivery time and charge?', answer: 'Delivery takes 3-5 working days across Pakistan. Delivery charge is PKR 250, free on orders above PKR 10,000.', tags: 'delivery,shipping,charges' },
      { question: 'Do you offer Cash on Delivery?', answer: 'Yes, Cash on Delivery is available all over Pakistan.', tags: 'cod,payment' },
      { question: 'What is the exchange policy?', answer: 'Exchange within 7 days of delivery if unused with original tags. No cash refunds on sale items.', tags: 'return,exchange,refund' },
      { question: 'Size chart for stitched suits', answer: 'Chest/Length in inches: S 36/40, M 38/41, L 40/42, XL 43/43.', tags: 'size,chart,measurement,fit' },
      { question: 'How to wash lawn?', answer: 'Hand wash in cold water with mild detergent, dry in shade, iron on medium heat.', tags: 'care,wash,fabric' },
      { question: 'Do you do custom stitching?', answer: 'Custom stitching is not available online yet. Please talk to an agent for special requests.', tags: 'custom,tailoring,stitching' },
    ],
  });

    console.log('FAQ seeded.');
  }

  // ---- Demo products: added on a fresh database (no products yet), or always with --demo ----
  const force = process.argv.includes('--demo');
  if (process.argv.includes('--no-demo')) return;
  if (force || (await prisma.product.count()) === 0) await addDemoCatalog();
  else console.log('Products already exist, demo catalog skipped (use `npm run demo:add -w server` to add it).');
}

const run = process.argv.includes('--clear-demo') ? () => clearDemoCatalog() : main;
run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
