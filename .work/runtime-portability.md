# Runtime Portability Strategy

## Goal
Make `ephex-server` run in both:
- Cloudflare Workers
- Container or VM environments such as Node on Linux

without splitting product behavior into two separate implementations.

## Current State
The current codebase already separates some concerns:
- `src/routes/` contains request handlers with mostly web-standard `Request`/`Response` logic
- `src/worker.js` is the Cloudflare-specific entrypoint
- storage currently assumes `env.BUCKET`
- database currently assumes D1-style `prepare/bind/run/first/all`

This is portable in principle, but the platform bindings are still implicit.

## Target Shape
Refactor toward a small ports-and-adapters structure:

- `src/core/`
  - business rules
  - upload metadata logic
  - link generation policy
  - expiration and download-limit checks
- `src/platform/worker/`
  - Worker `fetch()` entry
  - D1 adapter
  - R2 adapter
- `src/platform/node/`
  - Node HTTP adapter
  - SQLite adapter
  - filesystem or object-storage adapter
- `src/routes/`
  - thin request-to-core mapping only

## First Extraction Points
These are the first interfaces worth introducing.

### Storage Port
Expected operations:
- `put(name, body, metadata)`
- `get(name)`
- `delete(name)`

Worker implementation:
- R2 bucket

Container implementations:
- local filesystem
- S3-compatible object storage

### Database Port
Keep the abstraction narrow and query-shaped at first.

Expected capabilities:
- fetch user by id
- fetch user by token
- save user settings
- insert image
- fetch image by id
- list images for user
- increment download count
- delete image

Do not start with “support every SQL backend”.
Start with one repository-style interface and provide:
- D1 implementation
- SQLite implementation

### Runtime Port
Translate incoming requests into the same handler contract.

Worker side:
- current `fetch(request, env, ctx)`

Node/container side:
- Hono, Express, Fastify, or native HTTP wrapper
- build a compatible context object
- inject db/storage adapters explicitly

## Practical Migration Plan
1. Introduce explicit `services` for image upload, image fetch, and profile settings.
2. Move direct `env.DB` and `env.BUCKET` calls behind adapter objects.
3. Change route handlers to depend on injected adapters instead of raw Worker env.
4. Keep `src/worker.js` as one runtime adapter.
5. Add a new Node runtime entrypoint after the service layer is stable.
6. Reuse the existing CLI E2E tests against both runtimes.

## Testing Strategy
The current CLI helpers already make runtime-agnostic E2E testing practical.

Use the same test matrix against:
- Worker local dev
- Node/container runtime

Required scenarios:
- plain upload/download
- symmetric upload/download
- public-key upload/download
- missing symmetric key failure
- private key permission failure
- expiration failure
- download-limit failure

This keeps runtime compatibility grounded in product behavior instead of implementation details.

## Non-Goals For The First Pass
- Multi-database support beyond D1 and SQLite
- Full object-storage matrix support
- Access/auth refactor at the same time
- UI redesign tied to runtime work

## Recommendation
If a container target becomes important, do not fork the app.
Keep one product surface and add:
- one storage port
- one database port
- one runtime adapter layer

That is enough to support both Workers and container deployments without turning the codebase into two separate systems.
