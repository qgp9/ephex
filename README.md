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

2. **Initialize Local Database**:
   ```bash
   # Using mise
   mise run db:init
   
   # Or directly
   npx wrangler d1 execute relayx-db --local --file=schema.sql
   ```

3. **Run Development Server**:
   ```bash
   # Using mise
   mise run dev
   
   # Or directly
   npx wrangler pages dev public
   ```
   Access the app at [http://localhost:8788](http://localhost:8788).
   - **Initial Login**: `admin` / `admin` (Automated admin creation on first login)

## Deployment

### 1. One-time Cloudflare Setup (Required for both methods)
Before deploying, you must create the necessary serverless resources and set up the database schema.

1. **Create Cloudflare Resources**:
   - **CLI**:
     ```bash
     npx wrangler d1 create relayx-db
     npx wrangler r2 bucket create relayx-storage
     ```
   - **Alternative (Dashboard)**: You can also create these directly via the [Cloudflare Dashboard](https://dash.cloudflare.com/) under **Workers & Pages > D1** and **R2**.

2. **Setup D1 Schema (Remote)**:
   - **CLI**:
     ```bash
     npx wrangler d1 execute relayx-db --remote --file=schema.sql
     ```
   - **Alternative (Dashboard)**: Copy the content of `schema.sql` and run it in the D1 SQL console in the dashboard.

3. **Configure Environment Variables**:
   You must set `JWT_SECRET` (a long random string) for signing session tokens.
   - **CLI**:
     ```bash
     npx wrangler pages secret put JWT_SECRET
     ```
   - **Alternative (Dashboard)**: Go to your Pages project -> **Settings** -> **Environment variables** and add `JWT_SECRET`.

---

### Option A: Direct Deployment (Wrangler CLI)
Fast and direct from your local machine. Perfect for testing.

```bash
# Using mise
mise run deploy

# Or directly
npx wrangler pages deploy public
```

---

### Option B: GitHub Integration (Recommended)
Automatic deployment whenever you `git push`.

1. **Push to GitHub**: Create a repository and push your code.
2. **Connect to Cloudflare**:
   - Go to Cloudflare Dashboard -> **Workers & Pages** -> **Create a project** -> **Connect to git**.
   - Select your repository.
   - **Framework Preset**: `None`.
   - **Build Output Directory**: `public`.
3. **Bind D1 & R2**:
   - In Pages Dashboard -> **Settings** -> **Functions** -> **D1 Database Bindings**, bind `DB` to `relayx-db`.
   - In **R2 Bucket Bindings**, bind `BUCKET` to `relayx-storage`.
4. **Redeploy**: After binding, you may need to trigger a new deployment for the changes to take effect.

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
