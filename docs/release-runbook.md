# Local verification and release gates

## Before considering a release

Use the current checkout and its lockfile. Run npm run check and npm test. Tests require the configured disposable loopback stockly_test_ database and never the production URI. npm run bench:movements creates its own synthetic replica set and emits measurements; it is not a production benchmark. Current completed checkpoints are recorded in FEATURE-EXECUTION.md with exact counts and log names.

Do not run maintenance/migration scripts against a live tenant as part of normal startup. No production migration, feature flag activation, deployment, commit or push has been performed by this work. New business writers remain default off. Enabling verified cash also requires the fully-paid and return capabilities; preserve the recorded defaults in COUNTED-CASH.md and RECOVERY.md.

## Startup and health

npm start reads runtime configuration and starts HTTP. Database connection retries back off from 1 second to a 30-second cap. /health/live reports process availability; /health/ready requires an established MongoDB connection and no drain. API requests fail with 503 while the database is unavailable or the server is draining. The API includes request correlation IDs. Configure the reverse proxy/origins and a replica set using the deployment's existing secrets; no credentials belong in documentation or logs.

## Graceful termination

SIGTERM or SIGINT marks the process draining, stops scheduled connection retries and closes the HTTP listener. Repeated signals share one drain. Accepted route/middleware promises and their finally blocks remain tracked after the client aborts or the response is sent. Recovery lease release is included. The process closes newly idle keep-alive sockets after response finish, waits for accepted application work and any startup connection attempt, then disconnects MongoDB.

The entire drain/disconnect has a 10-second deadline. On expiry remaining HTTP sockets close and shutdown reports failure. The CLI exits with status 1 on failed shutdown; a library caller receives server.shutdown() as an explicit promise and can choose its own supervisor policy. The host supervisor must allow more than 10 seconds plus startup/exit overhead before forced termination. Do not interpret a forced exit as a successful response or completed business operation. Retry a command with its original retained idempotency key and review its recorded outcome; never invent a replacement payment or erase recovery leases by hand.

Tests inject HTTP client abort, post-response cleanup, actual recovery-guard lease release, a hung response, a hung disconnect, pending startup connection, retry cancellation and repeated signal events. On Windows the test emits the Node signal event; it does not certify how a particular Windows service manager delivers OS termination. Hard process kill/power loss, deployed DB outage/reconnect and supervisor integration still require staging rehearsal.

## Recovery and rollback

Take a version-3 business snapshot and verify an empty-account restore on an isolated tenant before a release that changes persisted evidence. Restore does not merge over an occupied account. Snapshots exclude login/session and recovery-control secrets and are not deployment archives. Source checkpoints exclude secrets, dependencies/vendor binaries and native build outputs; they are not business backups.

Keep readers/writers compatible with retained sale, reversal, day, payment and counted-cash evidence. Rolling back application code that does not understand new writes is unsafe. Use compatible readers or maintenance/read-only operation while repairing forward; do not silently restore an old snapshot over later business activity. Review the original improvement plan for per-tenant fencing and supported installed-client gates.

## Outstanding acceptance

Current source includes bulk intake, guarded confirmations and pinned/synchronized native dependencies. APK compilation is blocked locally by missing JDK21/SDK36; physical camera/keyboard/back/print acceptance, deployed client compatibility and rollout remain unverified. Unit/integration runs were stopped at the user’s request. Use READY-TO-RUN.md for the current handoff rather than treating historical passing checkpoints as verification of later changes.
