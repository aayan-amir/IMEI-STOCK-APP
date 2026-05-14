# stock-ly — IMEI Stock Management App

A multi-tenant inventory and operations app for phone businesses.

It supports client-based isolation, IMEI lifecycle tracking, shop operations, warehouse/dispatch workflows, daily accounting, analytics, reporting, backups, and super-admin tenant management.

---

## Current App State

- **Multi-tenant by client** (`clientId`)
- **Per-client auth** with separate:
  - **Gate password** (site access)
  - **Admin password** (full access)
- **Shop mode** for restricted shop-level access
- **Super Admin** panel to:
  - verify super-admin password
  - create/update clients
  - list clients
  - pause/resume clients
  - delete clients (and tenant DB)

Frontend is a vanilla JS single-page app under `public/`.
Backend is Express + MongoDB with tenant model routing.

### Stability / Readiness Notes
- Core flows are implemented and wired end-to-end (auth, stock, sales, reports, warehouse, backup, products, super-admin client management).
- Automated tests are **not implemented yet** in `package.json` (current `npm test` is a placeholder script that exits with error).
- Security hardening is partially in place (Helmet + rate limits), but some production hardening is still pending (for example: open CORS in current server setup).

---

## Main Modules

- IMEI Scan / Add / Sell
- IMEI Stock Management
- Sales Log
- Daily Sheet (cashflow + categories)
- Shop Expenses
- History
- Warehouse (`hqstock`)
- Shipments and Dispatches
- Monthly P&L
- CEO Summary Dashboard
- Model Analytics
- Contacts / Customers
- Reports (daily/monthly)
- Activity Logs
- Backup / Restore
- Product Inventory (`/api/products`)

---

## Tech Stack

- **Runtime:** Node.js
- **Server:** Express 5
- **Database:** MongoDB + Mongoose
- **Frontend:** Vanilla JS, HTML, CSS (no build step)
- **Security middleware:** Helmet, express-rate-limit
- **Password hashing:** bcrypt

---

## Authentication & Session Model

### Login Flow
1. Client lookup (`/api/clients/lookup?clientId=...`)
2. Gate verification (`POST /api/auth`, `type=gate`)
3. Role auth (`type=admin` or `type=shop`)

### Sessions
- Bearer token sessions are stored in MongoDB (`Session` model)
- TTL expiry: **8 hours**
- Session includes `role`, `shop`, `clientId`, `validShops`

### Rate Limits
- `/api/` global: 300 requests/min per IP
- `/api/auth`: 10 attempts / 15 min
- `/api/superadmin/*`: 5 attempts / 15 min
- `/api/clients/lookup`: 100 attempts / 15 min

---

## Environment Variables

Create `.env` (or set in your host):

```env
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/imei-stock
PORT=3000
NODE_ENV=production
TRUST_PROXY=1
SUPER_ADMIN_PASSWORD=change_this_to_a_strong_secret
```

### Notes
- `SUPER_ADMIN_PASSWORD` currently has a code fallback (`superadmin`) if unset; set this explicitly in production.
- CORS is currently open in server code (`app.use(cors())`).

---

## Run Locally

```bash
npm install
node server.js
```

App: `http://localhost:3000`

---

## API Overview

All endpoints below are mounted under `/api`.

### Client & Auth
- `GET /clients/lookup?clientId=...`
- `POST /auth`
- `PUT /auth/password` (admin only)

### Super Admin
- `POST /superadmin/verify`
- `POST /superadmin/clients`
- `GET /superadmin/clients` (uses `X-Super-Admin-Password` header)
- `DELETE /superadmin/clients/:clientId`

### Stock / Sales
- `GET /lookup/:imei`
- `GET /stock`
- `POST /stock/add`
- `POST /stock/sell`
- `PUT /stock/batch` (admin)
- `PUT /stock/:id` (admin)
- `DELETE /stock/:id` (admin)
- `GET /stats`
- `GET /sales` (admin)
- `DELETE /sales` (admin)
- `DELETE /sales/by-imei/:imei` (admin)
- `DELETE /sales/:id` (admin)

### Days / Expenses / Logs / Customers
- `GET /days` (admin)
- `GET /days/:shop/:date` (admin)
- `PUT /days/:shop/:date` (admin)
- `DELETE /days/:shop/:date` (admin)
- `GET /shopexpenses` (admin)
- `POST /shopexpenses` (admin)
- `DELETE /shopexpenses/:id` (admin)
- `GET /logs` (admin)
- `GET /customers` (admin)
- `POST /customers` (admin)
- `PUT /customers/:id` (admin)
- `DELETE /customers/:id` (admin)

### Warehouse / Movement
- `GET /hqstock` (admin)
- `PUT /hqstock` (admin)
- `DELETE /hqstock/:imei` (admin)
- `DELETE /hqstock/at/:index` (admin)
- `POST /shipments` (admin)
- `GET /shipments` (admin)
- `DELETE /shipments/:id` (admin)
- `POST /dispatches` (admin)
- `GET /dispatches` (admin)
- `DELETE /dispatches/:id` (admin)

### Reports / Analytics / Backup / Products
- `GET /reports` (admin)
- `POST /reports/generate` (admin)
- `DELETE /reports/:id` (admin)
- `GET /analytics/models` (admin)
- `GET /ceo/summary` (admin)
- `GET /backup` (admin)
- `POST /restore` (admin)
- `GET /products`
- `POST /products`
- `PUT /products/:id`
- `DELETE /products/:id`

---

## Repository Layout

```text
IMEI-STOCK-APP/
├── server.js
├── db/
├── middleware/
├── routes/
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/
├── package.json
└── README.md
```

---

## Testing Status

There is currently no implemented automated test suite in `package.json`.
Running `npm test` returns the placeholder error from the existing script.
