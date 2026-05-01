# IMEI Stock App — Codebase Structure Map

> Reference document for agent sessions. Keep this updated when adding files or modules.

---

## Overview

**Mobile HQ** is a multi-tenant phone stock management web app.  
- **Backend**: Node.js + Express + MongoDB (Mongoose), single `server.js` entry point.  
- **Frontend**: Single-page app in `public/index.html`, split into modular JS files loaded via `<script>` tags.  
- **Multi-tenancy**: Each client has isolated data in its own MongoDB database (`tenant_<clientId>`).

---

## Directory Tree

```
IMEI-STOCK-APP/
├── server.js                  # Entry point: app init, middleware wiring, route mounts, listen
│
├── db/
│   └── index.js               # MongoDB: connection, reconnect logic, all Mongoose schemas/models,
│                              #   getTenantDb helper, Client + Session global models
│
├── middleware/
│   └── auth.js                # Session helpers (create/get/delete), safeCompare, requireAuth,
│                              #   adminOnly, anyAuth, logAction, authLimiter (rate limiter),
│                              #   tenantMiddleware (attaches req.models + req.validShops)
│
├── utils/
│   └── helpers.js             # buildSalesByShopQuery (shared DB query helper)
│
├── routes/
│   ├── clients.js             # GET /api/clients/lookup
│   │                          # POST /api/auth
│   │                          # POST /api/superadmin/verify
│   │                          # GET|POST /api/superadmin/clients
│   │                          # DELETE /api/superadmin/clients/:clientId
│   │
│   ├── stock.js               # GET  /api/lookup/:imei
│   │                          # GET  /api/stock
│   │                          # POST /api/stock/add
│   │                          # POST /api/stock/sell
│   │                          # GET  /api/stats
│   │                          # PUT  /api/stock/batch
│   │                          # PUT  /api/stock/:id
│   │                          # DELETE /api/stock/:id
│   │
│   ├── sales.js               # GET    /api/sales
│   │                          # DELETE /api/sales
│   │                          # DELETE /api/sales/by-imei/:imei
│   │                          # DELETE /api/sales/:id
│   │
│   ├── days.js                # GET|PUT|DELETE /api/days/:shop/:date
│   │                          # GET /api/days
│   │
│   ├── expenses.js            # GET|POST /api/shopexpenses
│   │                          # DELETE /api/shopexpenses/:id
│   │
│   ├── warehouse.js           # GET|PUT /api/hqstock
│   │                          # DELETE /api/hqstock/:imei
│   │                          # GET|POST|DELETE /api/shipments (+ /:id)
│   │                          # GET|POST|DELETE /api/dispatches (+ /:id)
│   │
│   ├── customers.js           # GET|POST /api/customers
│   │                          # PUT|DELETE /api/customers/:id
│   │
│   ├── logs.js                # GET /api/logs
│   │
│   ├── analytics.js           # GET /api/analytics/models
│   │                          # GET /api/ceo/summary
│   │
│   ├── reports.js             # GET /api/reports
│   │                          # POST /api/reports/generate
│   │                          # DELETE /api/reports/:id
│   │
│   └── backup.js              # GET  /api/backup
│                              # POST /api/restore
│
├── public/                    # Static files served by Express
│   ├── index.html             # Single-page app shell + all HTML panels
│   ├── css/
│   │   └── app.css            # Full stylesheet (~2542 lines)
│   └── js/                    # Frontend modules (loaded in order via <script> tags)
│       ├── globals.js         # Global state vars, CATS, SHOPS, device role detection
│       ├── utils.js           # $(), api(), showToast(), pkr(), fmtDate(), clock
│       ├── ui.js              # nav(), switchShop(), loadSidebarStats(), sidebar, modal
│       ├── imei.js            # IMEI scan, add, sell, batch-add, stock list, sales log
│       ├── daily.js           # Daily sheet, expenses, history, monthly P&L
│       ├── ceo.js             # CEO dashboard, warehouse, shipments, contacts, analytics, reports, logs
│       ├── auth.js            # Auth flow, super admin panel, dynamic shop rendering
│       └── app.js             # bootApp(), initialization IIFE
│
├── scratch/
│   └── check_clients.js       # Debugging/utility script (not part of the app)
│
├── migrate-phase1.js          # One-time migration: stamps clientId on all legacy documents
├── migrate-anas.js            # One-time migration: client-specific data migration
├── create-client.js           # CLI utility: create a new tenant client via the API
│
├── package.json
├── package-lock.json
├── .env                       # (not committed) MONGO_URI, SUPER_ADMIN_PASSWORD, PORT, TRUST_PROXY
└── .gitignore
```

---

## Auth & Multi-Tenancy Flow

```
Browser  →  /api/clients/lookup?clientId=X   →  returns shop list (public)
         →  POST /api/auth {type:'gate',...}  →  validates gate password
         →  POST /api/auth {type:'admin',...} →  returns Bearer token (8h TTL)
         →  POST /api/auth {type:'shop',...}  →  returns Bearer token (8h TTL)

All /api/* (except /auth, /clients/lookup, /superadmin):
  tenantMiddleware:
    1. Reads Bearer token → looks up Session in MongoDB
    2. Gets clientId from session (or X-Client-ID header)
    3. Calls getTenantDb(clientId) → mongoose connection to tenant_<clientId> DB
    4. Attaches req.models (Phone, Sale, Day, …) and req.validShops

  requireAuth(['admin']) / requireAuth(['admin','shop']):
    Verifies Bearer token and role before each protected route
```

---

## MongoDB Databases

| Database               | Contents                                                    |
|------------------------|-------------------------------------------------------------|
| `<default db>`         | `clients` collection (Client documents), `sessions` collection |
| `tenant_<clientId>`    | Per-tenant: phones, sales, days, shopexpenses, hqstocks, shipments, dispatches, customers, auditlogs, reports |

---

## Key Schemas (db/index.js)

| Model name      | Collection     | Key fields                                                   |
|-----------------|----------------|--------------------------------------------------------------|
| `Phone`         | phones         | imei, imei2, brand, model, color, storage, buyPrice, salePrice, status, shop, soldByShop, cat, addedAt, soldAt |
| `Sale`          | sales          | imei, brand, model, buyPrice, salePrice, profit, shop, soldByShop, buyerName, buyerPhone, soldAt |
| `Day`           | days           | shop, date, cats (Mixed), expenses, purchases, transfers, carryForward |
| `ShopExpense`   | shopexpenses   | shop, date, month, category, description, amount             |
| `HQStock`       | hqstocks       | key:'hq', items (Array of phone-like objects)                |
| `Shipment`      | shipments      | date, supplier, ref, items                                   |
| `Dispatch`      | dispatches     | date, toShop, note, items                                    |
| `Customer`      | customers      | name, phone, email, notes                                    |
| `AuditLog`      | auditlogs      | action, shop, role, details, ts                              |
| `Report`        | reports        | type, shop, period, data (Mixed), generatedAt                |
| `Client`        | clients        | clientId, adminPassword, gatePassword, shops, status         |
| `Session`       | sessions       | token, role, shop, clientId, validShops, expiresAt (TTL)     |

---

## Frontend JS Load Order

Scripts must be loaded in this order (dependencies flow downward):

1. `globals.js` — no deps
2. `utils.js`   — uses globals (BASE, authRole)
3. `ui.js`      — uses globals, utils
4. `imei.js`    — uses globals, utils, ui
5. `daily.js`   — uses globals, utils, ui
6. `ceo.js`     — uses globals, utils, ui, daily (guessCat, autoBrandFromCat)
7. `auth.js`    — uses globals, utils, ui
8. `app.js`     — uses all of the above (boot sequence)

---

## Environment Variables

| Variable              | Required | Default       | Description                                      |
|-----------------------|----------|---------------|--------------------------------------------------|
| `MONGO_URI`           | Yes      | —             | MongoDB connection string                        |
| `SUPER_ADMIN_PASSWORD`| No       | `superadmin`  | Password for the super admin panel               |
| `PORT`                | No       | `3000`        | HTTP port                                        |
| `TRUST_PROXY`         | No       | auto          | Express trust proxy setting (true/false/integer) |
| `NODE_ENV`            | No       | —             | Set to `production` to auto-enable trust proxy   |

---

## NPM Dependencies

| Package             | Purpose                                      |
|---------------------|----------------------------------------------|
| `express`           | HTTP server framework                         |
| `cors`              | Cross-Origin Resource Sharing middleware      |
| `mongoose`          | MongoDB ODM                                   |
| `express-rate-limit`| Rate limiting middleware                      |
| `dotenv`            | `.env` file loading                           |

---

## API Route Summary

| Method   | Path                              | Auth     | Description                          |
|----------|-----------------------------------|----------|--------------------------------------|
| GET      | /api/clients/lookup               | Public   | Get shop list for a client           |
| POST     | /api/auth                         | Public   | Authenticate (gate/admin/shop)       |
| POST     | /api/superadmin/verify            | Public   | Verify super admin password          |
| GET/POST | /api/superadmin/clients           | Public*  | List/create clients                  |
| DELETE   | /api/superadmin/clients/:id       | Public*  | Delete client + tenant DB            |
| GET      | /api/lookup/:imei                 | Any      | Look up a phone by IMEI              |
| GET      | /api/stock                        | Any      | List stock (scoped by shop/role)     |
| POST     | /api/stock/add                    | Any      | Add phone to stock                   |
| POST     | /api/stock/sell                   | Any      | Record a sale                        |
| GET      | /api/stats                        | Any      | Stock + sales stats                  |
| PUT      | /api/stock/batch                  | Admin    | Batch-edit phones                    |
| PUT      | /api/stock/:id                    | Admin    | Edit single phone                    |
| DELETE   | /api/stock/:id                    | Admin    | Delete phone                         |
| GET      | /api/sales                        | Admin    | List sales                           |
| DELETE   | /api/sales                        | Admin    | Bulk delete sales + revert stock     |
| DELETE   | /api/sales/by-imei/:imei          | Admin    | Delete sale by IMEI + revert stock   |
| DELETE   | /api/sales/:id                    | Admin    | Delete sale by ID + revert stock     |
| GET      | /api/days                         | Admin    | List all daily sheets                |
| GET/PUT/DELETE | /api/days/:shop/:date       | Admin    | Get/upsert/delete a daily sheet      |
| GET/POST | /api/shopexpenses                 | Admin    | List/add shop expenses               |
| DELETE   | /api/shopexpenses/:id             | Admin    | Delete expense                       |
| GET/PUT  | /api/hqstock                      | Admin    | Get/replace warehouse stock          |
| DELETE   | /api/hqstock/:imei                | Admin    | Remove IMEI from warehouse           |
| GET/POST | /api/shipments                    | Admin    | List/add shipments                   |
| DELETE   | /api/shipments/:id                | Admin    | Delete shipment                      |
| GET/POST | /api/dispatches                   | Admin    | List/dispatch from warehouse         |
| DELETE   | /api/dispatches/:id               | Admin    | Delete dispatch record               |
| GET/POST | /api/customers                    | Admin    | List/add customers                   |
| PUT/DELETE | /api/customers/:id              | Admin    | Update/delete customer               |
| GET      | /api/logs                         | Admin    | Audit log                            |
| GET      | /api/analytics/models             | Admin    | Top-sold + stagnating stock          |
| GET      | /api/ceo/summary                  | Admin    | Monthly CEO dashboard summary        |
| GET/POST | /api/reports                      | Admin    | List/generate reports                |
| DELETE   | /api/reports/:id                  | Admin    | Delete report                        |
| GET      | /api/backup                       | Admin    | Export full backup JSON              |
| POST     | /api/restore                      | Admin    | Import backup JSON (50 MB limit)     |

*Super admin routes use `superAdminPassword` in the request body/query instead of a Bearer token.
