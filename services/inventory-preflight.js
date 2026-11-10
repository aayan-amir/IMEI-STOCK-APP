'use strict';

const { parseMinorUnits } = require('../public/js/business-rules');

function inspectInventory({ phones = [], hqItems = [], sales = [] } = {}) {
  const issues = [];
  const locations = new Map();
  const phoneGroups = new Map();
  for (const [source, records] of [['shop', phones], ['hq', hqItems]]) {
    records.forEach((record, index) => {
      const imei = typeof record.imei === 'string' ? record.imei.trim() : '';
      const reference = String(record._id ?? `${source}:${index}`);
      if (!/^\d{15}$/.test(imei) || imei !== record.imei) issues.push({ type: 'INVALID_IMEI', source, reference });
      try { parseMinorUnits(record.buyPrice ?? record.costPerUnit ?? 0); }
      catch { issues.push({ type: 'INVALID_COST', source, reference }); }
      if (!imei) return;
      const group = locations.get(imei) || [];
      group.push({ source, reference });
      locations.set(imei, group);
      if (source === 'shop') {
        const grouped = phoneGroups.get(imei) || [];
        grouped.push(record);
        phoneGroups.set(imei, grouped);
      }
    });
  }
  for (const [imei, records] of locations) {
    if (records.length > 1) issues.push({ type: 'DUPLICATE_IMEI', imei, records });
    if (new Set(records.map(record => record.source)).size > 1) issues.push({ type: 'MULTIPLE_LOCATIONS', imei });
  }
  const salesByImei = new Map();
  for (const sale of sales) {
    if (sale.reversedAt) continue;
    const group = salesByImei.get(sale.imei) || [];
    group.push(sale);
    salesByImei.set(sale.imei, group);
  }
  for (const [imei, records] of phoneGroups) {
    const matchingSales = salesByImei.get(imei) || [];
    if (records.length !== 1 || matchingSales.length !== (records[0].status === 'sold' ? 1 : 0)) {
      issues.push({ type: 'SALE_STATE_MISMATCH', imei, phoneCount: records.length, saleCount: matchingSales.length });
    }
  }
  for (const [imei, records] of salesByImei) {
    if (!phoneGroups.has(imei)) issues.push({ type: 'SALE_WITHOUT_PHONE', imei, saleCount: records.length });
  }
  return { ready: issues.length === 0, counts: { phones: phones.length, hqItems: hqItems.length, sales: sales.length }, issues };
}

module.exports = { inspectInventory };
