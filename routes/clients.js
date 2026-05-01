'use strict';

const express = require('express');
const router = express.Router();
const { Client, mongoose } = require('../db');
const { safeCompare, createSession, authLimiter, SUPER_ADMIN_PASSWORD } = require('../middleware/auth');

// ── Public: lookup a client's shops ───────────────────────────────────────
router.get('/clients/lookup', async (req, res) => {
  const { clientId } = req.query;
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
  const { type, password, shop, clientId } = req.body || {};
  console.log(`🔑 Auth Attempt: ${clientId} | Type: ${type} | Shop: ${shop}`);

  if (!clientId) return res.status(400).json({ error: 'Client ID required' });

  try {
    const client = await Client.findOne({ clientId });
    if (!client) {
      console.log(`❌ Auth Failed: Client "${clientId}" not found`);
      return res.status(404).json({ error: 'Client not found' });
    }
    if (client.status === 'paused') return res.status(403).json({ error: 'Account paused' });

    const gatePass  = client.gatePassword;
    const adminPass = client.adminPassword;
    const validShops = (client.shops || []).map(s => s.id);

    if (type === 'gate') {
      const isOk = safeCompare(password, gatePass);
      if (!isOk) console.log(`❌ Auth Failed: Gate password mismatch for ${clientId}`);
      else       console.log(`✅ Auth Success: Gate password verified for ${clientId}`);
      return res.json({ ok: isOk });
    }

    if (type === 'admin') {
      if (!safeCompare(password, adminPass)) {
        console.log(`❌ Auth Failed: Admin password mismatch for ${clientId}`);
        return res.json({ ok: false });
      }
      const token = await createSession({ role: 'admin', shop: null, clientId, validShops });
      console.log(`✅ Auth Success: Admin logged in for ${clientId}`);
      return res.json({ ok: true, token, role: 'admin', shops: client.shops });
    }

    if (type === 'shop') {
      if (!safeCompare(password, gatePass)) {
        console.log(`❌ Auth Failed: Shop gate password mismatch for ${clientId}`);
        return res.json({ ok: false });
      }
      if (!validShops.includes(shop)) {
        console.log(`❌ Auth Failed: Invalid shop "${shop}" for client ${clientId}`);
        return res.status(400).json({ ok: false, error: 'Invalid shop' });
      }
      const token = await createSession({ role: 'shop', shop, clientId, validShops });
      console.log(`✅ Auth Success: Shop "${shop}" logged in for ${clientId}`);
      return res.json({ ok: true, token, role: 'shop', shop, shops: client.shops });
    }

    return res.status(400).json({ ok: false });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Super Admin: verify password ───────────────────────────────────────────
router.post('/superadmin/verify', (req, res) => {
  const { superAdminPassword } = req.body || {};
  if (safeCompare(superAdminPassword, SUPER_ADMIN_PASSWORD)) {
    return res.json({ ok: true });
  }
  return res.status(403).json({ ok: false });
});

// ── Super Admin: create / update client ───────────────────────────────────
router.post('/superadmin/clients', async (req, res) => {
  const { superAdminPassword, clientId, adminPassword, gatePassword, shops, status } = req.body || {};
  if (!safeCompare(superAdminPassword, SUPER_ADMIN_PASSWORD)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const existing = await Client.findOne({ clientId });
    if (existing) {
      existing.adminPassword = adminPassword || existing.adminPassword;
      existing.gatePassword  = gatePassword  || existing.gatePassword;
      existing.shops         = shops         || existing.shops;
      existing.status        = status        || existing.status;
      await existing.save();
      return res.json({ success: true, client: existing });
    }
    const client = new Client({ clientId, adminPassword, gatePassword, shops, status: status || 'active' });
    await client.save();
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Super Admin: list clients ──────────────────────────────────────────────
// Accept the super admin password in the X-Super-Admin-Password header (preferred) or
// fallback to the query string for backward compatibility. Using a header avoids logging
// the password in server access logs or browser history.
router.get('/superadmin/clients', async (req, res) => {
  const superAdminPassword = req.headers['x-super-admin-password'] || req.query.superAdminPassword;
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
router.delete('/superadmin/clients/:clientId', async (req, res) => {
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
