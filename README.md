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

1. **Create Cloudflare Resources**:
   ```bash
   npx wrangler d1 create relayx-db
   npx wrangler r2 bucket create relayx-storage
   ```

2. **Setup D1 Schema (Remote)**:
   ```bash
   # Using mise
   mise run db:remote
   ```

3. **Configure Environment Variables**:
   Set `JWT_SECRET` in the Cloudflare Pages Dashboard (Settings > Environment Variables).

4. **Deploy**:
   ```bash
   # Using mise
   mise run deploy
   ```

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
