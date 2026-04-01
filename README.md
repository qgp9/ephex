# [WIP] Ephex ✦

Secure, serverless image sharing built on Cloudflare Workers, D1, and R2.

## Stack
- `public/`: static frontend assets
- `functions/api/`: reusable API handlers
- `src/worker.js`: Worker entry and route adapter
- `ephex-php/`: archived PHP version
- `schema.sql`: D1 schema
- `wrangler.toml`: Cloudflare Workers configuration

## Why Workers
Cloudflare now recommends Workers Static Assets for new static, SPA, and full-stack projects. This project uses a Worker entry point for `/api/*` and serves the frontend from static assets in `public/`.

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

The app is served by Wrangler. The frontend comes from `public/`, and `/api/*` is handled by `src/worker.js`.
Wrangler logs and cache are written to workspace-local `.tmp-config/` and `.tmp-cache/` so local runs do not depend on `~/.config`.

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

If you already have `relayx-*` Cloudflare resources, you can keep using them by adjusting `wrangler.toml` instead of recreating them.

## Auth Bootstrap
On the first successful login, if no users exist yet and the username is `admin`, the app creates the initial admin account.

## CLI Upload
```bash
curl -F "image=@your_file.png" \
     -H "X-Api-Token: YOUR_TOKEN_HERE" \
     https://your-worker-domain/api/upload
```
