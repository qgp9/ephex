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
   mise install
   ```
2. Configure secrets:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   Set `JWT_SECRET` in `.dev.vars`.
3. Initialize the local D1 database:
   ```bash
   mise run db:init
   ```
   If your local DB already exists, apply the encryption-mode migration:
   ```bash
   mise run db:migrate-local
   ```
4. Start the Worker locally:
   ```bash
   mise run dev
   ```

Wrangler logs and cache are written to workspace-local `.tmp-config/` and `.tmp-cache/`.

## Cloudflare Setup
1. Create a D1 database and R2 bucket:
   ```bash
   wrangler d1 create ephex-db
   wrangler r2 bucket create ephex-storage
   ```
2. Update `wrangler.toml` with your real `database_id`.
3. Apply the schema:
   ```bash
   mise run db:remote
   ```
   If the database already exists, apply the encryption-mode migration:
   ```bash
   mise run db:migrate-remote
   ```
4. Set the JWT secret:
   ```bash
   wrangler secret put JWT_SECRET
   ```
5. Deploy:
   ```bash
   mise run deploy
   ```

## CLI Upload
```bash
curl -F "image=@your_file.png" \
     -H "X-Api-Token: YOUR_TOKEN_HERE" \
     https://your-worker-domain/api/upload
```

## CLI Download
Plain images can be downloaded directly with `curl -O`.

Symmetric encrypted images use the `#key` fragment:

```bash
curl -O "https://your-worker-domain/img/<id>.png"

node bin/ephex-download.js "https://your-worker-domain/img/<id>.enc#<key>"
node bin/ephex-download.js "https://your-worker-domain/img/<id>.enc#<key>" ./restored.png
```

Public-key encrypted images use the wrapped AES key stored in response headers. The private key stays on your machine:

```bash
node bin/ephex-download.js --private-key ~/.config/ephex/private.pem "https://your-worker-domain/img/<id>.enc"
node bin/ephex-download.js --private-key ~/.config/ephex/private.pem "https://your-worker-domain/img/<id>.enc" ./restored.png
```

You can also provide the private key path via environment variable, project `.env`, or `~/.config/ephex/env`:

```bash
EPHEX_PRIVATE_KEY=~/.config/ephex/private.pem node bin/ephex-download.js "https://your-worker-domain/img/<id>.enc"
```

```bash
echo 'EPHEX_PRIVATE_KEY=~/.config/ephex/private.pem' >> .env
node bin/ephex-download.js "https://your-worker-domain/img/<id>.enc"
```

```bash
mkdir -p ~/.config/ephex
cat > ~/.config/ephex/env <<'EOF'
EPHEX_PRIVATE_KEY=~/.config/ephex/private.pem
EPHEX_DOWNLOAD_DIR=~/Downloads/ephex
EPHEX_OVERWRITE_MODE=suffix
EOF
node bin/ephex-download.js "https://your-worker-domain/img/<id>.enc"
```

Priority order is:
1. `--private-key`
2. `EPHEX_PRIVATE_KEY`
3. `./.env` `EPHEX_PRIVATE_KEY`
4. `~/.config/ephex/env` `EPHEX_PRIVATE_KEY`

You can set a default download directory for files saved without an explicit output path:

```bash
EPHEX_DOWNLOAD_DIR=~/Downloads/ephex node bin/ephex-download.js "https://your-worker-domain/img/<id>.png"
```

```bash
echo 'EPHEX_DOWNLOAD_DIR=~/Downloads/ephex' >> .env
node bin/ephex-download.js "https://your-worker-domain/img/<id>.png"
```

```bash
echo 'EPHEX_DOWNLOAD_DIR=~/Downloads/ephex' >> ~/.config/ephex/env
node bin/ephex-download.js "https://your-worker-domain/img/<id>.png"
```

If the directory does not exist, the helper creates it automatically.

Filename collisions are controlled by `EPHEX_OVERWRITE_MODE`:

```bash
EPHEX_OVERWRITE_MODE=suffix
EPHEX_OVERWRITE_MODE=overwrite
EPHEX_OVERWRITE_MODE=fail
```

Default is `suffix`, which saves `image.png`, then `image-2.png`, `image-3.png`, and so on.

## RSA Key Generation
Public-key uploads expect an RSA public key in PEM format.

Generate a 4096-bit private key:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out ephex-private.pem
```

Extract the matching public key:

```bash
openssl rsa -pubout -in ephex-private.pem -out ephex-public.pem
```

Use the contents of `ephex-public.pem` in the `Public Key (PEM)` profile field.
Keep `ephex-private.pem` on the machine that will run:

```bash
node bin/ephex-download.js --private-key ./ephex-private.pem "https://your-worker-domain/img/<id>.enc"
```

On macOS/Linux, private key permissions must be restricted. If needed:

```bash
chmod 600 ephex-private.pem
```
