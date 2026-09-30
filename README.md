# Splitwise

A production-grade shared-expense and payment application: shared expense
tracking, accurate balances, partial settlements, UPI-based payments with
verified confirmation, cash payments with recipient confirmation, and
automated overdue reminders.

**Status: Phase 3 — expenses and balances.** Authentication, users,
friends, groups, expenses (four split methods) and derived balances are
implemented (API + minimal web UI). Settlements and payments are not built
yet — see [`docs/product/core-rules.md`](docs/product/core-rules.md) for the
rules that will govern them and
[`docs/architecture/financial-model.md`](docs/architecture/financial-model.md)
for the expense/balance model.

## Structure

```
apps/
  web/        Next.js frontend
  api/        NestJS backend

packages/
  shared/     Shared types, enums, constants
  ui/         Shared shadcn/ui-based component library
  config/     Shared TypeScript/ESLint base configuration

docs/
  architecture/  System design and payment-flow docs
  database/      Entity/schema design
  api/           API conventions and planned routes
  product/       Business rules
```

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET (32+ chars in production)
cp apps/web/.env.example apps/web/.env.local
docker compose up -d          # local MongoDB + Redis
npm run dev:api                # http://localhost:4000
npm run dev:web                # http://localhost:3000
```

## Scripts (run from the repo root, across all workspaces)

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

API end-to-end tests run against a real MongoDB and Redis:

```bash
MONGODB_URI=mongodb://localhost:27017/splitwise_e2e REDIS_URL=redis://localhost:6379 JWT_SECRET=local-e2e-secret npm run test:e2e --workspace=apps/api
```

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Authentication & authorization](docs/architecture/auth.md)
- [Payment flow (UPI + cash)](docs/architecture/payment-flow.md)
- [Database overview](docs/database/overview.md)
- [API overview](docs/api/overview.md)
- [Core product rules](docs/product/core-rules.md)
