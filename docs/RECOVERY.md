# Bounded snapshot recovery

The approved policy is **restore only into an empty account**. The new workflow exports a consistent version-2 business snapshot, validates it without business writes, presents a concrete review and applies that reviewed file atomically. It does not merge with or replace populated business data.

## Current v3 extension

The authored browser now requests version3. Its complete catalogue is the 19 legacy collections below plus Stocktake, CustomerReturn, CashEntry and CashCheckpoint. V2 remains an explicit legacy format and refuses to omit newer records or sale tender fields. V1 also refuses newer evidence. Current source validation and empty-account restore cover all 23 collections. Cash-checkpoint restore retains historical counts and requires a new physical baseline for the restored account; see COUNTED-CASH.md. The v2 workflow below documents the preserved legacy contract, not a downgrade path for newer evidence.

## Scope and limits

The catalogue covers Phone, Sale, Day, StockOperation, ShopExpense, HQStock, InventoryIdentity, InventoryOperation, Shipment, Dispatch, Customer, AuditLog, Report, Product, ProductIdentity, ProductOperation, AccountingState, DayVersion and DayOperation. A regression compares this catalogue with exported business schemas so an added collection cannot silently disappear from backup coverage.

Object IDs, timestamps, notes, carry-forward, expense month, selling attribution, retained corrections, products, contacts, reports, identity locks, retry receipts and original audit provenance are preserved. Master client credentials/configuration, login sessions and recovery-control metadata are explicitly excluded. Configure the target account's shop IDs before validation; a source shop absent from the target prevents recovery. Passwords and live access tokens are never restored from the file.

Automatic recovery is bounded to **5,000 business documents and 8 MiB**. HQ rows and nested content also count toward the byte limit. The HTTP recovery parser accepts a bounded 9 MiB request envelope before the default parser; larger requests return 413. The browser rejects files above 8 MiB before reading them. Accounts above the bound require an administrator-managed recovery procedure; a staged large-data cutover is not implemented or implied by this feature.

`GET /api/backup?version=2` reads all collections sequentially in a MongoDB snapshot transaction, with record/byte bounds. Exports contain format/source/calendar metadata, explicit collection counts, exclusions and a SHA-256 checksum. The checksum detects changes; it is not a signature or proof of file authenticity. The server computes readiness rather than trusting the file's advertised validation report. A conflicted snapshot may still be downloaded for reconciliation but is not recovery-ready.

The validator rejects unsupported/legacy-incomplete formats, omitted collections, unknown schema fields, mismatched counts/checksum, unsafe money/quantities, invalid periods, duplicate IDs/natural keys/locations, ambiguous active sales and broken sale/phone cost/state/identity links. Original sale receipts match retained original values even after reversal. Movement and product receipts must satisfy the same outcome contracts as operational replay and match their retained history/audits; equal request keys in different namespaces retain separate audit associations. This is not a certification that every historical report calculation was correct; daily closing has targeted lifecycle coverage described in DAILY-LIFECYCLE.md; wider financial reconciliation remains a separate plan task.

## Review and apply

1. Select the version-2 file and choose **Review Restore**. `POST /api/restore/validate` receives `{backup, mode:'empty'}` and returns conflicts/counts or an expiring `planId`. No business data is written. The current review is stored durably on the target, with the exact file/checksum, target configuration, write epoch and expiry. A subsequent successful review supersedes the earlier plan.
2. Review source and business counts. Only a valid review for the current account/file exposes **Restore into empty account**. The generic destructive-confirmation flow is not enabled by this feature.
3. `POST /api/restore/apply` receives `{planId, operationId}`. The browser keeps that operation key for an unchanged retry after an unknown response. The server verifies the current plan, expiry, configuration, write epoch, no active ordinary writers and empty business collections.
4. Maintenance acquisition and plan publication serialize through the same control row; an old plan cannot enter after a newer review has been published. All records are copied under one transaction with explicit BSON ID/date restoration and without schema-default invention. Read-back must exactly match the reviewed snapshot and revalidate its links before a recovery audit, durable acknowledgment and maintenance release commit together.
5. The UI reloads only after acknowledgment. Same operation/plan retries return the original result, without importing again or touching business changes made afterward. Changed-key/plan conflicts require a new review.

Only one current review is retained per target, limiting stored file duplication. Plan expiry is checked explicitly; no implicit TTL/index migration is relied upon. Completed recovery receipts are retained as operational control history and are excluded from subsequent business backups. Existing target control history is not a business-data overwrite exception.

## Write gate and failure behavior

All mutating tenant HTTP route handlers acquire a durable write lease and increment the target epoch before entering their business code, then release the lease when the handler completes. Authorization runs before the lease. This includes legacy/customer/day/expense/report routes as well as inventory/product services. Read-only recovery validation and apply use their own control protocol. Any ordinary write after validation invalidates the plan conservatively, including a failed write attempt.

Apply can enter maintenance only with no active leases. New HTTP writes receive 503 while maintenance is active. Ordinary readers see the old committed empty data until the import transaction commits; they cannot see partially imported collections. A known transaction abort leaves business collections unchanged and releases maintenance, permitting a same-plan/key retry if its review remains current. An uncertain commit is checked for a durable acknowledgment; unresolved uncertainty remains fenced.

`GET /api/restore/status` exposes maintenance, phase and active-write count for an authorized admin. **A process interruption or orphaned lease is not automatically cleared by time.** If maintenance remains active or a lease is stranded, keep writers fenced and reconcile the database transaction/receipt state before an operator releases anything. Do not reset counters or unlock solely because a timeout elapsed. Automated operator reconciliation, actual process-supervisor restart drills and a large-data staged recovery job remain outstanding operational work; tests currently simulate persisted interrupted maintenance and prove it continues to block writes.

The gate protects this application's cooperating HTTP instances. Older deployments, raw database tools, maintenance scripts or background writers that do not honor it must be separately drained/fenced before live recovery. No production topology, multi-instance rollout or raw-process fencing was contacted or certified in this implementation. No automatic data/index migration was run.

## Legacy compatibility

Unversioned `GET /api/backup` remains the version-1 adapter for older installed clients. It is incomplete and is not a snapshot recovery source. The new UI always downloads version 2. Version-1 validation reports missing coverage rather than inventing omitted collections or metadata. The legacy `/restore` adapter remains restricted and untrusted as a complete recovery path: receipt checks precede writes, every populated business target is refused, inventory constraints are fenced and newer warehouse/correction metadata remains refused. It must not be used to claim complete recovery or to bypass the reviewed workflow. Retiring these adapters depends on the installed-client migration work.

## Evidence and remaining release gates

Tests round-trip all business collections/IDs through an empty target, preserve reversal and replay metadata, exercise the actual browser API wrapper over isolated HTTP, reject stale/expired/superseded plans, inject a late audit failure, test concurrent write exclusion/read visibility, simulate persisted interrupted maintenance, check large bodies/oversized rejection and race snapshots against sale, dispatch and reversal at controlled interleavings. A read-only independent review found atomic plan-ownership, replay-contract and active-cost checks to tighten; each is now covered by targeted regressions.

Real process interruption/resume, production writer fencing and transaction topology, physical browser/native UX, larger data/throughput measurements, complete period-close financial lifecycle acceptance and the planned HQ storage migration remain explicit gates. Passing the bounded local suite does not certify those tasks or a production release.


## Retained bulk-intake proof

Version3 also validates the typed stock_intake InventoryOperation result without adding a collection. Receipt and marked stock_add audit proof must match bidirectionally; duplicate original creation IDs are rejected. A missing receipt cannot be retried as a fresh intake, and older export/import paths refuse known proof. See BULK-INTAKE.md for replay, browser-journal and recovery tests.
