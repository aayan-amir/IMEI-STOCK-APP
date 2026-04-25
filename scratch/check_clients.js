require('dotenv').config();
const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, required: true },
  adminPassword: { type: String, required: true },
  gatePassword: { type: String, required: true },
  shops: { type: Array, default: [] }
});
const Client = mongoose.model('Client', ClientSchema);

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const clients = await Client.find({});
  console.log('Found clients:', clients.map(c => ({ 
    clientId: c.clientId, 
    gate: c.gatePassword, 
    admin: c.adminPassword 
  })));
  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
