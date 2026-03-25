const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 3000;
const HTTPS_PORT = 3443;
const DB_FILE = path.join(__dirname, 'data', 'stock.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// ── IMEI Stock ────────────────────────────────────────────────────────────────
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
  const exists = db.stock.find(p => p.imei === imei || (imei2 && p.imei === imei2) || (p.imei2 && p.imei2 === imei));
  if (exists) return res.status(409).json({ error: `IMEI already exists`, phone: exists });
  const phone = {
    id: Date.now().toString(), imei,
    imei2: imei2||'',
    cat: cat||'',
    brand: brand||'', model: model||'', color: color||'', storage: storage||'',
    buyPrice: buyPrice ? parseFloat(buyPrice) : null,
    notes: notes||'', status: 'in_stock',
    shop: shop||null, addedAt: new Date().toISOString()
  };
  db.stock.push(phone);
  saveDB(db);
  res.json({ success: true, phone });
});
app.post('/api/stock/sell', (req, res) => {
  const { imei, salePrice, buyerName, notes, shop } = req.body;
  if (!imei) return res.status(400).json({ error: 'IMEI required' });
  const db = loadDB();
  // Search by IMEI 1 or IMEI 2
  const phone = db.stock.find(p => p.imei === imei || p.imei2 === imei);
  if (!phone) return res.status(404).json({ error: `IMEI ${imei} not found` });
  if (phone.status === 'sold') return res.status(409).json({ error: 'Already sold', phone });
  phone.status = 'sold';
  phone.soldAt = new Date().toISOString();
  phone.salePrice = salePrice ? parseFloat(salePrice) : null;
  const sale = {
    id: Date.now().toString(),
    imei: phone.imei, imei2: phone.imei2||'',
    brand: phone.brand, model: phone.model, color: phone.color, storage: phone.storage,
    buyPrice: phone.buyPrice,
    salePrice: salePrice ? parseFloat(salePrice) : null,
    profit: (salePrice && phone.buyPrice) ? parseFloat(salePrice) - phone.buyPrice : null,
    buyerName: buyerName||'', notes: notes||'',
    shop: shop||phone.shop||null, soldAt: phone.soldAt
  };
  db.sales.push(sale);
  saveDB(db);
  res.json({ success: true, phone, sale });
});
// PUT update phone details
app.put('/api/stock/:id', (req, res) => {
  const db = loadDB();
  const phone = db.stock.find(p => p.id === req.params.id);
  if (!phone) return res.status(404).json({ error: 'Not found' });
  const fields = ['brand','model','color','storage','notes','imei2','cat'];
  fields.forEach(f => { if (req.body[f] !== undefined) phone[f] = req.body[f]; });
  if (req.body.buyPrice !== undefined) phone.buyPrice = req.body.buyPrice ? parseFloat(req.body.buyPrice) : null;
  saveDB(db);
  res.json({ success: true, phone });
});
app.delete('/api/stock/:id', (req, res) => {
  const db = loadDB();
  const idx = db.stock.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.stock.splice(idx, 1);
  saveDB(db);
  res.json({ success: true });
});
app.get('/api/lookup/:imei', (req, res) => {
  const db = loadDB();
  const imei = req.params.imei;
  const phone = db.stock.find(p => p.imei === imei || p.imei2 === imei);
  if (!phone) return res.status(404).json({ error: 'Not found' });
  res.json(phone);
});

// ── Daily sheets ──────────────────────────────────────────────────────────────
app.get('/api/days', (req, res) => {
  const db = loadDB();
  let days = Object.values(db.days);
  if (req.query.shop) days = days.filter(d => d.shop === req.query.shop);
  if (req.query.month) days = days.filter(d => d.date && d.date.startsWith(req.query.month));
  days.sort((a,b) => b.date.localeCompare(a.date));
  res.json(days);
});
app.get('/api/days/:shop/:date', (req, res) => {
  const db = loadDB();
  res.json(db.days[`${req.params.shop}_${req.params.date}`] || null);
});
app.put('/api/days/:shop/:date', (req, res) => {
  const db = loadDB();
  const key = `${req.params.shop}_${req.params.date}`;
  db.days[key] = { ...req.body, _key: key, shop: req.params.shop, date: req.params.date };
  saveDB(db);
  res.json({ success: true });
});

// ── Shop master stock ─────────────────────────────────────────────────────────
app.get('/api/shopstock/:shop', (req, res) => {
  const db = loadDB();
  res.json(db.shops[req.params.shop] || null);
});
app.put('/api/shopstock/:shop', (req, res) => {
  const db = loadDB();
  db.shops[req.params.shop] = { ...req.body, shop: req.params.shop };
  saveDB(db);
  res.json({ success: true });
});

// ── Shop expenses ─────────────────────────────────────────────────────────────
app.get('/api/shopexpenses', (req, res) => {
  const db = loadDB();
  let exp = db.shopExpenses;
  if (req.query.shop) exp = exp.filter(e => e.shop === req.query.shop);
  if (req.query.month) exp = exp.filter(e => e.month === req.query.month);
  res.json(exp);
});
app.post('/api/shopexpenses', (req, res) => {
  const db = loadDB();
  const exp = { ...req.body, _key: `EXP_${Date.now()}` };
  db.shopExpenses.push(exp);
  saveDB(db);
  res.json({ success: true, expense: exp });
});
app.delete('/api/shopexpenses/:key', (req, res) => {
  const db = loadDB();
  db.shopExpenses = db.shopExpenses.filter(e => e._key !== req.params.key);
  saveDB(db);
  res.json({ success: true });
});

// ── HQ Warehouse ──────────────────────────────────────────────────────────────
app.get('/api/hqstock', (req, res) => { res.json(loadDB().hqStock || { items: [] }); });
app.put('/api/hqstock', (req, res) => {
  const db = loadDB();
  db.hqStock = req.body;
  saveDB(db);
  res.json({ success: true });
});

// ── Dispatches ────────────────────────────────────────────────────────────────
app.get('/api/dispatches', (req, res) => { res.json(loadDB().dispatches || []); });
app.post('/api/dispatches', (req, res) => {
  const db = loadDB();
  const d = { ...req.body, _key: `DISP_${Date.now()}` };
  db.dispatches.push(d);
  saveDB(db);
  res.json({ success: true, dispatch: d });
});

// ── Inbound Shipments ─────────────────────────────────────────────────────────
app.get('/api/shipments', (req, res) => { res.json(loadDB().inboundShipments || []); });
app.post('/api/shipments', (req, res) => {
  const db = loadDB();
  const s = { ...req.body, _key: `SHIP_${Date.now()}` };
  db.inboundShipments.push(s);
  saveDB(db);
  res.json({ success: true, shipment: s });
});
app.delete('/api/shipments/:key', (req, res) => {
  const db = loadDB();
  db.inboundShipments = db.inboundShipments.filter(s => s._key !== req.params.key);
  saveDB(db);
  res.json({ success: true });
});

// ── G15 Debt ──────────────────────────────────────────────────────────────────
app.get('/api/g15debt', (req, res) => { res.json(loadDB().g15debt || []); });
app.post('/api/g15debt', (req, res) => {
  const db = loadDB();
  const e = { ...req.body, _key: `G15_${Date.now()}` };
  db.g15debt.push(e);
  saveDB(db);
  res.json({ success: true, entry: e });
});

// ── Backup / Restore ──────────────────────────────────────────────────────────
app.get('/api/backup', (req, res) => {
  const db = loadDB();
  res.setHeader('Content-Disposition', `attachment; filename="MobileHQ_${new Date().toISOString().slice(0,10)}.json"`);
  res.json({ v: 2, saved: new Date().toISOString(), ...db });
});
app.post('/api/restore', (req, res) => {
  try {
    const data = req.body;
    const db = loadDB();
    ['stock','sales','shops','days','shopExpenses','dispatches','inboundShipments','hqStock','g15debt']
      .forEach(k => { if (data[k] !== undefined) db[k] = data[k]; });
    saveDB(db);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Server startup ────────────────────────────────────────────────────────────
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
  return ips;
}

function printUrls(httpsOk) {
  const ips = getLocalIPs();
  console.log('\n✅ Mobile HQ — Stock Manager is running!\n');
  if (httpsOk) {
    console.log(`  Local (HTTPS):   https://localhost:${HTTPS_PORT}`);
    console.log(`  Local (HTTP):    http://localhost:${PORT}`);
    ips.forEach(ip => {
      console.log(`  Network (HTTPS): https://${ip}:${HTTPS_PORT}  ← Open on phone`);
    });
    console.log('\n  First HTTPS visit: tap Advanced → Proceed to accept self-signed cert.\n');
  } else {
    console.log(`  Local:   http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`  Network: http://${ip}:${PORT}  ← Open on phone`));
    console.log('\n  Camera needs HTTPS — run setup-certs first.\n');
  }
  console.log('Press Ctrl+C to stop.\n');
}

http.createServer(app).listen(PORT, '0.0.0.0');

const certFile = path.join(__dirname, 'certs', 'cert.pem');
const keyFile  = path.join(__dirname, 'certs', 'key.pem');
if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  const opts = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  https.createServer(opts, app).listen(HTTPS_PORT, '0.0.0.0', () => printUrls(true));
} else {
  printUrls(false);
}
