const { inspectInventory } = require('../services/inventory-preflight');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--client-id' || !/^[A-Za-z0-9_-]{1,64}$/.test(args[1])) {
    throw Error('Usage: npm run inventory:check -- --client-id CLIENT_ID');
  }
  if (!process.env.MONGO_URI) throw Error('Set an explicit MONGO_URI; this read-only command does not load .env');
  const db = require('../db');
  try {
    await db.connectMongo(process.env.MONGO_URI);
    if (!await db.Client.exists({ clientId: args[1] })) throw Error('Client not found');
    const tenant = db.getTenantDb(args[1]);
    const phones = await tenant.model('Phone', db.PhoneSchema).find({}, '_id imei status buyPrice shop').lean();
    const hq = await tenant.model('HQStock', db.HQStockSchema).findOne({ key: 'hq' }).lean();
    const sales = await tenant.model('Sale', db.SaleSchema).find({}, '_id imei soldAt reversedAt').lean();
    const report = inspectInventory({ phones, hqItems: hq?.items || [], sales });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 2;
  } finally { await db.mongoose.disconnect(); }
}

main().catch(error => {
  console.error(error.message.startsWith('Usage:') || error.message.startsWith('Set an explicit') || error.message === 'Client not found'
    ? error.message : 'Inventory check failed; no records or indexes were changed');
  process.exitCode = 1;
});
