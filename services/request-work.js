'use strict';

function createWorkTracker() {
  let active = 0;
  const waiters = new Set();
  return {
    async run(work) {
      active++;
      try { return await work(); }
      finally {
        if (--active === 0) { for (const resolve of waiters) resolve(); waiters.clear(); }
      }
    },
    idle() { return active === 0 ? Promise.resolve() : new Promise(resolve => waiters.add(resolve)); },
  };
}
function trackHandler(handler) {
  if (handler.workTracked) return handler;
  const wrapped = (req, res, next) => {
    if (res.destroyed) return;
    const tracker = req.app.locals.requestWork;
    return tracker ? tracker.run(() => handler(req, res, next)) : handler(req, res, next);
  };
  wrapped.workTracked = true;
  if (handler.recoveryGuarded) wrapped.recoveryGuarded = true;
  return wrapped;
}
function trackRouterWork(router) {
  for (const layer of router.stack) {
    if (layer.route) for (const step of layer.route.stack) step.handle = trackHandler(step.handle);
  }
  return router;
}
module.exports = { createWorkTracker, trackHandler, trackRouterWork };
