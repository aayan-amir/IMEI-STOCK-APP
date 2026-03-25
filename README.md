# 📱 PhoneStock — IMEI Stock Manager

A local network app for managing phone inventory using IMEI scanning.

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

---

## ▶️ Running the App

```
node server.js
```

You'll see output like:
```
✅ Phone Stock Manager is running!

  Local:   http://localhost:3000
  Network: http://192.168.1.5:3000  ← Open this on your phone
```

Open the **Network URL** on any device connected to the same WiFi.

---

## 📡 Multi-Device Access

All devices must be on the **same WiFi network**.

| Device | URL to open |
|--------|-------------|
| Host PC | http://localhost:3000 |
| Other PC | http://192.168.1.X:3000 |
| Phone/Tablet | http://192.168.1.X:3000 |

Replace `192.168.1.X` with the IP shown when you run `node server.js`.

---

## 🔍 IMEI Scanning

### Option A: USB/Bluetooth Barcode Scanner (Recommended)
- Plug in your barcode scanner
- Click in the IMEI field
- Scan the barcode — it types the number and hits Enter automatically
- Works on PC and phone browsers

### Option B: Phone Camera
- Click the 📷 button
- Point at the barcode
- Requires Chrome/Edge on Android (BarcodeDetector API)
- iPhone: type manually or use a hardware scanner

### Option C: Manual Entry
- Type the 15-digit IMEI number
- Press Enter or click Go

---

## 📦 Features

- **Add to Stock**: Scan IMEI → fill brand/model/color/storage/buy price
- **Record Sale**: Switch to Sell mode → scan IMEI → enter sale price
- **Stock List**: View all phones, filter by status, search
- **Sales History**: All sales with profit/loss calculation
- **Stats Bar**: Live count of in-stock, sold, total revenue
- **Multi-device sync**: Auto-refreshes stats every 10 seconds

---

## 💾 Data Storage

Data is stored in `data/stock.json` — a simple JSON file.
Back it up regularly by copying this file.

---

## 🔒 Keep on Same Network

This app has no password protection — only use on a trusted local network.
To add password protection, consider adding express-basic-auth.
