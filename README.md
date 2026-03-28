# IMEI Stock App

A full-stack inventory and sales management system for mobile phone shops. Track stock by IMEI, manage sales, monitor shop expenses, generate reports, and manage customers — all from a single web interface.

---

## Features

- **Stock Management** — Add phones with IMEI, brand, model, colour, storage, and buy price. Edit or delete entries (admin only).
- **Sales** — Sell phones by IMEI scan or manual entry, record sale price and customer. Undo sales to revert phones to in-stock.
- **Multi-shop Support** — Assign stock and sales to different shops; each shop has its own daily summaries and expense tracking.
- **HQ Stock** — Track headquarters stock separately from individual shops.
- **Shipments & Dispatches** — Log inbound shipments and outbound dispatches from HQ to shops.
- **Customer Management** — Maintain a customer directory with name, phone, email, and notes.
- **Daily Summaries** — Record and review per-shop daily financials.
- **Shop Expenses** — Log and categorise operating expenses per shop.
- **Analytics** — View model-level sales analytics and CEO-level summaries across all shops.
- **Reports** — Generate and save daily/weekly/monthly reports per shop.
- **Backup & Restore** — Export a full JSON backup of all data; restore from a backup file.
- **Camera Barcode Scanning** — Scan IMEIs via the device camera (BarcodeDetector API with rear-camera selection).
- **Role-based Access** — Admin and non-admin (shop) users with token-based authentication (8-hour sessions).
- **Rate Limiting** — 300 API requests per minute per IP.

---

## Tech Stack

| Layer    | Technology                      |
|----------|---------------------------------|
| Backend  | Node.js, Express 5              |
| Database | MongoDB via Mongoose 9          |
| Frontend | Vanilla JS, HTML/CSS (single page) |
| Auth     | In-memory bearer tokens (crypto) |

---

## Prerequisites

- Node.js ≥ 18
- A MongoDB instance (local or [MongoDB Atlas](https://www.mongodb.com/atlas))

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/aayan-amir/IMEI-STOCK-APP.git
cd IMEI-STOCK-APP
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
# Required
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>

# Required — comma-separated list of "username:password" pairs
# First entry is the admin account, remaining entries are shop accounts
USERS=admin:yourpassword,shop1:shop1pass,shop2:shop2pass

# Optional — shop names shown in the UI (comma-separated, same order as non-admin USERS)
SHOPS=Main Street,City Centre

# Optional — trust proxy setting for deployments behind a reverse proxy
# Accepts: true | false | <integer>  (defaults to 1 in production)
TRUST_PROXY=1
```

### 4. Run the server

```bash
node server.js
```

The app is served at **http://localhost:3000** by default. Set `PORT` to override.

---

## Deployment (Render)

1. Create a new **Web Service** pointing to this repository.
2. Set the **Start Command** to `node server.js`.
3. Add the environment variables (`MONGO_URI`, `USERS`, `SHOPS`) in the Render dashboard.
4. Render injects `NODE_ENV=production` automatically, which sets `trust proxy = 1`.

---

## Environment Variables Reference

| Variable      | Required | Description |
|---------------|----------|-------------|
| `MONGO_URI`   | Yes      | MongoDB connection string |
| `USERS`       | Yes      | Comma-separated `user:pass` pairs. First user is admin. |
| `SHOPS`       | No       | Display names for non-admin shop users (same order) |
| `PORT`        | No       | HTTP port (default: `3000`) |
| `TRUST_PROXY` | No       | Express trust-proxy setting (`true`/`false`/integer) |

---

## API Overview

All endpoints are under `/api/`. Most require a bearer token obtained from `POST /api/auth`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth` | — | Login; returns bearer token |
| GET | `/api/stock` | Any | List phones in stock |
| POST | `/api/stock/add` | Any | Add a phone |
| POST | `/api/stock/sell` | Any | Sell a phone |
| PUT | `/api/stock/:id` | Admin | Edit a phone |
| DELETE | `/api/stock/:id` | Admin | Delete a phone |
| GET | `/api/sales` | Admin | List all sales |
| DELETE | `/api/sales/:id` | Admin | Undo a sale |
| GET | `/api/stats` | Any | Sales stats |
| GET/PUT | `/api/days/:shop/:date` | Admin | Daily summaries |
| GET/POST/DELETE | `/api/shopexpenses` | Admin | Shop expenses |
| GET/PUT | `/api/hqstock` | Admin | HQ stock |
| GET/POST | `/api/shipments` | Admin | Shipments |
| GET/POST | `/api/dispatches` | Admin | Dispatches |
| GET/POST/PUT/DELETE | `/api/customers` | Admin | Customer management |
| GET | `/api/analytics/models` | Admin | Model analytics |
| GET | `/api/ceo/summary` | Admin | CEO summary |
| POST | `/api/reports/generate` | Admin | Generate report |
| GET/DELETE | `/api/reports` | Admin | List/delete reports |
| GET | `/api/backup` | Admin | Full data backup |
| POST | `/api/restore` | Admin | Restore from backup |
| GET | `/api/logs` | Admin | Activity logs |

---

## Project Structure

```
IMEI-STOCK-APP/
├── server.js          # Express server, Mongoose models, all API routes
├── public/
│   └── index.html     # Single-page frontend (vanilla JS)
├── package.json
└── .env               # Not committed — create locally
```

---

## License

ISC
