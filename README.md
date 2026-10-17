# WhatsApp Commerce Bot (Ladies Suits) — MVP

Node.js + TypeScript (Express, Prisma) bot for the **WhatsApp Cloud API**, with an **OpenAI** tool-calling assistant and a **React admin panel**.

```
server/   Express API, WhatsApp webhook, bot engine (state machine), AI tools, Prisma DB
admin/    React admin panel (Vite)
```

## What works now

- **Guided shopping with buttons/lists**: collections → stitched/unstitched → size → product cards (photo + "View & Buy") → colour/size → quantity → cart → checkout (name, city, address, phone) → review → **COD order**.
- Menus only offer what is **actually in stock** for the choices so far, so customers don't hit dead ends.
- **Stale-tap protection**: buttons that change the cart or order (quantity, remove, confirm) only work from the latest bot message. Old taps are rejected and the latest menu is sent again.
- **Exactly-once processing**: a webhook that Meta sends twice with the same `wamid` is ignored. A double-tap on "Confirm" can't create two orders. Stock is decremented atomically.
- **Admin-configurable bot**: the main menu items, custom info menus (help, size guide, offers…), every reply text, keyword auto-replies, and the knowledge base/FAQ.
- **AI (OpenAI)** for typed messages in English, Urdu and Roman Urdu. It uses tools for product search, product details, knowledge, cart, adding to cart, order status, showing product cards and handing off to a human. It **cannot** invent products, change prices or place or confirm orders. Every tool can be switched on or off in the admin. When the AI is off or fails, the bot falls back to keyword search and the menus.
- **Questions mid-checkout** (e.g. "delivery charges?") are answered, then the bot repeats the current step, so no progress is lost.
- **Human handoff + Inbox**: customer types "agent", or the AI escalates, and the bot pauses. An agent replies from the admin panel (the 24h window is enforced), and the chat can be handed back to the bot.
- **Inventory**: a stock page with filters (low / out of stock), quick **Add / Remove / Set-to-count** with a reason, and a full **stock history** (orders, cancellations, edits, imports, who did it, stock after each change). Stock changes are always applied as **+/− deltas**, so an order placed while you edit a product is never overwritten.
- **Bulk import/export (Excel .xlsx or CSV)**: one row per SKU. Download the template or export your catalog, edit it in Excel or Google Sheets, and upload it. You see a preview with row-by-row errors before anything is saved, and the import is all-or-nothing. Stock can be **replaced** (after a stock count) or **added** (new shipment). Image links (Google Drive, Dropbox, websites) are downloaded and optimised automatically.
- **Photos**: any format (JPG, PNG, WEBP, **iPhone HEIC**) up to 25 MB, auto-rotated, resized to max 1200×1500 and compressed (usually under 400 KB). You can upload several at once, reorder them, set the cover, and **tag photos by colour**. Customers then see one photo per colour, and the photo of the colour they picked. Photos are stored locally, or on **Cloudflare R2 / S3** if you set the `S3_*` variables.
- **Customer photo search**: a customer sends a photo of a suit, and the AI (vision model) finds similar in-stock suits. Agents see the photo in the Inbox. The simulator has a 📷 button.
- **Orders**: status, courier and tracking number, a WhatsApp notification to the customer (inside the 24h window), cancel with automatic restock, CSV export.
- **Products**: variants (SKU per colour/size with its own stock and sale price), a quick variant generator, and a product code for Excel matching. Deleting a product that has sales history archives it, so your reports stay correct.
- More than 9 collections are paginated in the bot ("More collections ▶").
- **Simulator**: chat with the real bot inside the admin panel. No Meta account needed.
- Roles: OWNER / STAFF / AGENT.

## Run it on Windows

Requires **Node.js 20+** (https://nodejs.org).

```powershell
cd D:\whatsapp-bot
copy server\.env.example server\.env      # then edit server\.env
npm run setup                              # installs, creates SQLite DB, seeds demo data
npm run dev                                # server :3000 + admin :5173
```

Open http://localhost:5173 and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (default `admin@example.com` / `admin123`, **change it**). Go to **Test chat (simulator)** and type `Hi`.

Automated tests: `npm test -w server` runs the bot flow (stock filtering, stale taps, duplicate webhooks, checkout, double confirm, handoff, colour photos, category paging) and the catalog checks (stock deltas, adjustments, import/export, archiving).

**Updating from an earlier version?** Run `npm install` and then `npm run db:push -w server` (adds the new columns; your data is kept).

### Demo catalog

`npm run setup` loads a **demo catalog** on a fresh database: 24 products in 9 collections (Lawn, Cotton, Chiffon, Linen, Khaddar, Formal, Wedding, Kurtis, Eid). It includes stitched and unstitched suits, 1/2/3-piece, prices from PKR 2,490 to 45,000, sale prices, low and out-of-stock sizes, per-colour photos and one Draft product. The photos are generated on your own server, so no outside image site is needed. They are clearly marked **DEMO**.

```bash
npm run demo:add -w server     # add the demo products (skips ones already there)
npm run demo:clear -w server   # remove all demo products (codes start with DEMO-); ones with orders are archived
```

Run `demo:clear` before you load your real catalog.

### Loading your real catalog

1. Create your categories (or let the import create them).
2. **Import / export → Download template**, fill one row per SKU and paste public photo links in `images` (product photos, first = cover) and `color_images` (photos of that colour).
3. Upload, read the preview, fix any errors, then click **Import now**.
4. Later: export, change prices or stock in Excel, and import again. For stock only, a file with `product_code, sku, stock` is enough.

## Connect the Meta test number

1. developers.facebook.com → Create App → *Business* → add **WhatsApp**.
2. **WhatsApp → API Setup**: copy the *Phone number ID* into `WHATSAPP_PHONE_NUMBER_ID`. Add your own phone as a **test recipient**. The test number can only message verified recipients (max 5).
3. Token: the token shown on API Setup **expires in ~24h**. For anything longer, create a **System User** in Business Settings, give it the app + WhatsApp permissions (`whatsapp_business_messaging`, `whatsapp_business_management`) and generate a permanent token → `WHATSAPP_TOKEN`.
4. **App Settings → Basic → App secret** → `WHATSAPP_APP_SECRET` (enables webhook signature checks).
5. Expose your PC over HTTPS: `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`. Put the URL in `PUBLIC_BASE_URL` and restart.
6. **WhatsApp → Configuration → Webhook**: Callback URL `https://<your-tunnel>/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`. Subscribe to the **messages** field.
7. Send "Hi" from your phone to the test number.

Optional: add `OPENAI_API_KEY` for AI replies. Set the model in **AI settings** (it must support tool calling).

## Credentials checklist (what goes in `server/.env`)

| Variable | Where to get it | Needed for |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → **API Setup** → "Phone number ID" (the test number's ID, **not** the phone number itself) | Sending messages |
| `WHATSAPP_TOKEN` | Testing: the temporary token on API Setup (expires in ~24h). Server: **Business Settings → Users → System users** → add an Admin system user → **Add assets** (your app + WhatsApp account) → **Generate token** with `whatsapp_business_messaging` + `whatsapp_business_management`, expiry **Never** | Sending messages, downloading customer photos |
| `WHATSAPP_APP_SECRET` | Meta app → **App settings → Basic → App secret** (click Show) | Verifying that webhooks really come from Meta. **Required on a server** |
| `WHATSAPP_VERIFY_TOKEN` | **You make it up** (any random string). Paste the same value in WhatsApp → Configuration → Webhook | Meta's one-time webhook check |
| `PUBLIC_BASE_URL` | Your server's HTTPS address, e.g. `https://bot.yourshop.pk` | Product photos (WhatsApp downloads them from here) + shows the webhook URL in the dashboard |
| `JWT_SECRET` | **You make it up**: a long random string, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | Admin logins. Changing it logs everyone out |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | **You choose**. Used only when the first admin is created | First login; change the password afterwards |
| `OPENAI_API_KEY` | platform.openai.com → API keys (add billing; set a monthly limit) | AI replies + photo search (optional) |
| `OPENAI_MODEL` | A current model that supports tool calling **and images**; can also be changed in AI settings | AI |
| `DATABASE_URL` | SQLite file by default; for production a MySQL/Postgres URL (also change `provider` in `schema.prisma`) | Data |
| `S3_*` | Cloudflare R2 / AWS S3 bucket + access key with write permission + the bucket's public URL | Photos in the cloud (optional; otherwise stored in `server/uploads`) |
| `GRAPH_API_VERSION` | Leave the default unless Meta deprecates it; check the version shown in your Meta app | API calls |

The `WHATSAPP_ACCOUNT_ID` (WABA ID) and App ID are **not** needed by this code, but keep them handy: you need them in Meta's dashboard.
Never commit `.env` to git (it is in `.gitignore`). If a token leaks, revoke it in Business Settings and generate a new one.

## Production build

**Deploying to a VPS (Nginx, HTTPS, PM2, daily backups of the database + photos): see [DEPLOY.md](DEPLOY.md).**

```powershell
npm run build      # builds admin into admin/dist, compiles server
npm start          # server serves the admin panel + API + webhook on one port
```

## Known limitations / next steps (be aware)

| Area | Current MVP | Needed for production |
|---|---|---|
| Database | SQLite file | Switch `provider` in `schema.prisma` to `mysql`/`postgresql` |
| Queue / locks | In-process, one server instance | Redis queue + lock if you run several instances. Webhook events are processed after the 200 ACK and are **not** durable if the server crashes mid-processing |
| Payments | Cash on Delivery only | Gateway link (Safepay/JazzCash/Easypaisa) + signed callback |
| Outbound after 24h | Blocked (warning shown) | Approved **message templates** for order updates & marketing |
| Images | Product card = 1 message with header image; max 3 photos per product view | Meta catalog / multi-product messages need a Commerce catalog (often not usable on the test number) |
| Photo files | Removed photos stay on disk/bucket | A cleanup job for unused files |
| Stock reservation | Stock checked at add-to-cart, checkout and confirm, then decremented at order | Optional reservation with timeout for high-demand drops |
| Import size | Up to 5,000 rows per file; image links are downloaded during import (slow for hundreds of photos) | Background job with progress for very large catalogs |
| COD fraud | Max qty per item, seller confirms (PENDING → CONFIRMED) | Optional OTP/"reply YES" confirmation, blacklist |
| Courier | Manual tracking number | Courier API (TCS/Leopards/PostEx) |
| Photo search | AI looks at the photo and searches by colour, fabric and style (not pixel-exact) | Image-embedding similarity search for large catalogs |
| Media hosting | Local `uploads/` folder unless `S3_*` is set | Use R2/S3 in production; the local folder is lost on many hosts |
