const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

// ── ROUTES ─────────────────────────────────────

// Get stock
app.get('/api/stock', async (req, res) => {
  const items = await Phone.find();
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
    if (Number.isNaN(sp)) return res.status(400).json({ error: 'Invalid salePrice' });

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

    await sale.save();

    // Return the saved sale so frontend can consume it immediately
    res.json({ success: true, sale });
  } catch (err) {
    console.error('Sell endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sales
app.get('/api/sales', async (req, res) => {
  const sales = await Sale.find();
  res.json(sales);
});

// Stats
app.get('/api/stats', async (req, res) => {
  const stock = await Phone.find();
  const sales = await Sale.find();

  res.json({
    inStock: stock.filter(p => p.status === 'in_stock').length,
    sold: stock.filter(p => p.status === 'sold').length,
    total: stock.length,
    totalRevenue: sales.reduce((s, x) => s + (x.salePrice || 0), 0),
    salesCount: sales.length
  });
});

// Delete phone
app.delete('/api/stock/:id', async (req, res) => {
  await Phone.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ── START SERVER ───────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
