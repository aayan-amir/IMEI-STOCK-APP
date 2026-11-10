'use strict';

const express = require('express');
const router = express.Router();
const { Client, mongoose } = require('../db');
const { safeCompare, createSession, deleteSession, anyAuth, adminOnly, authLimiter, superAdminLimiter, SUPER_ADMIN_PASSWORD } = require('../middleware/auth');

router.get('/capabilities', anyAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const owner = req.authRole === 'admin';
  res.json({ version: 1, backupVersions: [2, 3], features: {
    imeiHistory: owner, saleReceipts: owner, stocktake: owner && req.app.locals.stocktakesEnabled === true,
    fullyPaidTender: req.app.locals.fullyPaidSalesEnabled === true, customerReturns: owner && req.app.locals.customerReturnsEnabled === true, verifiedCashClose: owner && req.app.locals.verifiedCashEnabled === true,
  } });
});

// ── Public: lookup a client's shops ───────────────────────────────────────
router.get('/clients/lookup', async (req, res) => {
  const clientId = String(req.query.clientId || '');
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  try {
    const client = await Client.findOne({ clientId });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status === 'paused') return res.status(403).json({ error: 'Account paused' });
    res.json({ shops: client.shops || [] });
  } catch (err) {
    console.error('Lookup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Auth ───────────────────────────────────────────────────────────────────
router.post('/auth', authLimiter, async (req, res) => {
  const { type, password, shop } = req.body || {};
  const clientId = String((req.body || {}).clientId || '');
  console.log(`🔑 Auth Attempt: ${clientId} | Type: ${type} | Shop: ${shop}`);

  if (!clientId) return res.status(400).json({ error: 'Client ID required' });
  if (typeof password !== 'string' || !password || !['gate', 'admin', 'shop'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'Valid login type and password required' });
  }

  try {
    const client = await Client.findOne({ clientId });
    if (!client) {
      console.log(`❌ Auth Failed: Client "${clientId}" not found`);
      return res.status(404).json({ error: 'Client not found' });
    }
    if (client.status === 'paused') return res.status(403).json({ error: 'Account paused' });

    const validShops = (client.shops || []).map(s => s.id);

    if (type === 'gate') {
      const isOk = await client.compareGatePassword(password);
      if (!isOk) console.log(`❌ Auth Failed: Gate password mismatch for ${clientId}`);
      else       console.log(`✅ Auth Success: Gate password verified for ${clientId}`);
      return res.status(isOk ? 200 : 401).json({ ok: isOk });
    }

    if (type === 'admin') {
      const isOk = await client.compareAdminPassword(password);
      if (!isOk) {
        console.log(`❌ Auth Failed: Admin password mismatch for ${clientId}`);
        return res.status(401).json({ ok: false });
      }
      const token = await createSession({ role: 'admin', shop: null, clientId, validShops, authVersion: client.authVersion });
      console.log(`✅ Auth Success: Admin logged in for ${clientId}`);
      return res.json({ ok: true, token, role: 'admin', shops: client.shops });
    }

    if (type === 'shop') {
      const isOk = await client.compareGatePassword(password);
      if (!isOk) {
        console.log(`❌ Auth Failed: Shop gate password mismatch for ${clientId}`);
        return res.status(401).json({ ok: false });
      }
      if (!validShops.includes(shop)) {
        console.log(`❌ Auth Failed: Invalid shop "${shop}" for client ${clientId}`);
        return res.status(400).json({ ok: false, error: 'Invalid shop' });
      }
      const token = await createSession({ role: 'shop', shop, clientId, validShops, authVersion: client.authVersion });
      console.log(`✅ Auth Success: Shop "${shop}" logged in for ${clientId}`);
      return res.json({ ok: true, token, role: 'shop', shop, shops: client.shops });
    }

    return res.status(400).json({ ok: false });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: update own passwords ───────────────────────────────────────────
router.post('/auth/logout', anyAuth, async (req, res) => {
  await deleteSession(req.session.token);
  res.json({ success: true });
});
router.put('/auth/password', authLimiter, adminOnly, async (req, res) => {
  const { currentPassword, newAdminPassword, newGatePassword } = req.body || {};
  const clientId = req.session ? req.session.clientId : null;
  
  if (!clientId) return res.status(400).json({ error: 'Not authenticated' });

  try {
    const client = await Client.findOne({ clientId });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    // Verify current admin password
    const isOk = await client.compareAdminPassword(currentPassword);
    if (!isOk) return res.status(403).json({ error: 'Incorrect current admin password' });

    // Update passwords
    if (newAdminPassword) client.adminPassword = newAdminPassword;
    if (newGatePassword) client.gatePassword = newGatePassword;
    
    await client.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Update password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Super Admin: verify password ───────────────────────────────────────────
router.post('/superadmin/verify', superAdminLimiter, (req, res) => {
  const { superAdminPassword } = req.body || {};
  if (safeCompare(superAdminPassword, SUPER_ADMIN_PASSWORD)) {
    return res.json({ ok: true });
  }
  return res.status(403).json({ ok: false });
});

router.post('/superadmin/clients/:clientId/status', superAdminLimiter, async (req, res) => {
  const { HttpError } = require('../utils/http-error');
  const { superAdminPassword, expectedStatus, status } = req.body || {};
  if (!safeCompare(superAdminPassword, SUPER_ADMIN_PASSWORD)) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(req.params.clientId) || !['active', 'paused'].includes(expectedStatus) || !['active', 'paused'].includes(status)) throw new HttpError(400, 'Invalid account status', 'INVALID_INPUT');
  const client = await Client.findOneAndUpdate({ clientId: req.params.clientId, status: expectedStatus },
    { $set: { status, authVersion: require('node:crypto').randomUUID() } }, { returnDocument: 'after' });
  if (!client) throw new HttpError(409, 'Account status changed or the account is unavailable. Refresh the list.', 'CLIENT_STATUS_CONFLICT');
  res.json({ success: true, client: { clientId: client.clientId, status: client.status } });
});

// ── Super Admin: create / update client ───────────────────────────────────
router.post('/superadmin/clients', superAdminLimiter, async (req, res) => {
  const { superAdminPassword, clientId, adminPassword, gatePassword, shops, status } = req.body || {};
  if (!safeCompare(superAdminPassword, SUPER_ADMIN_PASSWORD)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const existing = await Client.findOne({ clientId: String(clientId) });
    if (existing) {
      existing.adminPassword = adminPassword || existing.adminPassword;
      existing.gatePassword  = gatePassword  || existing.gatePassword;
      existing.shops         = shops         || existing.shops;
      existing.status        = status        || existing.status;
      await existing.save();
      return res.json({ success: true, client: { clientId: existing.clientId, shops: existing.shops, status: existing.status } });
    }
    const client = new Client({ clientId, adminPassword, gatePassword, shops, status: status || 'active' });
    await client.save();
    res.json({ success: true, client: { clientId: client.clientId, shops: client.shops, status: client.status } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Super Admin: list clients ──────────────────────────────────────────────
// Accept the super admin password in the X-Super-Admin-Password header only.
// Using a header avoids logging the password in server access logs or browser history.
router.get('/superadmin/clients', superAdminLimiter, async (req, res) => {
  const superAdminPassword = req.headers['x-super-admin-password'];
  if (!safeCompare(superAdminPassword, SUPER_ADMIN_PASSWORD)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const clients = await Client.find({}, { adminPassword: 0, gatePassword: 0 });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Super Admin: delete client ─────────────────────────────────────────────
router.delete('/superadmin/clients/:clientId', superAdminLimiter, async (req, res) => {
  const { superAdminPassword } = req.body || {};
  if (!safeCompare(superAdminPassword, SUPER_ADMIN_PASSWORD)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { clientId } = req.params;
    await Client.findOneAndDelete({ clientId });
    // Also drop the tenant database
    const db = mongoose.connection.useDb(`tenant_${clientId}`);
    await db.dropDatabase();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
