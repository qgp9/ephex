# RelayX ✦

[![Built with Antigravity](https://img.shields.io/badge/Built%20with-Antigravity-blueviolet?style=for-the-badge&logo=googlegemini&logoColor=white)](https://antigravity.google.com)

Secure, Serverless Image Sharing Tool. 
Built with **Cloudflare Pages**, **D1 (SQLite)**, and **R2 (Object Storage)**.

## Key Features
- **Serverless Architecture**: No servers to manage, scales automatically on Cloudflare.
- **Client-Side Encryption**: Support for AES-GCM encrypted uploads (Decryption happens in the browser via Anchor link).
- **JWT Authentication**: Secure session management using edge-verifyable JSON Web Tokens.
- **RESTful API**: CLI-friendly upload with API Token support.
- **Modern Dashboard**: Responsive Vanilla JS/CSS frontend with drag-and-drop and paste support.

## Project Structure
- `public/`: Static frontend (HTML/JS/CSS).
- `functions/api/`: Cloudflare Pages Functions (Serverless API endpoints).
- `relayx-php/`: (Archive) Original PHP/SQLite version.
- `schema.sql`: Database schema for D1.
- `wrangler.toml`: Cloudflare configuration.

## Pre-requisites
- [Cloudflare Account](https://dash.cloudflare.com/)
- [mise-en-place](https://mise.jdx.dev/) or [Node.js](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

## Quick Start (Local Development)

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Setup Local Environment**:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars and set your JWT_SECRET (e.g. openssl rand -base64 32)
   ```

3. **Initialize Local Database**:
   ```bash
   # Using mise
   mise run db:init
   
   # Or directly
   npx wrangler d1 execute relayx-db --local --file=schema.sql
   ```

4. **Run Development Server**:
   ```bash
   # Using mise
   mise run dev
   
   # Or directly
   npx wrangler pages dev public
   ```
   Access the app at [http://localhost:8788](http://localhost:8788).
   - **Initial Login**: `admin` / `admin` (Automated admin creation on first login)

## Deployment

> **⚠️ Choose your deployment method first!**
> Option A (Wrangler CLI) and Option B (GitHub) create **different project types**.
> A project created via `wrangler pages project create` is a "Direct Upload" project and **cannot** be connected to GitHub later. If you want GitHub auto-deploy, skip the CLI project creation and start from Option B.

### Common Setup (Required for both methods)

1. **Create D1 Database and R2 Bucket**:
   - **CLI**:
     ```bash
     npx wrangler d1 create relayx-db
     npx wrangler r2 bucket create relayx-storage
     ```
   - **Alternative (Dashboard)**: Create these via the [Cloudflare Dashboard](https://dash.cloudflare.com/) under **D1** and **R2** sections.

2. **Update `wrangler.toml`**:
   After creating the D1 database, you will get a UUID (e.g., `50e4f337-...`).
   - Run `npx wrangler d1 list` if you missed it.
   - Open `wrangler.toml` and replace `database_id` with your **actual UUID**.

3. **Setup D1 Schema (Remote)**:
   - **CLI**:
     ```bash
     npx wrangler d1 execute relayx-db --remote --file=schema.sql
     ```
   - **Alternative (Dashboard)**: Copy the content of `schema.sql` and run it in the D1 SQL console.

4. **Generate a `JWT_SECRET` value** (you'll need it in the next step):
   ```bash
   openssl rand -base64 32
   ```

---

### Option A: Direct Deployment (Wrangler CLI)
Deploy directly from your terminal. Simple and fast.

```bash
# 1. Create the Pages project (Direct Upload type)
npx wrangler pages project create relayx

# 2. Set JWT_SECRET
npx wrangler pages secret put JWT_SECRET

# 3. Deploy
mise run deploy
# Or: npx wrangler pages deploy public
```

---

### Option B: GitHub Integration (Recommended)
Automatic deployment on every `git push`. **Do NOT run `wrangler pages project create`** — the project is created through the dashboard instead.

1. **Push to GitHub**: Create a repository and push your code.
2. **Create project via Cloudflare Dashboard**:
   - Go to **Workers & Pages** -> **Create application**.
   - If you don't see a "Pages" tab at the top, look at the very bottom and click the link: **"Looking to deploy Pages? Get started"**.
   - Click **Connect to git**.
   - Select your repository.
   - **Project Name**: `relayx`
   - **Build command**: (Leave empty)
   - **Deploy command**: `npx wrangler deploy`
   - Click **Save and Deploy** to complete project creation.
   - D1 and R2 bindings are automatically configured from `wrangler.toml`.
3. **Set `JWT_SECRET` (After project is created)**:
   ```bash
   npx wrangler pages secret put JWT_SECRET
   ```
   Or add it in the Dashboard under **Settings** -> **Environment variables**.

## CLI Usage (Curl)
Capture your API Token from the **Profile** section of the dashboard.

```bash
curl -F "image=@your_file.png" \
     -H "X-Api-Token: YOUR_TOKEN_HERE" \
     https://relayx.pages.dev/api/upload
```

## Credits
Based on the original PHP version of RelayX (formerly SendImg).
Converted to Serverless Architecture in 2024.
