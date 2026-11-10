'use strict';

const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { parseMinorUnits } = require('../public/js/business-rules');

function invalid(message) { return new HttpError(400, message, 'INVALID_INPUT'); }
function conflict(message) { return new HttpError(409, message, 'PRODUCT_CONFLICT'); }
function quantity(value, signed = false) {
  if (!['number', 'string'].includes(typeof value) || !(signed ? /^-?\d+$/ : /^\d+$/).test(String(value))) throw invalid('Quantity must be a whole number');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw invalid('Quantity exceeds the supported range');
  return result;
}
function productName(value) {
  if (typeof value !== 'string') throw invalid('Product name is required');
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 150 || /[\u0000-\u001f\u007f]/u.test(name)) throw invalid('Product name must contain 1–150 printable characters');
  return { name, normalizedName: name.toLowerCase() };
}
function optionalNotes(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 2000) throw invalid('Notes must contain at most 2000 characters');
  return value.trim();
}
function price(value) {
  try {
    const minor = parseMinorUnits(value);
    if (parseMinorUnits(minor / 100) !== minor) throw Error('Unsupported precision');
    return minor / 100;
  } catch { throw invalid('Unit cost must be nonnegative PKR with at most two decimal places'); }
}
function normalize({ type, payload, actor, validShops, id }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('A product object is required');
  if (type !== 'add' && (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) throw invalid('Invalid product ID');
  const input = { type, id: id?.toLowerCase(), scope: actor.role === 'shop' ? actor.shop : null };
  if (type === 'add') {
    Object.assign(input, productName(payload.name));
    input.shop = actor.role === 'shop' ? actor.shop : payload.shop ?? null;
    if (input.shop !== null && !validShops.includes(input.shop)) throw invalid('Invalid shop');
    input.quantity = quantity(payload.quantity === undefined ? 0 : payload.quantity);
  } else if (type === 'update') {
    if (payload.quantity !== undefined && payload.adjustment !== undefined) throw invalid('Choose either an adjustment or an absolute quantity');
    if (payload.quantity !== undefined) input.quantity = quantity(payload.quantity);
    if (payload.adjustment !== undefined) input.adjustment = quantity(payload.adjustment, true);
    if (payload.name !== undefined) Object.assign(input, productName(payload.name));
  }
  if (type !== 'delete') {
    if (payload.buyPrice !== undefined) input.buyPrice = price(payload.buyPrice);
    const notes = optionalNotes(payload.notes);
    if (notes !== undefined) input.notes = notes;
  }
  if (payload.expectedRevision !== undefined) input.expectedRevision = quantity(payload.expectedRevision);
  return input;
}
function identity(shop, name) { return createHash('sha256').update(JSON.stringify([shop ?? null, name])).digest('hex'); }
async function lock(models, session, shop, names) {
  for (const key of [...new Set(names.map(name => identity(shop, name)))].sort()) {
    await models.ProductIdentity.updateOne({ _id: key }, { $inc: { version: 1 } }, { upsert: true, session });
  }
}
async function matchingProducts(models, session, shop, normalizedName) {
  // Legacy rows have no normalized field until their first accepted mutation.
  const candidates = await models.Product.find({ shop: shop ?? null,
    $or: [{ normalizedName }, { normalizedName: { $exists: false } }] }).session(session);
  return candidates.filter(item => productName(item.name).normalizedName === normalizedName);
}
function checkRevision(product, input) {
  if (input.expectedRevision === undefined) throw conflict('Reload this product and submit its revision before changing or deleting it.');
  if (input.expectedRevision !== (product.revision ?? 0)) throw conflict('This product changed since it was loaded. Reload before editing.');
}

function validOutcome(result, input) {
  try {
    if (!result || result.success !== true || Object.keys(result).some(key => !['success', 'product', 'merged'].includes(key))) return false;
    if (input.type === 'delete') return Object.keys(result).length === 1;
    const product = result.product;
    const fields = ['_id', '__v', 'name', 'normalizedName', 'revision', 'quantity', 'buyPrice', 'shop', 'notes', 'addedAt'];
    if (!product || Object.keys(product).some(key => !fields.includes(key)) || !/^[a-f0-9]{24}$/i.test(String(product._id))) return false;
    if (quantity(product.quantity) !== product.quantity || quantity(product.revision) !== product.revision) return false;
    if (price(product.buyPrice ?? 0) !== (product.buyPrice ?? 0)) return false;
    if (product.normalizedName !== productName(product.name).normalizedName) return false;
    if (input.scope && product.shop !== input.scope) return false;
    if (input.type === 'add') {
      if (typeof result.merged !== 'boolean' || (product.shop ?? null) !== input.shop || product.normalizedName !== input.normalizedName || product.quantity < input.quantity) return false;
    } else if (String(product._id) !== input.id || (input.quantity !== undefined && product.quantity !== input.quantity)) return false;
    return true;
  } catch { return false; }
}

async function mutateProduct({ connection, models, actor, validShops, type, payload = {}, id, operationId }) {
  const input = normalize({ type, payload, actor, validShops, id });
  if (operationId !== undefined && (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId))) throw invalid('Invalid request key');
  const fingerprint = createHash('sha256').update(JSON.stringify({ actor: { role: actor.role, shop: actor.shop ?? null }, input })).digest('hex');
  // An initial concurrent upsert of the identity lock can raise duplicate-key instead of a retryable write conflict.
  for (let attempt = 0; ; attempt++) {
    try {
      return await connection.transaction(async session => {
        if (operationId) {
          const previous = await models.ProductOperation.findById(operationId).session(session).lean();
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw conflict('This request key was already used for a different product operation.');
            if (!validOutcome(previous.result, input)) throw conflict('Saved product request history needs review before replay.');
            return previous.result;
          }
        }
        let product, merged = false, quantityBefore = 0;
        if (type === 'add') {
          await lock(models, session, input.shop, [input.normalizedName]);
          const matches = await matchingProducts(models, session, input.shop, input.normalizedName);
          if (matches.length > 1) throw conflict('Duplicate product names need review before quantities can change.');
          product = matches[0];
          if (product) {
            merged = true;
            if (input.buyPrice !== undefined && price(product.buyPrice ?? 0) !== input.buyPrice) throw conflict('Unit cost differs from the existing product. Use a separate product lot; its cost was not overwritten.');
            const current = quantity(product.quantity);
            quantityBefore = current;
            if (!Number.isSafeInteger(current + input.quantity)) throw conflict('Resulting quantity exceeds the supported range.');
            const update = { normalizedName: input.normalizedName };
            if (input.notes && !product.notes) update.notes = input.notes;
            product = await models.Product.findOneAndUpdate({ _id: product._id, quantity: current },
              { $inc: { quantity: input.quantity, revision: 1 }, $set: update }, { session, returnDocument: 'after' });
          } else {
            [product] = await models.Product.create([{ name: input.name, normalizedName: input.normalizedName,
              shop: input.shop, quantity: input.quantity, buyPrice: input.buyPrice ?? 0, notes: input.notes || undefined,
              revision: 0, addedAt: new Date().toISOString() }], { session });
          }
        } else {
          product = await models.Product.findOne({ _id: input.id, ...(actor.role === 'shop' ? { shop: actor.shop } : {}) }).session(session);
          if (!product) throw new HttpError(404, 'Product not found', 'NOT_FOUND');
          const currentName = productName(product.name).normalizedName;
          quantityBefore = quantity(product.quantity);
          await lock(models, session, product.shop, [currentName, input.normalizedName ?? currentName]);
          const matches = await matchingProducts(models, session, product.shop, input.normalizedName ?? currentName);
          if (matches.some(other => String(other._id) !== String(product._id))) throw conflict('Duplicate product names need review before quantities can change.');
          if (type === 'delete') {
            checkRevision(product, input);
            await models.Product.deleteOne({ _id: product._id }, { session });
          } else {
            if (input.adjustment === undefined || input.quantity !== undefined || input.name !== undefined || input.notes !== undefined || input.buyPrice !== undefined) checkRevision(product, input);
            if (input.buyPrice !== undefined && input.buyPrice !== price(product.buyPrice ?? 0)) throw conflict('Historical unit cost cannot be replaced. Use a separate product lot.');
            const current = quantity(product.quantity);
            const next = input.quantity ?? current + (input.adjustment ?? 0);
            if (!Number.isSafeInteger(next) || next < 0) throw conflict('Insufficient quantity or resulting quantity exceeds the supported range.');
            const update = { normalizedName: input.normalizedName ?? currentName };
            if (input.name !== undefined) update.name = input.name;
            if (input.notes !== undefined) update.notes = input.notes;
            product = await models.Product.findOneAndUpdate({ _id: product._id, quantity: current },
              { $inc: { quantity: next - current, revision: 1 }, $set: update }, { session, returnDocument: 'after' });
          }
        }
        if (!product) throw conflict('Product quantity changed. Reload and try again.');
        const result = type === 'delete' ? { success: true } : { success: true, product: product.toObject(), ...(type === 'add' ? { merged } : {}) };
        const quantityAfter = type === 'delete' ? 0 : product.quantity;
        await models.AuditLog.create([{ action: type === 'add' ? 'product_receive' : type === 'delete' ? 'product_delete' : 'product_adjust',
          role: actor.role, shop: product.shop, details: { productId: String(product._id), name: product.name,
            quantityBefore, quantityAfter, adjustment: quantityAfter - quantityBefore,
            revision: product.revision ?? 0, operationId } }], { session });
        if (operationId) await models.ProductOperation.create([{ _id: operationId, fingerprint, result }], { session });
        return result;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (error) {
      if (error.code === 11000 && attempt < 3) continue;
      if ([20, 303].includes(error.code)) throw new HttpError(503, 'Product inventory requires transaction support.', 'TRANSACTIONS_UNAVAILABLE');
      throw error;
    }
  }
}

module.exports = { mutateProduct, isProductOutcome: validOutcome };
