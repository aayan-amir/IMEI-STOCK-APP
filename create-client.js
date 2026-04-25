require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

const ClientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, required: true },
  adminPassword: { type: String, required: true },
  gatePassword: { type: String, required: true },
  shops: { type: Array, default: [] } 
});
const Client = mongoose.model('Client', ClientSchema);

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  const clientId = process.argv[2] || 'demo';
  const adminPass = process.argv[3] || 'admin123';
  const gatePass = process.argv[4] || 'gate123';

  const client = await Client.findOneAndUpdate(
    { clientId },
    { 
      adminPassword: adminPass, 
      gatePassword: gatePass,
      shops: [
        { id: '101', name: 'Main Shop', color: '#16a34a' },
        { id: '202', name: 'Branch 2', color: '#7c3aed' }
      ]
    },
    { upsert: true, new: true }
  );

  console.log('Client created or updated:', client);
  process.exit(0);
}

run();
