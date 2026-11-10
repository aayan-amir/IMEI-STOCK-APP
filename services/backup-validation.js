'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const db = require('../db');
const { parseMinorUnits, periodBounds, businessDate } = require('../public/js/business-rules');
const { saleEvents } = require('./sales-ledger');
const { isSaleSnapshot, sameSaleSnapshot } = require('./stock-sales');
const { isWarehouseOutcome } = require('./warehouse-operations');
const { isIntakeOperation } = require('./intake-evidence');
const { isProductOutcome } = require('./product-operations');
const { calculateDay, manualData, dayChecksum, isDayOutcome } = require('./day-service');
const { isRetainedReturn, isRetainedRefund, refundOutcome } = require('./return-evidence');
const { isCashEntry } = require('./cash-evidence');
const { cashFinancialManual } = require('./cash-financial');
const { isCashCheckpoint } = require('./cash-checkpoint-evidence');
const { normalizeCashSources } = require('./cash-sources');

const collectionNames = Object.freeze(['Phone', 'Sale', 'Day', 'StockOperation', 'ShopExpense', 'HQStock',
  'InventoryIdentity', 'InventoryOperation', 'Shipment', 'Dispatch', 'Customer', 'AuditLog', 'Report',
  'Product', 'ProductIdentity', 'ProductOperation', 'AccountingState', 'DayVersion', 'DayOperation']);
const MAX_RECORDS = 5000;
const allCollectionNames = Object.freeze([...collectionNames, 'Stocktake', 'CustomerReturn', 'CashEntry', 'CashCheckpoint']);
function namesForVersion(version) { return version === 2 ? collectionNames : version === 3 ? allCollectionNames : null; }
const MAX_BYTES = 8 * 1024 * 1024;
const excluded = ['masterClients', 'sessions', 'recoveryControl'];
const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const imei = value => typeof value === 'string' && /^\d{15}$/.test(value);
const canonicalName = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function checksum(document) {
  const content = { version: document.version, format: document.format, exportedAt: document.exportedAt,
    source: document.source, collections: document.collections, manifest: document.manifest };
  return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}
function instant(value) {
  try { return typeof value === 'string' && new Date(value).toISOString() === value; }
  catch { return false; }
}
function period(value, type = 'daily') {
  try { periodBounds(value, type); return true; } catch { return false; }
}
function money(value, signed = false) {
  try { return typeof value === 'number' && parseMinorUnits(value, { signed }) / 100 === value; } catch { return false; }
}
function safeJson(value, depth = 0) {
  if (depth > 32) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).every(([name, child]) => !['__proto__', 'constructor', 'prototype'].includes(name) && !name.startsWith('$') && safeJson(child, depth + 1));
}
function getModels(connection) {
  return Object.fromEntries(allCollectionNames.map(name => [name, connection.model(name, db[`${name}Schema`])]));
}

function validateBackup(document) {
  const collectionNames = namesForVersion(document?.version) || [];
  const issues = [], counts = {};
  const add = (code, collection, id) => { if (issues.length < 100) issues.push({ code, ...(collection ? { collection } : {}), ...(id ? { id: String(id) } : {}) }); };
  const result = () => ({ ready: issues.length === 0, issues, counts, coverage: collectionNames.filter(name => Array.isArray(document?.collections?.[name])) });
  if (document?.version === 1) { add('LEGACY_INCOMPLETE'); return result(); }
  if (!collectionNames.length || document.format !== 'stockly-tenant') { add('UNSUPPORTED_FORMAT'); return result(); }
  if (Object.keys(document).some(field => !['version', 'format', 'exportedAt', 'source', 'collections', 'manifest', 'checksum', 'validation'].includes(field))) add('UNKNOWN_FIELD');
  let encoded;
  try { encoded = JSON.stringify(document); } catch { add('INVALID_JSON'); return result(); }
  if (Buffer.byteLength(encoded) > MAX_BYTES || !safeJson(document)) { add('LIMIT_OR_INVALID_JSON'); return result(); }
  if (!instant(document.exportedAt) || typeof document.source?.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(document.source.clientId) ||
      !Array.isArray(document.source?.shops) || document.source.shops.length > 100 ||
      document.source.shops.some(shop => typeof shop !== 'string' || !shop || shop.length > 100) ||
      new Set(document.source.shops).size !== document.source.shops.length || document.source.currency !== 'PKR' || document.source.timeZone !== 'Asia/Karachi') add('SOURCE');
  if (!document.collections || typeof document.collections !== 'object' || Array.isArray(document.collections) ||
      Object.keys(document.collections).some(name => !collectionNames.includes(name))) { add('COVERAGE'); return result(); }
  for (const name of collectionNames) {
    if (!Array.isArray(document.collections[name])) add('COVERAGE', name);
    else counts[name] = document.collections[name].length;
  }
  if (Object.keys(counts).length !== collectionNames.length) return result();
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) > MAX_RECORDS) { add('RECORD_LIMIT'); return result(); }
  if (!isDeepStrictEqual(document.manifest?.counts, counts) || !isDeepStrictEqual(document.manifest?.excluded, excluded)) add('MANIFEST');
  if (!hash(document.checksum) || checksum(document) !== document.checksum) add('CHECKSUM');
  const data = document.collections, shops = new Set(Array.isArray(document.source?.shops) ? document.source.shops : []);
  const validShop = value => typeof value === 'string' && shops.has(value);
  const schemaCheck = (name, row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { add('DOCUMENT', name); return false; }
    const paths = db[`${name}Schema`].paths;
    for (const [field, value] of Object.entries(row)) {
      const path = paths[field];
      if (!path) { add('UNKNOWN_FIELD', name, row._id); continue; }
      if (value === null && field !== '_id') continue;
      const valid = path.instance === 'ObjectId' ? objectId(value) : path.instance === 'Date' ? instant(value)
        : path.instance === 'Number' ? typeof value === 'number' && Number.isFinite(value)
        : path.instance === 'String' ? typeof value === 'string' : path.instance === 'Array' ? Array.isArray(value) : true;
      if (!valid) add('FIELD_TYPE', name, row._id);
    }
    if (paths._id.instance === 'ObjectId' ? !objectId(row._id) : typeof row._id !== 'string' || !row._id) add('DOCUMENT_ID', name, row._id);
    if (row.__v !== undefined && !integer(row.__v)) add('REVISION', name, row._id);
    return true;
  };
  const indexed = {};
  for (const name of collectionNames) {
    const ids = new Map(); indexed[name] = ids;
    for (const row of data[name]) {
      if (!schemaCheck(name, row)) continue;
      if (ids.has(row._id)) add('DUPLICATE_ID', name, row._id);
      ids.set(row._id, row);
    }
  }
  if (issues.some(issue => ['DOCUMENT', 'FIELD_TYPE', 'DOCUMENT_ID'].includes(issue.code))) return result();
  const locations = new Map(), activeSales = new Map();
  const place = (row, where) => {
    if (!imei(row.imei) || (row.imei2 != null && row.imei2 !== '' && !imei(row.imei2))) add('IMEI', where, row._id);
    if (locations.has(row.imei)) add('DUPLICATE_LOCATION', where, row._id);
    locations.set(row.imei, row);
  };
  for (const row of data.Phone) {
    place(row, 'Phone');
    if (!validShop(row.shop) || !['in_stock', 'sold'].includes(row.status) || !money(row.buyPrice)) add('PHONE_STATE', 'Phone', row._id);
  }
  if (data.HQStock.length > 1) add('HQ_SINGLETON', 'HQStock');
  for (const stock of data.HQStock) {
    if (stock.key !== 'hq' || !Array.isArray(stock.items)) { add('HQ_STATE', 'HQStock', stock._id); continue; }
    if (stock.revision !== undefined && !integer(stock.revision)) add('REVISION', 'HQStock', stock._id);
    for (const row of stock.items) {
      if (!row || typeof row !== 'object') { add('HQ_ITEM', 'HQStock'); continue; }
      place(row, 'HQStock');
      if (!money(row.buyPrice === undefined ? row.costPerUnit : row.buyPrice)) add('COST', 'HQStock', row.imei);
    }
  }
  for (const sale of data.Sale) {
    try { saleEvents(sale); } catch { add('SALE_AMOUNTS', 'Sale', sale._id); }
    if (['paymentVersion', 'paymentMethod', 'paidAmountMinor'].some(field => sale[field] !== undefined)) {
      try {
        if (document.version !== 3 || sale.paymentVersion !== 1 || !['cash', 'bank'].includes(sale.paymentMethod) ||
            !Number.isSafeInteger(sale.paidAmountMinor) || sale.paidAmountMinor <= 0 || sale.paidAmountMinor !== parseMinorUnits(sale.salePrice)) throw Error('Invalid payment');
      } catch { add('SALE_PAYMENT', 'Sale', sale._id); }
    }
    if (!imei(sale.imei) || !instant(sale.soldAt) || !validShop(sale.shop) || (sale.soldByShop != null && !validShop(sale.soldByShop))) add('SALE_STATE', 'Sale', sale._id);
    if (sale.reversedAt) {
      if (!instant(sale.reversedAt) || sale.reversalId !== `reversal_${sale._id}` ||
          !period(sale.reversalBusinessDate) || (instant(sale.reversedAt) && sale.reversalBusinessDate < businessDate(sale.reversedAt))) add('REVERSAL', 'Sale', sale._id);
    } else {
      if (activeSales.has(sale.imei)) add('DUPLICATE_ACTIVE_SALE', 'Sale', sale._id);
      activeSales.set(sale.imei, sale);
    }
  }
  const phones = new Map(data.Phone.map(row => [row.imei, row]));
  for (const phone of data.Phone) {
    const sale = activeSales.get(phone.imei);
    if (phone.status === 'sold') {
      if (!sale || phone.buyPrice !== (sale.buyPrice ?? 0) || phone.salePrice !== sale.salePrice || phone.soldAt !== sale.soldAt || phone.shop !== sale.shop ||
          (phone.soldByShop || phone.shop) !== (sale.soldByShop || sale.shop) ||
          (sale.phoneId && sale.phoneId !== phone._id) || (phone.currentSaleId && phone.currentSaleId !== sale?._id)) add('ACTIVE_SALE_LINK', 'Phone', phone._id);
    } else if (sale || ['salePrice', 'soldAt', 'soldByShop', 'currentSaleId'].some(field => phone[field] != null)) add('ACTIVE_SALE_LINK', 'Phone', phone._id);
  }
  for (const sale of activeSales.values()) if (!phones.has(sale.imei)) add('ORPHAN_ACTIVE_SALE', 'Sale', sale._id);
  const audits = new Map();
  for (const row of data.AuditLog) if (row.details?.operationId) {
    const entries = audits.get(row.details.operationId) || [];
    entries.push(row); audits.set(row.details.operationId, entries);
  }
  for (const operation of data.StockOperation) {
    const sale = indexed.Sale.get(operation.sale?._id);
    const original = sale && Object.fromEntries(Object.entries(sale).filter(([field]) => !['reversedAt', 'reversalId', 'reversalBusinessDate', 'reversedBy'].includes(field)));
    if (!key(operation._id) || !hash(operation.fingerprint) || !isSaleSnapshot(operation.sale) || !sameSaleSnapshot(operation.sale, original)) add('SALE_RECEIPT', 'StockOperation', operation._id);
  }
  const intakeAudits = data.AuditLog.filter(row => row.details?.intakeVersion !== undefined);
  const intakeKeys = new Set(intakeAudits.map(row => row.details.operationId));
  const intakePhoneIds = new Set();
  for (const operation of data.InventoryOperation) {
    if (operation.result?.kind === 'stock_intake' || intakeKeys.has(operation._id)) {
      const phoneId = operation.result?.phone?._id;
      if (typeof phoneId === 'string') {
        if (intakePhoneIds.has(phoneId)) add('INTAKE_CREATION_ID', 'InventoryOperation', operation._id);
        intakePhoneIds.add(phoneId);
      }
      if (document.version !== 3 || !isIntakeOperation(operation, audits.get(operation._id) || [], [...shops])) add('INTAKE_RECEIPT', 'InventoryOperation', operation._id);
      continue;
    }
    const outcome = operation.result, record = outcome?.shipment || outcome?.dispatch;
    const retained = record && (outcome.shipment ? indexed.Shipment : indexed.Dispatch).get(record._id);
    const action = outcome?.shipment ? 'warehouse_receive' : outcome?.dispatch ? 'warehouse_dispatch' : 'warehouse_remove';
    const audit = audits.get(operation._id)?.find(row => row.action === action);
    if (!key(operation._id) || !hash(operation.fingerprint) || !isWarehouseOutcome(outcome, [...shops]) || !audit ||
        (record ? !isDeepStrictEqual(record, retained) : outcome.removed !== 1 || !imei(outcome.imei) || typeof outcome.entryId !== 'string')) add('MOVEMENT_RECEIPT', 'InventoryOperation', operation._id);
  }
  for (const audit of intakeAudits) {
    const operation = indexed.InventoryOperation.get(audit.details.operationId);
    if (document.version !== 3 || !operation || !isIntakeOperation(operation, audits.get(audit.details.operationId) || [], [...shops])) add('INTAKE_AUDIT', 'AuditLog', audit._id);
  }
  const productNames = new Set();
  const productCheck = row => validShop(row.shop) || row.shop == null;
  for (const row of data.Product) {
    const name = canonicalName(row.name), identity = JSON.stringify([row.shop ?? null, name]);
    if (!name || productNames.has(identity) || !integer(row.quantity) || !money(row.buyPrice ?? 0) || !productCheck(row) ||
        (row.revision !== undefined && !integer(row.revision)) || (row.normalizedName !== undefined && row.normalizedName !== name)) add('PRODUCT_STATE', 'Product', row._id);
    productNames.add(identity);
  }
  for (const operation of data.ProductOperation) {
    const audit = audits.get(operation._id)?.find(row => ['product_receive', 'product_adjust', 'product_delete'].includes(row.action)), outcome = operation.result, product = outcome?.product;
    if (product) schemaCheck('Product', product);
    const type = audit?.action === 'product_receive' ? 'add' : audit?.action === 'product_delete' ? 'delete' : 'update';
    const replayInput = { type, id: product?._id, scope: audit?.role === 'shop' ? audit.shop : null,
      shop: product?.shop ?? null, normalizedName: canonicalName(product?.name), quantity: type === 'add' ? 0 : product?.quantity };
    if (!key(operation._id) || !hash(operation.fingerprint) || outcome?.success !== true || !audit ||
        !isProductOutcome(outcome, replayInput) ||
        (audit.action === 'product_delete' ? Object.keys(outcome).length !== 1 : !product || !integer(product.quantity) || !integer(product.revision) ||
          !canonicalName(product.name) || !productCheck(product) || !money(product.buyPrice ?? 0) ||
          product._id !== audit.details.productId || product.quantity !== audit.details.quantityAfter || product.revision !== audit.details.revision)) add('PRODUCT_RECEIPT', 'ProductOperation', operation._id);
  }
  for (const name of ['InventoryIdentity', 'ProductIdentity']) for (const row of data[name]) {
    if (!integer(row.version) || (name === 'InventoryIdentity' ? row._id !== '@hq' && !imei(row._id) : !hash(row._id))) add('IDENTITY', name, row._id);
  }
  const naturalKeys = new Set();
  const validCashManual = day => {
    const receipt = data.DayOperation.find(operation => operation.result?.day?._id === day._id &&
      operation.result.day.cashManualChecksum === day.cashManualChecksum && operation.result.day.revision <= day.revision &&
      audits.get(operation._id)?.some(audit => ['day_save', 'day_reset'].includes(audit.action) &&
        audit.details.cashFinancialOnly === true && audit.details.cashManualChecksum === day.cashManualChecksum && audit.details.dayId === day._id));
    const marked = data.AuditLog.some(audit => audit.details?.dayId === day._id &&
      (audit.details.cashManualChecksum !== undefined || audit.details.cashFinancialOnly === true)) ||
      data.DayOperation.some(operation => operation.result?.day?._id === day._id && operation.result.day.cashManualChecksum !== undefined);
    if (day.cashManualChecksum === undefined) return !marked;
    try { return document.version === 3 && hash(day.cashManualChecksum) && day.cashManualChecksum === dayChecksum(manualData(day)) && !!receipt; }
    catch { return false; }
  };
  for (const day of data.Day) {
    if (!validCashManual(day)) add('DAY_CASH_MANUAL', 'Day', day._id);
    const identity = `day:${day.shop}:${day.date}`;
    if (!validShop(day.shop) || !period(day.date) || naturalKeys.has(identity) || (day.carryForward !== undefined && !money(day.carryForward, true))) add('DAY_STATE', 'Day', day._id);
    naturalKeys.add(identity);
    for (const field of ['expenses', 'purchases', 'transfers']) if (day[field] && day[field].some(row => !row || !money(row.amt))) add('DAY_AMOUNT', 'Day', day._id);
    for (const category of Object.values(day.cats || {})) {
      if (!category || !Array.isArray(category.rows)) { add('DAY_ROWS', 'Day', day._id); continue; }
      for (const row of category.rows) {
        if (!row || ['soldFor', 'boughtFor', 'soldCost'].some(field => row[field] !== undefined && !money(row[field], true)) ||
            ['op', 'inQty', 'out'].some(field => row[field] != null && !integer(row[field])) ||
            (row.costPerUnit != null && !money(row.costPerUnit))) add('DAY_AMOUNT', 'Day', day._id);
      }
    }
  }
  for (const row of data.ShopExpense) if (!validShop(row.shop) || !period(row.date) || row.month !== row.date.slice(0, 7) || !money(row.amount)) add('EXPENSE_STATE', 'ShopExpense', row._id);
  for (const name of ['Shipment', 'Dispatch']) for (const row of data[name]) {
    if (!period(row.date) || (name === 'Dispatch' && !validShop(row.toShop)) || !Array.isArray(row.items)) { add('MOVEMENT_STATE', name, row._id); continue; }
    for (const item of row.items) if (!item || !imei(item.imei) || !money(item.buyPrice === undefined ? item.costPerUnit : item.buyPrice)) add('MOVEMENT_ITEM', name, row._id);
  }
  for (const row of data.Report) {
    const identity = `report:${row.type}:${row.shop}:${row.period}`;
    if ((row.shop !== 'ALL' && !validShop(row.shop)) || !['daily', 'monthly'].includes(row.type) || !period(row.period, row.type) || naturalKeys.has(identity)) add('REPORT_STATE', 'Report', row._id);
    naturalKeys.add(identity);
  }
  for (const row of data.AccountingState) {
    if (!validShop(row._id) || !period(row.openDate) || !integer(row.version)) add('ACCOUNTING_PERIOD', 'AccountingState', row._id);
    const hasCashEntries = (data.CashEntry || []).some(entry => entry.shop === row._id || entry.toShop === row._id) ||
      (data.CashCheckpoint || []).some(entry => entry.shop === row._id);
    if ((row.cashFormatVersion !== undefined && (document.version !== 3 || row.cashFormatVersion !== 1 || !hasCashEntries)) ||
        (hasCashEntries && row.cashFormatVersion !== 1)) add('CASH_FORMAT', 'AccountingState', row._id);
  }
  for (const entry of data.CashEntry || []) for (const shop of [entry.shop, ...(entry.toShop ? [entry.toShop] : [])]) {
    if (indexed.AccountingState.get(shop)?.cashFormatVersion !== 1) add('CASH_FORMAT', 'AccountingState', shop);
  }
  const canonicalEvents = new Map();
  for (const row of data.CashCheckpoint || []) {
    try {
      const returns = (data.CustomerReturn || []).filter(item => item.acceptedAt <= row.at).map(item =>
        item.refund?.occurredAt > row.at ? Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'refund')) : item);
      const canonicalFlows = normalizeCashSources({ shop: row.shop, validShops: [...shops], sales: data.Sale,
        returns, entries: data.CashEntry || [], expenses: data.ShopExpense });
      const relevant = flow => row.kind === 'opening'
        ? flow.occurredAt === row.at && flow.confirmed && !flow.issue
        : typeof flow.occurredAt === 'string' && flow.occurredAt >= row.baseline.at && flow.occurredAt <= row.at;
      const sort = flows => flows.filter(relevant).sort((left, right) => left.id.localeCompare(right.id));
      if (!isDeepStrictEqual(sort(canonicalFlows), sort(row.flows)) || row.flows.some(flow =>
        !canonicalFlows.some(source => isDeepStrictEqual(source, flow)))) add('CASH_CHECKPOINT_SOURCE', 'CashCheckpoint', row._id);
    } catch { add('CASH_CHECKPOINT_SOURCE', 'CashCheckpoint', row._id); }
    const previous = indexed.CashCheckpoint.get(row.previousId);
    const next = data.CashCheckpoint.filter(point => point.previousId === row._id);
    const state = indexed.AccountingState.get(row.shop);
    const audit = audits.get(row.operationId)?.find(audit => audit.action === 'cash_' + row.kind && audit.shop === row.shop &&
      audit.details.checkpointId === row._id && audit.details.resultChecksum === createHash('sha256').update(JSON.stringify(row.result)).digest('hex'));
    if (!isCashCheckpoint(row, [...shops]) || !audit || !state || state.cashFormatVersion !== 1 || next.length > 1 ||
        (!next.length && state.cashCheckpointId !== row._id) ||
        (row.revision === 1 ? previous : !previous || previous.shop !== row.shop || previous.revision + 1 !== row.revision || previous.at > row.at) ||
        (row.kind === 'close' && (!previous || previous.configuration !== row.configuration ||
          row.baseline.at !== previous.at || row.baseline.countedMinor !== previous.countedMinor ||
          !isDeepStrictEqual(row.baseline.historicalUnknownFlows || [], previous.baseline.historicalUnknownFlows || []) ||
          !isDeepStrictEqual(row.baseline.includedSourceIds, previous.flows.filter(flow => flow.occurredAt === previous.at && flow.confirmed && !flow.issue).map(flow => flow.id)) ||
          indexed.DayVersion.get(row.daySnapshotId)?.shop !== row.shop || indexed.DayVersion.get(row.daySnapshotId)?.date !== row.businessDate))) add('CASH_CHECKPOINT', 'CashCheckpoint', row._id);
  }
  for (const state of data.AccountingState) if (state.cashCheckpointId !== undefined &&
    indexed.CashCheckpoint?.get(state.cashCheckpointId)?.shop !== state._id) add('CASH_CHECKPOINT', 'AccountingState', state._id);
  for (const sale of data.Sale) { try { for (const event of saleEvents(sale)) canonicalEvents.set(event._id, event); } catch {} }
  for (const row of data.DayVersion) {
    try {
      const snapshot = row.snapshot;
      const calculated = calculateDay({ events: snapshot.ledger, manual: manualData(snapshot.manual), shopExpenses: snapshot.shopExpenses });
      if (snapshot.cashSourceVersion !== undefined || snapshot.cashEntries !== undefined || snapshot.manualBase !== undefined) {
        if (document.version !== 3 || snapshot.cashSourceVersion !== 1 || !Array.isArray(snapshot.cashEntries) || !snapshot.cashEntries.length ||
            new Set(snapshot.cashEntries.map(entry => entry._id)).size !== snapshot.cashEntries.length ||
            snapshot.cashEntries.some(entry => !isCashEntry(entry, [...shops]) || entry.shop !== row.shop || entry.postingDate !== row.date || !isDeepStrictEqual(indexed.CashEntry.get(entry._id), entry)) ||
            !isDeepStrictEqual(cashFinancialManual(manualData(snapshot.manualBase), snapshot.cashEntries, snapshot.shopExpenses), snapshot.manual)) add('DAY_CASH_SOURCE', 'DayVersion', row._id);
      }
      if (!validShop(row.shop) || !period(row.date) || !integer(row.revision) || row.revision < 1 ||
          snapshot.snapshotId !== row._id || snapshot.shop !== row.shop || snapshot.date !== row.date || snapshot.revision !== row.revision ||
          !instant(snapshot.capturedAt) || !isDeepStrictEqual(calculated.financial, snapshot.financial) || !isDeepStrictEqual(calculated.cats, snapshot.cats)) add('DAY_VERSION', 'DayVersion', row._id);
      const eventIds = new Set();
      for (const event of snapshot.ledger) {
        const retained = canonicalEvents.get(event._id);
        if (eventIds.has(event._id) || !retained || event.businessDate !== row.date || (event.soldByShop || event.shop) !== row.shop ||
          ['kind', 'imei', 'brand', 'model', 'cat', 'storage', 'businessDate', 'shop', 'soldByShop', 'salePrice', 'buyPrice', 'profit', 'salePriceMinor', 'buyPriceMinor', 'profitMinor', 'units'].some(field => (event[field] ?? null) !== (retained?.[field] ?? null))) add('DAY_VERSION_EVENT', 'DayVersion', row._id);
        eventIds.add(event._id);
      }
      const state = indexed.AccountingState.get(row.shop);
      const next = businessDate(new Date(periodBounds(row.date, 'daily').end));
      if (!state || state.openDate < next) add('ACCOUNTING_PERIOD', 'AccountingState', row.shop);
    } catch { add('DAY_VERSION', 'DayVersion', row._id); }
  }
  for (const day of data.Day) {
    if (day.revision !== undefined && !integer(day.revision)) add('DAY_REVISION', 'Day', day._id);
    if (day.status !== undefined && !['open', 'closed'].includes(day.status)) add('DAY_STATUS', 'Day', day._id);
    if (day.history !== undefined && (!Array.isArray(day.history) || day.history.length > 30 || day.history.some(entry => !integer(entry.revision) || !instant(entry.at) || !indexed.DayVersion.has(entry.snapshotId)))) add('DAY_HISTORY', 'Day', day._id);
    if (day.status === 'closed' && (!day.closedSnapshot || day.closedSnapshot.revision !== day.revision ||
      !isDeepStrictEqual(indexed.DayVersion.get(day.closedSnapshot?.snapshotId)?.snapshot, day.closedSnapshot))) add('DAY_VERSION', 'Day', day._id);
  }
  for (const operation of data.DayOperation) {
    const day = operation.result?.day;
    const audit = audits.get(operation._id)?.find(row => /^day_(save|close|reopen|reset)$/.test(row.action));
    if (day) schemaCheck('Day', day);
    if (!key(operation._id) || !hash(operation.fingerprint) || !isDayOutcome(operation.result) || !day || !audit ||
        audit.details.dayId !== day._id || audit.details.revision !== day.revision || audit.details.resultChecksum !== dayChecksum(day)) add('DAY_RECEIPT', 'DayOperation', operation._id);
  }
  for (const row of data.Stocktake || []) {
    const bounded = (value, max) => Array.isArray(value) && value.length <= max;
    const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(name => allowed.includes(name));
    const baseline = bounded(row.baseline, 5000) && row.baseline.every(item => fields(item, ['phoneId', 'imei', 'fingerprint']) && objectId(item.phoneId) && imei(item.imei) && hash(item.fingerprint));
    const observations = bounded(row.observations, 10000) && row.observations.every(item => fields(item, ['imei', 'observedAt']) && imei(item.imei) && instant(item.observedAt) && item.observedAt >= row.startedAt && (row.status === 'open' || item.observedAt <= row.finishedAt));
    const terminal = row.status !== 'open';
    const operations = observations && bounded(row.operations, 10002) && row.operations.length === row.observations.length + 1 + (terminal ? 1 : 0) &&
      row.revision === row.observations.length + (terminal ? 1 : 0) && row.operations.every((item, index) => {
      const receipt = item?.result;
      const finishing = terminal && index === row.operations.length - 1;
      const status = finishing ? row.status : 'open';
      const count = finishing ? row.observations.length : index;
      const payload = index === 0 ? ['start', row.shop] : finishing ? ['finish', status, index - 1] : ['scan', row.observations[index - 1].imei, index - 1];
      const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const action = index === 0 ? 'stocktake_start' : finishing ? 'stocktake_' + status : 'stocktake_scan';
      const evidence = audits.get(item?.key)?.filter(audit => audit.action === action && audit.shop === row.shop && audit.role === 'admin' && audit.details.stocktakeId === row._id &&
        (index === 0 ? audit.details.baselineCount === row.baseline?.length : audit.details.revision === index && (finishing || audit.details.imei === row.observations[index - 1].imei)));
      return fields(item, ['key', 'fingerprint', 'revision', 'result']) && key(item.key) && item.fingerprint === fingerprint && item.revision === index && evidence?.length === 1 &&
        fields(receipt, ['success', 'stocktakeId', 'revision', 'status', 'observationCount']) && receipt.success === true && receipt.stocktakeId === row._id && receipt.revision === item.revision &&
        receipt.status === status && receipt.observationCount === count;
    });
    if (!validShop(row.shop) || !['open', 'reviewed', 'cancelled'].includes(row.status) || !instant(row.startedAt) ||
        !period(row.businessDate) || (instant(row.startedAt) && businessDate(row.startedAt) !== row.businessDate) || !hash(row.configuration) || !integer(row.revision) ||
        (row.status === 'open' ? row.finishedAt != null : !instant(row.finishedAt) || row.finishedAt < row.startedAt) || !baseline || !observations || !operations ||
        (baseline && (new Set(row.baseline.map(item => item.phoneId)).size !== row.baseline.length || new Set(row.baseline.map(item => item.imei)).size !== row.baseline.length)) ||
        (operations && (new Set(row.operations.map(item => item.key)).size !== row.operations.length || new Set(row.operations.map(item => item.revision)).size !== row.operations.length))) add('STOCKTAKE_STATE', 'Stocktake', row._id);
    if (row.status === 'reviewed' && baseline && observations) {
      const scans = new Map();
      for (const item of row.observations) scans.set(item.imei, (scans.get(item.imei) || 0) + 1);
      const captured = new Set(row.baseline.map(item => item.imei));
      const expected = { invalidated: false, recheckRequired: false,
        matched: row.baseline.filter(item => scans.has(item.imei)).map(item => item.imei),
        missing: row.baseline.filter(item => !scans.has(item.imei)).map(item => item.imei), changed: [], newArrivals: [],
        unexpected: [...scans.keys()].filter(value => !captured.has(value)), wrongShop: [],
        duplicates: [...scans].filter(([, times]) => times > 1).map(([value]) => value) };
      if (!fields(row.review, Object.keys(expected)) || !Array.isArray(row.review?.wrongShop) ||
          row.review.wrongShop.some(value => !imei(value) || !expected.unexpected.includes(value)) || new Set(row.review.wrongShop).size !== row.review.wrongShop.length ||
          !isDeepStrictEqual({ ...row.review, wrongShop: [] }, expected)) add('STOCKTAKE_REVIEW', 'Stocktake', row._id);
    } else if (row.review != null || row.status === 'reviewed') add('STOCKTAKE_REVIEW', 'Stocktake', row._id);
  }
  for (const row of data.CashEntry || []) {
    const evidence = audits.get(row.operationId)?.filter(audit => audit.action === 'cash_entry_record' && audit.role === 'admin' && audit.shop === row.shop &&
      audit.details.entryId === row._id && audit.details.kind === row.kind && audit.details.method === row.method && audit.details.amountMinor === row.amountMinor &&
      audit.details.toShop === (row.toShop || null) && audit.details.occurredAt === row.occurredAt);
    if (document.version !== 3 || !isCashEntry(row, [...shops]) || evidence?.length !== 1 ||
        (row.kind === 'expense' && !isDeepStrictEqual(indexed.ShopExpense.get(row._id), row.expense))) add('CASH_ENTRY', 'CashEntry', row._id);
  }
  for (const row of data.CustomerReturn || []) {
    const sale = indexed.Sale.get(row._id);
    let amount;
    try { amount = saleEvents(sale)[0].salePriceMinor; } catch { add('RETURN_SOURCE', 'CustomerReturn', row._id); continue; }
    const acceptedAudit = audits.get(row.operationId)?.filter(audit => audit.action === 'customer_return' && audit.role === 'admin' && audit.shop === row.shop &&
      audit.details.saleId === row._id && audit.details.imei === row.imei && audit.details.receivingShop === row.shop && audit.details.sellingShop === row.soldByShop &&
      audit.details.amountMinor === amount && audit.details.reversalId === sale.reversalId);
    const reversalAudit = data.AuditLog.filter(audit => audit.action === 'sale_reverse' && audit.details?.saleId === row._id && audit.details.reversalId === sale.reversalId &&
      audit.details.reversedAt === sale.reversedAt && audit.details.businessDate === sale.reversalBusinessDate);
    if (document.version !== 3 || !validShop(row.shop) || !validShop(row.soldByShop) || !isRetainedReturn(row, sale) ||
        acceptedAudit?.length !== 1 || reversalAudit.length !== 1) add('RETURN_STATE', 'CustomerReturn', row._id);
    if (row.refund !== undefined) {
      const refund = row.refund;
      if (!isRetainedRefund(row, [...shops])) { add('REFUND_STATE', 'CustomerReturn', row._id); continue; }
      const outcome = refundOutcome(row);
      const refundAudit = audits.get(refund.operationId)?.filter(audit => audit.action === 'customer_refund' && audit.role === 'admin' && audit.shop === refund.shop &&
        audit.details.saleId === row._id && audit.details.refundId === outcome.refundId && audit.details.amountMinor === amount && audit.details.method === refund.method &&
        audit.details.occurredAt === refund.occurredAt && audit.details.businessDate === refund.businessDate);
      if (refundAudit?.length !== 1) add('REFUND_STATE', 'CustomerReturn', row._id);
    }
  }
  return result();
}

module.exports = { collectionNames, allCollectionNames, namesForVersion, getModels, checksum, validateBackup, MAX_RECORDS, MAX_BYTES, excluded };
