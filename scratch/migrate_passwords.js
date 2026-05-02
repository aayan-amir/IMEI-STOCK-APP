'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env');
  process.exit(1);
}

async function migrate() {
  try {
    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected.');

    // Define a minimal schema for migration
    const Client = mongoose.model('Client', new mongoose.Schema({
      clientId: String,
      adminPassword: String,
      gatePassword: String
    }), 'clients');

    const clients = await Client.find({});
    console.log(`🔍 Found ${clients.length} clients.`);

    for (const client of clients) {
      let changed = false;

      // Check if adminPassword needs hashing (bcrypt hashes start with $2b$)
      if (client.adminPassword && !client.adminPassword.startsWith('$2b$')) {
        console.log(`⚙️  Hashing adminPassword for: ${client.clientId}`);
        client.adminPassword = await bcrypt.hash(client.adminPassword, 12);
        changed = true;
      }

      // Check if gatePassword needs hashing
      if (client.gatePassword && !client.gatePassword.startsWith('$2b$')) {
        console.log(`⚙️  Hashing gatePassword for: ${client.clientId}`);
        client.gatePassword = await bcrypt.hash(client.gatePassword, 12);
        changed = true;
      }

      if (changed) {
        await client.save();
        console.log(`✅ Updated: ${client.clientId}`);
      } else {
        console.log(`⏭️  Skipping: ${client.clientId} (already hashed)`);
      }
    }

    console.log('🎉 Migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
