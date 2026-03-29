# Mobile HQ — IMEI Stock Management App

A web-based stock management system for mobile phone shops. Track inventory by IMEI, record sales, manage expenses, view analytics, and run multi-shop operations — all from a single-page interface that works on desktop and mobile.

---

## Features

| Area | Capabilities |
|---|---|
| **IMEI Scan** | Scan barcodes via camera or type a 15-digit IMEI to look up or sell a device |
| **IMEI Stock** | Browse and search the full inventory for the active shop |
| **Sales Log** | View all completed sales with buyer details and profit |
| **Daily Sheet** | Record per-shop daily cash flow, expenses, purchases, and transfers |
| **Expenses** | Log and categorise shop running costs by month |
| **History** | Browse historical daily sheets by shop and date |
| **CEO Dashboard** | High-level multi-shop revenue, cost, profit, and unit summary |
| **Warehouse** | Manage head-office (HQ) stock levels |
| **Shipments** | Record incoming supplier shipments with item-level detail |
| **Monthly P&L** | Month-by-month profit & loss breakdown per shop |
| **Analytics** | Model-level and shop-level sales analytics |
| **Contacts** | Customer address book with name, phone, and email |
| **Invoices** | Generate and manage customer invoices/reports |
| **Activity Log** | Audit trail of every action taken in the system |
| **Backup / Restore** | Export and import a full JSON snapshot of all data |

---

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express 5
- **Database:** MongoDB via Mongoose
- **Frontend:** Single-page app served as `public/index.html` (vanilla JS, no build step)
- **Auth:** Bearer tokens (in-memory, 8-hour TTL)
- **Rate limiting:** `express-rate-limit` — 300 req/min on all `/api/` routes; 10 attempts per 15 min on the auth endpoint

---

## Getting Started

### Prerequisites

- Node.js 18+
- A running MongoDB instance (local or hosted, e.g. MongoDB Atlas)

### Installation

```bash
git clone https://github.com/aayan-amir/IMEI-STOCK-APP.git
cd IMEI-STOCK-APP
npm install
```

### Configuration

Create a `.env` file in the project root (or set environment variables directly):

```env
# Required
MONGO_URI=mongodb://localhost:27017/phone-stock

# Auth passwords (change these before deploying)
GATE_PASSWORD=your_gate_password
ADMIN_PASSWORD=your_admin_password

# Optional
PORT=3000
NODE_ENV=production

# Reverse-proxy trust (true | false | integer hop count)
# Defaults to 1 in production when unset
TRUST_PROXY=1
```

> **Security note:** The default passwords (`mobworld` / `anasanas`) are insecure. Always override them via environment variables in any non-local deployment.

### Running

```bash
node server.js
```

The app will be available at `http://localhost:3000` (or the port you configured).

---

## Authentication

Login happens in two steps:

1. **Gate check** — enter the gate password to confirm site access (no token is issued).
2. **Role login** — choose a role:
   - **Admin** — full access to all pages and API endpoints.
   - **Shop** — scoped to a single shop; can add stock and sell phones for that shop only.

Sessions expire after **8 hours** and are stored in server memory (tokens are lost on restart).

### Shops

The valid shop identifiers are `456`, `192`, and `G15`.

---

## API Reference

All endpoints require a `Authorization: Bearer <token>` header unless noted.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth` | — | Issue session token |
| `GET` | `/api/lookup/:imei` | any | Look up a phone by IMEI |
| `GET` | `/api/stock` | any | List stock (shop-scoped for shop role; add `?all=true` to include sold) |
| `POST` | `/api/stock/add` | any | Add a phone to stock |
| `POST` | `/api/stock/sell` | any | Mark a phone as sold |
| `PUT` | `/api/stock/:id` | admin | Edit a stock record |
| `DELETE` | `/api/stock/:id` | admin | Delete a stock record |
| `GET` | `/api/sales` | admin | List all sales |
| `DELETE` | `/api/sales` | admin | Bulk-delete sales |
| `DELETE` | `/api/sales/:id` | admin | Delete a single sale |
| `GET` | `/api/stats` | any | Summary stats (total, in-stock, sold, profit) |
| `GET` | `/api/days` | admin | List daily sheets |
| `GET` | `/api/days/:shop/:date` | admin | Get a specific daily sheet |
| `PUT` | `/api/days/:shop/:date` | admin | Save/update a daily sheet |
| `DELETE` | `/api/days/:shop/:date` | admin | Delete a daily sheet |
| `GET` | `/api/shopexpenses` | admin | List shop expenses |
| `POST` | `/api/shopexpenses` | admin | Add a shop expense |
| `DELETE` | `/api/shopexpenses/:id` | admin | Delete an expense |
| `GET` | `/api/hqstock` | admin | Get HQ warehouse stock |
| `PUT` | `/api/hqstock` | admin | Update HQ warehouse stock |
| `POST` | `/api/shipments` | admin | Record an incoming shipment |
| `GET` | `/api/shipments` | admin | List shipments |
| `POST` | `/api/dispatches` | admin | Record a dispatch to a shop |
| `GET` | `/api/dispatches` | admin | List dispatches |
| `GET` | `/api/customers` | admin | List customers |
| `POST` | `/api/customers` | admin | Add a customer |
| `PUT` | `/api/customers/:id` | admin | Update a customer |
| `DELETE` | `/api/customers/:id` | admin | Delete a customer |
| `GET` | `/api/logs` | admin | List audit log entries |
| `GET` | `/api/analytics/models` | admin | Model-level sales analytics |
| `GET` | `/api/ceo/summary` | admin | CEO multi-shop summary |
| `GET` | `/api/reports` | admin | List saved reports |
| `POST` | `/api/reports/generate` | admin | Generate a daily or monthly report |
| `DELETE` | `/api/reports/:id` | admin | Delete a report |
| `GET` | `/api/backup` | admin | Download full JSON backup |
| `POST` | `/api/restore` | admin | Restore from JSON backup |

---

## Project Structure

```
.
├── server.js          # Express server — routes, models, auth
├── public/
│   └── index.html     # Single-page frontend (HTML + CSS + JS)
├── certs/             # TLS certificate files (for local HTTPS if needed)
├── package.json
└── .gitignore
```

---

## Deployment

The app can be deployed to any Node.js-compatible host (Render, Railway, Heroku, VPS, etc.).

Key points:
- Set all environment variables (especially `MONGO_URI`, `ADMIN_PASSWORD`, `GATE_PASSWORD`) before starting.
- If running behind a reverse proxy (Nginx, Render, Heroku), set `TRUST_PROXY` appropriately so rate limiting uses real client IPs.
- In-memory tokens are cleared on restart — users will need to log in again after a redeploy.

