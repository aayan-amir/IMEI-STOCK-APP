const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const trustProxy = process.env.TRUST_PROXY;

if (trustProxy !== undefined) {
  if (trustProxy === 'true') app.set('trust proxy', true);
  else if (trustProxy === 'false') app.set('trust proxy', false);
  else {
    const parsed = Number(trustProxy);
    if (Number.isInteger(parsed) && parsed >= 0) {
      app.set('trust proxy', parsed);
    } else {
      console.warn(`Invalid TRUST_PROXY value "${trustProxy}", defaulting to trust proxy = 1`);
      app.set('trust proxy', 1);
    }
  }
} else if (process.env.NODE_ENV === 'production') {
  // Most hosted deployments (e.g., Render/Heroku) run behind one reverse proxy.
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting — 300 requests per minute per IP
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

// ── MongoDB Connection ─────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error(err));

// ── Schemas ────────────────────────────────────
const PhoneSchema = new mongoose.Schema({
  imei: String,
  imei2: String,
  brand: String,
  model: String,
  color: String,
  storage: String,
  buyPrice: Number,
  salePrice: Number,
  status: { type: String, default: 'in_stock' },
  shop: String,
  cat: String,
  notes: String,
  addedAt: String,
  soldAt: String
});

const SaleSchema = new mongoose.Schema({
  imei: String,
  brand: String,
  model: String,
  buyPrice: Number,
  salePrice: Number,
  profit: Number,
  shop: String,
  buyerName: String,
  notes: String,
  soldAt: String
});

const Phone = mongoose.model('Phone', PhoneSchema);
const Sale = mongoose.model('Sale', SaleSchema);

const DaySchema = new mongoose.Schema({
  shop: String,
  date: String,
  cats: mongoose.Schema.Types.Mixed,
  expenses: Array,
  purchases: Array,
  transfers: Array,
  carryForward: Number,
});
const Day = mongoose.model('Day', DaySchema);

const ShopExpenseSchema = new mongoose.Schema({
  shop: String,
  date: String,
  month: String,
  category: String,
  description: String,
  amount: Number,
  addedAt: String,
});
const ShopExpense = mongoose.model('ShopExpense', ShopExpenseSchema);

const HQStockSchema = new mongoose.Schema({
  key: { type: String, default: 'hq' },
  items: { type: Array, default: [] },
  updatedAt: String,
});
const HQStockModel = mongoose.model('HQStock', HQStockSchema);

const ShipmentSchema = new mongoose.Schema({
  date: String,
  supplier: String,
  ref: String,
  items: Array,
  addedAt: String,
});
const Shipment = mongoose.model('Shipment', ShipmentSchema);

const DispatchSchema = new mongoose.Schema({
  date: String,
  toShop: String,
  note: String,
  items: Array,
  addedAt: String,
});
const Dispatch = mongoose.model('Dispatch', DispatchSchema);

// ── ROUTES ─────────────────────────────────────

// Lookup single phone by IMEI (used by scan/sell flow)
app.get('/api/lookup/:imei', async (req, res) => {
  try {
    const phone = await Phone.findOne({ imei: req.params.imei });
    if (!phone) return res.json({});
    res.json(phone);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get stock
app.get('/api/stock', async (req, res) => {
  const shop = req.query.shop;
  const query = shop ? { shop } : {};
  const items = await Phone.find(query);
  res.json(items);
});

// Add stock
app.post('/api/stock/add', async (req, res) => {
  const { imei } = req.body;

  if (!imei) return res.status(400).json({ error: 'IMEI required' });

  const exists = await Phone.findOne({ imei });
  if (exists) return res.status(409).json({ error: 'IMEI exists' });

  const phone = new Phone({
    ...req.body,
    addedAt: new Date().toISOString()
  });

  await phone.save();
  res.json({ success: true, phone });
});

// Sell phone
app.post('/api/stock/sell', async (req, res) => {
  try {
    const { imei, salePrice, buyerName, notes, shop } = req.body;

    if (!imei) return res.status(400).json({ error: 'IMEI required' });
    if (salePrice === undefined || salePrice === null || salePrice === '') {
      return res.status(400).json({ error: 'salePrice required' });
    }

    const phone = await Phone.findOne({ imei });

    if (!phone) return res.status(404).json({ error: 'Not found' });
    if (phone.status === 'sold') return res.status(409).json({ error: 'Already sold' });

    const sp = Number(salePrice);
    if (Number.isNaN(sp) || sp <= 0) return res.status(400).json({ error: 'Sale price must be greater than zero' });

    const bp = Number(phone.buyPrice) || 0;
    const profit = sp - bp;

    phone.status = 'sold';
    phone.salePrice = sp;
    phone.soldAt = new Date().toISOString();
    if (shop !== undefined) phone.shop = shop;

    await phone.save();

    const sale = new Sale({
      imei: phone.imei,
      brand: phone.brand,
      model: phone.model,
      buyPrice: bp,
      salePrice: sp,
      profit: profit,
      shop: phone.shop,
      buyerName: buyerName || null,
      notes: notes || null,
      soldAt: phone.soldAt
    });

    try {
      await sale.save();
    } catch (saleErr) {
      // Revert phone to in_stock so data stays consistent
      phone.status = 'in_stock';
      phone.salePrice = undefined;
      phone.soldAt = undefined;
      await phone.save().catch(revertErr => console.error('Failed to revert phone after sale error:', revertErr));
      throw saleErr;
    }

    // Return the saved sale so frontend can consume it immediately
    res.json({ success: true, sale });
  } catch (err) {
    console.error('Sell endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sales
app.get('/api/sales', async (req, res) => {
  const shop = req.query.shop;
  const query = shop ? { shop } : {};
  const sales = await Sale.find(query);
  res.json(sales);
});

// Stats
app.get('/api/stats', async (req, res) => {
  const shop = req.query.shop;
  const query = shop ? { shop } : {};
  const stock = await Phone.find(query);
  const sales = await Sale.find(query);

  res.json({
    inStock: stock.filter(p => p.status === 'in_stock').length,
    sold: stock.filter(p => p.status === 'sold').length,
    total: stock.length,
    totalRevenue: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
    salesCount: sales.length
  });
});

// Edit phone
app.put('/api/stock/:id', async (req, res) => {
  try {
    const { brand, model, color, storage, buyPrice, imei2, cat, notes, shop } = req.body;
    const allowed = { brand, model, color, storage, buyPrice, imei2, cat, notes, shop };
    // Remove undefined fields so they are not overwritten
    Object.keys(allowed).forEach(k => allowed[k] === undefined && delete allowed[k]);
    const phone = await Phone.findByIdAndUpdate(req.params.id, allowed, { new: true });
    if (!phone) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, phone });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete phone
app.delete('/api/stock/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid phone id' });
    }
    await Phone.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DAILY SHEET ────────────────────────────────

// Get all daily sheets (?shop= and/or ?month= filters)
app.get('/api/days', async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = {};
    if (shop) query.shop = shop;
    if (month) query.date = { $regex: `^${month}` };
    const days = await Day.find(query).sort({ date: -1 });
    res.json(days);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific daily sheet
app.get('/api/days/:shop/:date', async (req, res) => {
  try {
    const day = await Day.findOne({ shop: req.params.shop, date: req.params.date });
    res.json(day || {});
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save/update daily sheet
app.put('/api/days/:shop/:date', async (req, res) => {
  try {
    const { shop, date } = req.params;
    const update = { ...req.body, shop, date };
    const day = await Day.findOneAndUpdate(
      { shop, date },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, day });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SHOP EXPENSES ───────────────────────────────

app.get('/api/shopexpenses', async (req, res) => {
  try {
    const { shop, month } = req.query;
    const query = {};
    if (shop) query.shop = shop;
    if (month) query.month = month;
    const expenses = await ShopExpense.find(query).sort({ date: -1 });
    res.json(expenses.map(e => ({ ...e.toObject(), _key: e.id })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/shopexpenses', async (req, res) => {
  try {
    const expense = new ShopExpense({ ...req.body, addedAt: new Date().toISOString() });
    await expense.save();
    res.json({ success: true, expense: { ...expense.toObject(), _key: expense.id } });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/shopexpenses/:id', async (req, res) => {
  try {
    await ShopExpense.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── HQ STOCK ────────────────────────────────────

app.get('/api/hqstock', async (req, res) => {
  try {
    const stock = await HQStockModel.findOne({ key: 'hq' });
    res.json(stock || { items: [] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/hqstock', async (req, res) => {
  try {
    const update = { ...req.body, key: 'hq', updatedAt: new Date().toISOString() };
    const stock = await HQStockModel.findOneAndUpdate(
      { key: 'hq' },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, stock });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── SHIPMENTS & DISPATCHES ──────────────────────

app.post('/api/shipments', async (req, res) => {
  try {
    const shipment = new Shipment({ ...req.body, addedAt: new Date().toISOString() });
    await shipment.save();
    res.json({ success: true, shipment });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/shipments', async (req, res) => {
  try {
    const shipments = await Shipment.find().sort({ date: -1 });
    res.json(shipments);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/dispatches', async (req, res) => {
  try {
    const dispatch = new Dispatch({ ...req.body, addedAt: new Date().toISOString() });
    await dispatch.save();
    res.json({ success: true, dispatch });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/dispatches', async (req, res) => {
  try {
    const dispatches = await Dispatch.find().sort({ date: -1 });
    res.json(dispatches);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── BULK DELETE SALES ────────────────────────────
// Deletes all sales (optionally filtered by ?shop=) and reverts phones to in_stock
app.delete('/api/sales', async (req, res) => {
  try {
    const { shop } = req.query;
    const query = shop ? { shop } : {};
    const sales = await Sale.find(query);
    if (sales.length === 0) return res.json({ success: true, deleted: 0 });

    // Revert all associated phones to in_stock in one bulk write
    const imeis = [...new Set(sales.map(s => s.imei).filter(Boolean))];
    if (imeis.length) {
      await Phone.updateMany(
        { imei: { $in: imeis } },
        { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
      );
    }

    const result = await Sale.deleteMany(query);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('Bulk delete sales error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE SALE ─────────────────────────────────
// Deletes a sale record and reverts the phone back to in_stock
app.delete('/api/sales/:id', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    // Revert the phone to in_stock
    await Phone.findOneAndUpdate(
      { imei: sale.imei },
      { $set: { status: 'in_stock' }, $unset: { salePrice: '', soldAt: '' } }
    );

    await Sale.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete sale error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── BACKUP & RESTORE ────────────────────────────

app.get('/api/backup', async (req, res) => {
  try {
    const [phones, sales, days, expenses, hqstock, shipments, dispatches] = await Promise.all([
      Phone.find({}),
      Sale.find({}),
      Day.find({}),
      ShopExpense.find({}),
      HQStockModel.findOne({ key: 'hq' }),
      Shipment.find({}),
      Dispatch.find({}),
    ]);
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      phones, sales, days, expenses,
      hqstock: hqstock || { items: [] },
      shipments, dispatches,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/restore', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { phones, sales, days, expenses, hqstock, shipments, dispatches } = req.body;
    if (phones?.length) {
      await Phone.bulkWrite(phones.map(p => ({
        updateOne: { filter: { imei: p.imei }, update: { $set: p }, upsert: true }
      })));
    }
    if (sales?.length) {
      // Use _id as the primary key for upsert if present, otherwise fall back to imei+soldAt
      await Sale.bulkWrite(sales.map(s => ({
        updateOne: {
          filter: s._id ? { _id: s._id } : { imei: s.imei, soldAt: s.soldAt },
          update: { $set: s },
          upsert: true
        }
      })));
    }
    if (days?.length) {
      await Day.bulkWrite(days.map(d => ({
        updateOne: { filter: { shop: d.shop, date: d.date }, update: { $set: d }, upsert: true }
      })));
    }
    if (expenses?.length) {
      await ShopExpense.insertMany(expenses, { ordered: false })
        .catch(err => console.error('Restore: some expenses skipped:', err.message));
    }
    if (hqstock) {
      await HQStockModel.findOneAndUpdate(
        { key: 'hq' },
        { ...hqstock, key: 'hq' },
        { upsert: true }
      );
    }
    if (shipments?.length) {
      await Shipment.insertMany(shipments, { ordered: false })
        .catch(err => console.error('Restore: some shipments skipped:', err.message));
    }
    if (dispatches?.length) {
      await Dispatch.insertMany(dispatches, { ordered: false })
        .catch(err => console.error('Restore: some dispatches skipped:', err.message));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

// ── START SERVER ───────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
