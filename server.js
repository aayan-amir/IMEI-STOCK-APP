'use strict';

const { readRuntimeConfig } = require('./config/runtime');

function startServer({ env = process.env, onShutdownError } = {}) {
  const config = readRuntimeConfig(env);
  if (!config.mongoUri) throw new Error('MONGO_URI is required');
  const { createApp } = require('./app');
  const db = require('./db');
  const app = createApp({ config, database: db });
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Stock-ly listening on port ${config.port}`);
  });
  let stopped = false;
  let retryTimer;
  let attempts = 0;
  let connectionAttempt;
  function beginConnect() { if (!stopped) connectionAttempt = connect(); }
  async function connect() {
    if (stopped) return;
    try {
      await db.connectMongo(config.mongoUri);

    } catch {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** attempts++, 30000);
      console.error(`Database unavailable; retrying in ${delay}ms`);
      retryTimer = setTimeout(beginConnect, delay);
      retryTimer.unref();
    }
  }
  const lifecycle = require('./services/server-lifecycle').installShutdown({
    server, app,
    stopConnecting() { stopped = true; clearTimeout(retryTimer); },
    disconnect: async () => { await connectionAttempt; await db.mongoose.disconnect(); },
    ...(onShutdownError ? { onError: onShutdownError } : {}),
  });
  server.shutdown = lifecycle.shutdown;
  beginConnect();
  return server;
}

if (require.main === module) {
  if (process.env.NODE_ENV !== 'test') require('dotenv').config({ quiet: true });
  try { startServer({ onShutdownError: () => { console.error('Server shutdown failed'); process.exit(1); } }); } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { startServer };
