# 📱 PhoneStock — IMEI Stock Manager

A multi-shop phone inventory management system for mobile retailers. Manage stock, record sales, track expenses, and oversee HQ operations — all from a local or hosted server, accessible on any device.

---

## 📷 Enable Camera (HTTPS Setup) — Do This First

Phone browsers block camera access over plain HTTP. Run the cert setup **once** and camera scanning works forever.

### Windows
```
setup-certs-windows.bat
```

### Mac / Linux
```
chmod +x setup-certs-mac-linux.sh
./setup-certs-mac-linux.sh
```

After setup, run `node server.js` and open the **HTTPS URL** on your phone:
```
https://192.168.1.X:3443
```
On first visit your browser warns about the certificate — tap **Advanced → Proceed**. This is normal for local self-signed certs and safe on your own network. You only do this once per device.

---

## 🚀 Setup (One Time)

### 1. Install Node.js
Download from: https://nodejs.org (LTS version)

### 2. Install dependencies
```
npm install
```

### 3. Configure environment variables

Create a `.env` file (or set these variables in your shell/hosting platform):

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | *(required)* | MongoDB connection string |
| `PORT` | `3000` | HTTP server port |
| `GATE_PASSWORD` | `mobworld` | Entry-level password for shop users |
| `ADMIN_PASSWORD` | `anasanas` | Admin full-access password |
| `TRUST_PROXY` | auto | Proxy trust level (`true` / `false` / integer) |

> ⚠️ **Change the default passwords** before running in any shared or hosted environment.

---

## ▶️ Running the App

```
node server.js
```

You'll see output like:
```
✅ MongoDB connected
🚀 Server running on port 3000
```

Open the network URL on any device connected to the same network.

---

## 📡 Multi-Device Access

All devices must be able to reach the server (same WiFi, or hosted publicly).

| Device | URL to open |
|--------|-------------|
| Host PC | http://localhost:3000 |
| Other PC / Phone / Tablet | http://192.168.1.X:3000 |

Replace `192.168.1.X` with your server's IP address.

---

## 🔐 Authentication & Roles

The app has two access levels, protected by token-based authentication (8-hour sessions):

| Role | Access |
|------|--------|
| **Admin** | Full access: all shops, edit/delete inventory, sales history, daily sheets, expenses, HQ stock, shipments, dispatches, backup/restore |
| **Shop** | Scoped to own shop: add stock, sell phones, view own inventory and stats |

**Login flow:**
1. All users enter the **Gate Password** first
2. Admin users then enter the **Admin Password**
3. Shop users select their shop — the gate password is their shop login

Sessions are stored in memory and expire after 8 hours. Tokens are cryptographically random (32-byte hex). The auth endpoint is rate-limited to 10 attempts per 15 minutes per IP.

---

## 🔍 IMEI Scanning

### Option A: USB/Bluetooth Barcode Scanner (Recommended)
- Plug in your barcode scanner
- Click in the IMEI field
- Scan the barcode — it types the number and auto-submits
- Works on PC and phone browsers

### Option B: Phone Camera
- Tap the 📷 button
- Point at the barcode
- Uses the native BarcodeDetector API (Chrome/Edge on Android) with ZXing.js fallback
- In sell mode, a successful scan auto-submits immediately
- Best rear camera is automatically selected (scored post-enumerate for iOS 17/18 compatibility)

### Option C: Manual Entry
- Type the 15-digit IMEI number
- Press Enter or tap Go

---

## 📦 Features

### Inventory Management
- **Add to stock** — Scan or type IMEI, record brand, model, color, storage, buy price, secondary IMEI, category, and notes
- **Dual IMEI support** — Store both IMEI 1 and IMEI 2 for dual-SIM devices
- **Edit phone details** — Admin can update any field or reassign a phone to a different shop
- **Delete phone** — Admin can remove a phone record entirely
- **Stock list** — Filter by status (in stock / sold), search by IMEI or model
- **Shop scoping** — Shop users only see and interact with their own shop's inventory

### Sales
- **Record a sale** — Scan IMEI in sell mode, enter sale price, optional buyer name and notes
- **Automatic profit/loss** — Calculated from buy vs. sale price on every transaction
- **Sales history** — Full list of all transactions with profit breakdown (admin only)
- **Undo a sale** — Delete an individual sale record; phone automatically reverts to in-stock
- **Bulk clear sales** — Clear all sales for a shop or globally; all phones reverted to in-stock

### Dashboard & Stats
- **Live stats bar** — In-stock count, sold count, total revenue, auto-refreshes every 10 seconds
- **Per-shop stats** — Shop users see only their own numbers; admin sees all

### Daily Sheet (Admin)
- **Daily cash records** — Log income categories, cash expenses, purchases, and transfers per shop per day
- **Carry-forward balance** — Track opening cash balance rolled over between days
- **Monthly view** — Filter daily sheets by shop and month

### Shop Expenses (Admin)
- **Categorised expenses** — Record recurring or one-off shop expenses with date, category, and description
- **Monthly filter** — View expenses by shop and month
- **Delete entries** — Remove incorrect expense records

### HQ Stock (Admin)
- **Central warehouse** — Maintain a list of items held at headquarters before dispatch to shops
- **Live update** — HQ stock is a single shared document, updated in place

### Shipments & Dispatches (Admin)
- **Inbound shipments** — Record supplier name, reference, date, and item list for incoming stock
- **Outbound dispatches** — Record date, destination shop, notes, and item list for stock sent to shops
- **Full history** — All shipments and dispatches listed chronologically

### Backup & Restore (Admin)
- **Full JSON backup** — Export all data (phones, sales, daily sheets, expenses, HQ stock, shipments, dispatches) as a single JSON file
- **Restore from backup** — Upload a backup file to upsert all records back into the database (non-destructive, 50 MB limit)

---

## 💾 Data Storage

All data is stored in **MongoDB**. Configure the connection string via the `MONGO_URI` environment variable (e.g., MongoDB Atlas or a self-hosted instance).

Use the built-in **Backup** feature (Admin → Backup) to download a full JSON export regularly. The restore endpoint can re-import it without wiping existing data.

---

## 🏪 Shops

The app ships with three pre-configured shop IDs: **456**, **192**, and **G15**, plus the **HQ** used for warehouse operations. Shop names are currently defined in the server source — see `server.js` line 207 to change them.
