'use strict';

function installShutdown({ server, app, disconnect, stopConnecting, signals = process, graceMs = 10000,
  onError = () => { console.error('Server shutdown failed'); process.exitCode = 1; } }) {
  if (!Number.isInteger(graceMs) || graceMs < 1 || graceMs > 60000) throw Error('Invalid shutdown grace period');
  let shutdownPromise, disconnectPromise, stopped = false, draining = false;
  const stop = () => { if (!stopped) { stopped = true; stopConnecting(); } };
  const disconnectOnce = () => disconnectPromise ||= Promise.resolve().then(async () => {
    await app.locals.requestWork?.idle();
    await disconnect();
  });
  const signal = () => { void shutdown().catch(onError); };
  const onRequest = (req, res) => {
    res.once('finish', () => {
      if (draining) setImmediate(() => server.closeIdleConnections());
    });
  };
  server.on('request', onRequest);
  const cleanup = () => {
    signals.removeListener('SIGTERM', signal); signals.removeListener('SIGINT', signal);
    server.removeListener('request', onRequest);
  };
  server.once('close', () => {
    stop();
    if (!draining) void disconnectOnce().catch(onError).finally(cleanup);
  });
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    draining = true; app.locals.draining = true; stop();
    let timer;
    const drained = new Promise((resolve, reject) => {
      server.close(error => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') return reject(error);
        disconnectOnce().then(resolve, reject);
      });
    });
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        server.closeAllConnections();
        reject(Object.assign(Error('Server shutdown exceeded its deadline'), { code: 'SHUTDOWN_TIMEOUT' }));
      }, graceMs);
    });
    shutdownPromise = Promise.race([drained, deadline]).finally(() => { clearTimeout(timer); cleanup(); });
    return shutdownPromise;
  }
  signals.on('SIGTERM', signal); signals.on('SIGINT', signal);
  return { shutdown };
}

module.exports = { installShutdown };
