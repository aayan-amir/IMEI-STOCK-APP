const mongoose = require('mongoose');
require('dns').setDefaultResultOrder('ipv4first');
// Schemas
const PhoneSchema = new mongoose.Schema({}, { strict: false });
const SaleSchema = new mongoose.Schema({}, { strict: false });
const DaySchema = new mongoose.Schema({}, { strict: false });
const ShopExpenseSchema = new mongoose.Schema({}, { strict: false });
const HQStockSchema = new mongoose.Schema({}, { strict: false });
const ShipmentSchema = new mongoose.Schema({}, { strict: false });
const DispatchSchema = new mongoose.Schema({}, { strict: false });
const CustomerSchema = new mongoose.Schema({}, { strict: false });
const AuditLogSchema = new mongoose.Schema({}, { strict: false });
const ReportSchema = new mongoose.Schema({}, { strict: false });

const ClientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, required: true },
  adminPassword: { type: String, required: true },
  gatePassword: { type: String, required: true },
  shops: { type: Array, default: [] }
});

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to Master DB");

  // Models in Master DB (old single-tenant data)
  const OldPhone = mongoose.model('Phone_Old', PhoneSchema, 'phones');
  const OldSale = mongoose.model('Sale_Old', SaleSchema, 'sales');
  const OldDay = mongoose.model('Day_Old', DaySchema, 'days');
  const OldShopExpense = mongoose.model('ShopExpense_Old', ShopExpenseSchema, 'shopexpenses');
  const OldHQStock = mongoose.model('HQStock_Old', HQStockSchema, 'hqstocks');
  const OldShipment = mongoose.model('Shipment_Old', ShipmentSchema, 'shipments');
  const OldDispatch = mongoose.model('Dispatch_Old', DispatchSchema, 'dispatches');
  const OldCustomer = mongoose.model('Customer_Old', CustomerSchema, 'customers');
  const OldAuditLog = mongoose.model('AuditLog_Old', AuditLogSchema, 'auditlogs');
  const OldReport = mongoose.model('Report_Old', ReportSchema, 'reports');

  const Client = mongoose.model('Client', ClientSchema);

  // 1. Create ANAS client
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const gatePass = process.env.GATE_PASSWORD || 'gate123';
  const shopsEnv = process.env.VALID_SHOPS ? process.env.VALID_SHOPS.split(',').map(s=>s.trim()) : ['456', '192', 'G15'];
  
  const shopsObj = shopsEnv.map(s => {
    let color = '#16a34a';
    if(s === '192') color = '#7c3aed';
    if(s === 'G15') color = '#dc2626';
    return { id: s, name: `Shop ${s}`, color };
  });

  await Client.findOneAndUpdate(
    { clientId: 'ANAS' },
    { adminPassword: adminPass, gatePassword: gatePass, shops: shopsObj },
    { upsert: true }
  );
  console.log("ANAS client configured in Master DB.");

  // 2. Connect to Tenant DB
  const tenantDb = mongoose.connection.useDb('tenant_ANAS');
  
  const NewPhone = tenantDb.model('Phone', PhoneSchema);
  const NewSale = tenantDb.model('Sale', SaleSchema);
  const NewDay = tenantDb.model('Day', DaySchema);
  const NewShopExpense = tenantDb.model('ShopExpense', ShopExpenseSchema);
  const NewHQStock = tenantDb.model('HQStock', HQStockSchema);
  const NewShipment = tenantDb.model('Shipment', ShipmentSchema);
  const NewDispatch = tenantDb.model('Dispatch', DispatchSchema);
  const NewCustomer = tenantDb.model('Customer', CustomerSchema);
  const NewAuditLog = tenantDb.model('AuditLog', AuditLogSchema);
  const NewReport = tenantDb.model('Report', ReportSchema);

  // Helper to copy
  async function copyData(OldModel, NewModel, name) {
    const docs = await OldModel.find({}).lean();
    if (docs.length > 0) {
      // Clear target first just in case
      await NewModel.deleteMany({});
      await NewModel.insertMany(docs);
      console.log(`Copied ${docs.length} ${name}`);
    }
  }

  console.log("Starting data migration...");
  await copyData(OldPhone, NewPhone, 'Phones');
  await copyData(OldSale, NewSale, 'Sales');
  await copyData(OldDay, NewDay, 'Days');
  await copyData(OldShopExpense, NewShopExpense, 'ShopExpenses');
  await copyData(OldHQStock, NewHQStock, 'HQStock');
  await copyData(OldShipment, NewShipment, 'Shipments');
  await copyData(OldDispatch, NewDispatch, 'Dispatches');
  await copyData(OldCustomer, NewCustomer, 'Customers');
  await copyData(OldAuditLog, NewAuditLog, 'AuditLogs');
  await copyData(OldReport, NewReport, 'Reports');

  console.log("Migration complete! You can safely delete the old collections from the master database later.");
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
