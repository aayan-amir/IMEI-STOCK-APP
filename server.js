const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000; // ✅ FIXED

const DB_FILE = path.join(__dirname, 'data', 'stock.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DB Setup ─────────────────────────────────────────
function initDB() {
  return {
    stock: [], sales: [],
    shops: {}, days: {},
    shopExpenses: [], dispatches: [],
    inboundShipments: [],
    hqStock: { items: [] },
    g15debt: [],
  };
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = initDB();
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const def = initDB();
    Object.keys(def).forEach(k => { if (raw[k] === undefined) raw[k] = def[k]; });
    return raw;
  } catch(e) { return initDB(); }
}

function saveDB(data) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ── API ROUTES (UNCHANGED) ─────────────────────────
// (keeping your logic same)

app.get('/api/stock', (req, res) => {
  const db = loadDB();
  let items = db.stock;
  if (req.query.shop) items = items.filter(p => p.shop === req.query.shop);
  res.json(items);
});

app.get('/api/sales', (req, res) => {
  const db = loadDB();
  let items = db.sales;
  if (req.query.shop) items = items.filter(s => s.shop === req.query.shop);
  res.json(items);
});

app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const sh = req.query.shop;
  let st = db.stock, sa = db.sales;
  if (sh) { st = st.filter(p => p.shop === sh); sa = sa.filter(s => s.shop === sh); }
  res.json({
    inStock: st.filter(p => p.status === 'in_stock').length,
    sold: st.filter(p => p.status === 'sold').length,
    total: st.length,
    totalRevenue: sa.reduce((s, x) => s + (x.salePrice || 0), 0),
    salesCount: sa.length
  });
});

app.post('/api/stock/add', (req, res) => {
  const { imei, imei2, cat, brand, model, color, storage, buyPrice, notes, shop } = req.body;
  if (!imei) return res.status(400).json({ error: 'IMEI required' });

  const db = loadDB();

  const exists = db.stock.find(p =>
    p.imei === imei ||
    (imei2 && p.imei === imei2) ||
    (p.imei2 && p.imei2 === imei)
  );

  if (exists) return res.status(409).json({ error: 'IMEI already exists', phone: exists });

  const phone = {
    id: Date.now().toString(),
    imei,
    imei2: imei2 || '',
    cat: cat || '',
    brand: brand || '',
    model: model || '',
    color: color || '',
    storage: storage || '',
    buyPrice: buyPrice ? parseFloat(buyPrice) : null,
    notes: notes || '',
    status: 'in_stock',
    shop: shop || null,
    addedAt: new Date().toISOString()
  };

  db.stock.push(phone);
  saveDB(db);

  res.json({ success: true, phone });
});

app.post('/api/stock/sell', (req, res) => {
  const { imei, salePrice, buyerName, notes, shop } = req.body;
  if (!imei) return res.status(400).json({ error: 'IMEI required' });

  const db = loadDB();
  const phone = db.stock.find(p => p.imei === imei || p.imei2 === imei);

  if (!phone) return res.status(404).json({ error: 'Not found' });
  if (phone.status === 'sold') return res.status(409).json({ error: 'Already sold' });

  phone.status = 'sold';
  phone.soldAt = new Date().toISOString();
  phone.salePrice = salePrice ? parseFloat(salePrice) : null;

  const sale = {
    id: Date.now().toString(),
    imei: phone.imei,
    imei2: phone.imei2 || '',
    brand: phone.brand,
    model: phone.model,
    color: phone.color,
    storage: phone.storage,
    buyPrice: phone.buyPrice,
    salePrice: salePrice ? parseFloat(salePrice) : null,
    profit: (salePrice && phone.buyPrice) ? parseFloat(salePrice) - phone.buyPrice : null,
    buyerName: buyerName || '',
    notes: notes || '',
    shop: shop || phone.shop || null,
    soldAt: phone.soldAt
  };

  db.sales.push(sale);
  saveDB(db);

  res.json({ success: true, phone, sale });
});

// ── SERVER START (FIXED) ─────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});