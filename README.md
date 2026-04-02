# ephex-server (WIP) ✦

[![Built with Codex](https://img.shields.io/badge/Built%20with-Codex-0A0A0A?style=for-the-badge)](https://openai.com/codex)

Secure, serverless image sharing built on Cloudflare Workers, D1, and R2.

`ephex-server` is the backend used by the `ephex` macOS app for image upload and hosted asset delivery.

## Stack
- `public/`: static frontend assets
- `src/worker.js`: Worker entry and route adapter
- `src/routes/`: API route handlers
- `src/middleware/`: request middleware
- `src/lib/`: shared auth and crypto utilities
- `ephex-php/`: archived PHP version
- `schema.sql`: D1 schema
- `wrangler.toml`: Cloudflare Workers configuration

## Naming

This repository is `ephex-server`.
The deployed Worker can keep the existing `ephex` runtime/service name unless and until a separate Cloudflare migration is needed.

## Local Development
1. Install tooling:
   ```bash
   npm install
   ```
2. Configure secrets:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   Set `JWT_SECRET` in `.dev.vars`.
3. Initialize the local D1 database:
   ```bash
   npm run db:init
   ```
4. Start the Worker locally:
   ```bash
   npm run dev
   ```

Wrangler logs and cache are written to workspace-local `.tmp-config/` and `.tmp-cache/`.

## Cloudflare Setup
1. Create a D1 database and R2 bucket:
   ```bash
   npx wrangler d1 create ephex-db
   npx wrangler r2 bucket create ephex-storage
   ```
2. Update `wrangler.toml` with your real `database_id`.
3. Apply the schema:
   ```bash
   npm run db:remote
   ```
4. Set the JWT secret:
   ```bash
   npx wrangler secret put JWT_SECRET
   ```
5. Deploy:
   ```bash
   npm run deploy
   ```

## CLI Upload
```bash
curl -F "image=@your_file.png" \
     -H "X-Api-Token: YOUR_TOKEN_HERE" \
     https://your-worker-domain/api/upload
```

## CLI Download
Download a raw image URL, or pass a viewer URL. Encrypted viewer URLs are downloaded and decrypted automatically when the `#key` fragment is present.

```bash
node bin/ephex-download.js "https://your-worker-domain/api/raw/<id>/image.png"
node bin/ephex-download.js "https://your-worker-domain/?id=<id>"
node bin/ephex-download.js "https://your-worker-domain/?v=<id>#<key>"
node bin/ephex-download.js "https://your-worker-domain/?v=<id>#<key>" ./restored.png
```
