# Deploy on a VPS (Ubuntu 22.04 / 24.04)

Works on any Ubuntu VPS (Hostinger, DigitalOcean, Contabo, AWS Lightsail…). You need: **1 vCPU, 1–2 GB RAM, 20 GB+ disk** (photos are stored on this disk) and a domain or subdomain, e.g. `bot.yourshop.pk`.

> Photos are kept **on the server** in `server/uploads/`. Use a normal VPS with a persistent disk, **not** a container/"app platform" host that wipes files on redeploy. Backups (step 7) are essential.

## 1. Point your domain
At your domain registrar add an **A record**: `bot` → your server's IP. Wait until `ping bot.yourshop.pk` shows the IP.

## 2. Install software (once)
```bash
ssh root@YOUR_SERVER_IP
adduser shop && usermod -aG sudo shop && su - shop      # don't run the app as root
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx sqlite3 git fonts-dejavu-core
sudo npm install -g pm2
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable   # port 3000 stays closed
```

## 3. Upload the code
Easiest: push the project to a **private** GitHub repo and `git clone` it. Or upload the folder with WinSCP/FileZilla.
**Don't upload** `node_modules`, `dist`, `server/prisma/dev.db` or `server/uploads` from Windows (they're rebuilt on the server).
```bash
cd ~ && git clone https://github.com/YOU/whatsapp-bot.git && cd whatsapp-bot
```

## 4. Configure
```bash
cp server/.env.example server/.env && nano server/.env
```
Fill in everything from the **Credentials checklist** in README.md. On a server these must be set:
- `PUBLIC_BASE_URL=https://bot.yourshop.pk`
- `JWT_SECRET=` long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`); the app refuses to start without it
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: a strong password, not `admin123`
- `WHATSAPP_TOKEN` (permanent System User token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`
- `OPENAI_API_KEY` (optional)
- leave `S3_BUCKET` empty → photos stay on the server

## 5. Install, build, start
```bash
npm run setup          # installs packages, creates the database, admin, menus + demo catalog
npm run build          # builds the admin panel and the server
pm2 start deploy/ecosystem.config.cjs
pm2 save && pm2 startup     # run the command it prints, so the bot starts after a reboot
pm2 logs whatsapp-bot       # check for errors (Ctrl+C to exit)
```

## 6. Nginx + HTTPS
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/whatsapp-bot
sudo sed -i 's/bot.yourshop.pk/YOUR.DOMAIN/' /etc/nginx/sites-available/whatsapp-bot
sudo ln -s /etc/nginx/sites-available/whatsapp-bot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR.DOMAIN      # free HTTPS, auto-renews
```
Open `https://YOUR.DOMAIN` → admin login. Dashboard → Setup checklist should be all ✅.

**Meta:** WhatsApp → Configuration → Webhook → Callback URL `https://YOUR.DOMAIN/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN` → Verify and save → subscribe to **messages**. Send "Hi" from a test-recipient phone.

## 7. Backups (database + photos)
```bash
chmod +x deploy/backup.sh && ./deploy/backup.sh       # test it once
crontab -e
# add this line (daily at 03:15):
15 3 * * * /home/shop/whatsapp-bot/deploy/backup.sh >> /home/shop/backups/backup.log 2>&1
```
Keeps 14 days in `~/backups`. Also copy that folder **off the server** regularly (WinSCP to your PC, or your VPS provider's snapshot feature). A backup on the same disk won't survive a disk failure.

**Restore:** `pm2 stop whatsapp-bot`, then `gunzip -c ~/backups/db_DATE.sqlite.gz > server/prisma/dev.db`, then `tar -xzf ~/backups/files_DATE.tar.gz -C server`, then `pm2 start whatsapp-bot`.

## 8. Going live with real products
```bash
npm run demo:clear -w server      # remove the demo products
```
Then load your catalog via **Import / export** in the admin panel.

## Updating to a new version
```bash
cd ~/whatsapp-bot && ./deploy/backup.sh
git pull                          # or upload the changed files
npm install
npm run db:push -w server         # applies database changes, keeps your data
npm run build
pm2 restart whatsapp-bot
```

## Troubleshooting
| Problem | Fix |
|---|---|
| Meta says webhook "couldn't be validated" | `WHATSAPP_VERIFY_TOKEN` must match exactly; site must open on **https**; check `pm2 logs` |
| Bot gets messages but doesn't reply | `pm2 logs` → `send failed`. Usually an expired `WHATSAPP_TOKEN` or the phone isn't a test recipient |
| Product cards arrive without photos | `PUBLIC_BASE_URL` wrong or not https; open a photo URL in your browser to test |
| "invalid signature" in logs | `WHATSAPP_APP_SECRET` is wrong |
| Upload fails with 413 | `client_max_body_size` missing in the Nginx config |
| Demo photos have no text | `sudo apt install fonts-dejavu-core`, then `npm run demo:clear -w server && npm run demo:add -w server` |
| Out of disk space | `du -sh server/uploads ~/backups`; delete old backups or upgrade the disk |
