# First implementation slice review

Scope: initial runtime/test foundation, authentication/session and ownership safeguards, typed API failures with migrated callers, stale inventory rendering fix, and failure-safe UI state. See `IMPLEMENTATION-PROGRESS.md` for partial task status and explicit remaining scope. This is not the complete 23-task plan.

A fresh native reviewer inspected the uncommitted tracked changes and new runtime/configuration/test/CI files against baseline `38e4110`. The review was read-only, included two small VM reproductions, and did not execute application/database services. Initial verdict: not merge-safe until three Important findings were addressed; no Critical findings.

| Finding | Resolution | Correction evidence |
|---|---|---|
| Removed `_nav` binding still used by shop wrapper | Eliminate navigation overriding; put shop-mode rule in the existing `nav()` and initialize only mode state | Repeated shop initialization, successful scan/inventory navigation, denied admin navigation regression failed first and then passed |
| Retained previous day could be saved under newly selected shop/date after a failed load | Track the successfully loaded day identity separately, refuse mismatched saves, stop `switchShop` rewriting the old draft's shop, and reject mismatched body/route identity on server | Failed-switch/recovered-network regression and disposable MongoDB API check failed first, then passed with no target-day write |
| Lost write response invited unsafe retry | Mutation-specific network/invalid-JSON messages state the outcome may already be saved and ask users to check before retry | Both response-loss paths failed wording assertions first and then passed |

The host accepted and fixed all three findings. No second review was requested; targeted regressions plus the final full suite provide correction evidence. A passing regression suite does not imply complete plan coverage or production/device acceptance.

Deferred by review and explicitly retained in the plan: atomic inventory/reversal/warehouse operations and idempotency, restore consistency/recovery, historical financial and closing rules, full stale-response guards/draft isolation/accessibility/confirmation work, actual Android/previous APK compatibility, full tenant cache lifecycle and access/input matrices, remaining direct-fetch parity, production proxy/migration verification, benchmarks and real-browser/device acceptance. Deferral is by scope, not a claim those behaviors are correct.

No commit, merge, push, deployment, production data access, index migration, or credential cleanup was performed.

## Stock-sale continuation review

A fresh reviewer inspected the new transaction/preflight/money/receipt code and affected route, client and backup compatibility changes. It used source inspection and three small read-only in-memory probes; it did not run services or database writes. Initial verdict: fix two Important findings; no Critical findings. It also identified a Minor weakness in the new concurrency test.

- **Accepted/fixed:** an earlier response cleared a newer pending request and used mutable `pendingIMEI`. Request/form/context ownership is now captured before awaiting; only matching unchanged forms are cleared, and cache updates use the captured IMEI. The out-of-order response regression failed first and then passed.
- **Accepted/fixed:** restore accepted arbitrary receipt outcome objects and missed conflicting IDs within a backup. Shared snapshot validation, reference matching, duplicate receipt/sale checks and timestamp validation now run before writes; replay checks outcome versus intent. Empty/missing/malformed/conflicting snapshot regressions failed first and then passed. Existing full restore shortcomings remain explicitly outside this extension.
- **Accepted/fixed:** the test's read barrier still hooked the legacy `findOne` path. It now hooks the current `find` query too and asserts both initial snapshots are `in_stock` before either proceeds to write. The new assertion failed on the inactive harness and passed after the harness correction.

All current-slice findings, including the test weakness, were addressed in the host's fix pass. No second reviewer round was requested; targeted regressions and a fresh full suite are the correction evidence. The HTTP-browser secure-random fallback was separately reproduced and tested.

The reviewer did not certify retained reversals, closed-period reporting, cross-writer/secondary-IMEI uniqueness, stock-add/warehouse/restore races, complete/snapshot-consistent backups, migrations, production topology, physical browser/Android behavior, or broader authentication/cache work. Those remain the named later tasks and release gates. Actor/tenant receipt isolation was inspected structurally, not independently exercised by the reviewer.

## Retained-reversal continuation review

A fresh read-only reviewer inspected the retained-reversal service, ledger rules, schemas, affected routes, daily/sales/monthly readers and regression tests. No Critical findings; two Important findings were accepted and fixed in one pass:

- The nonempty sales log referenced an undeclared `totals` variable. The actual render/print/CSV regression reproduced the exception before the shared exact ledger total was wired correctly. It also covers Karachi date filtering, correction labels and absence of a reversal button on corrections.
- Monthly screen/print readers excluded EXTRA correction cost and negative units. The reviewer independently reproduced the inconsistent totals in the browser VM. A failing screen/print regression and pure sum test now cover them; shared exact row totals replace both duplicated calculations and are reused in the daily summary.

No second review was requested. Targeted failing-then-passing tests and the fresh complete suite are the correction evidence. The reviewer did not exercise production services, databases or credentials. Period closing, full versioned recovery, migration/uniqueness, browser/device acceptance and the other plan gates remain outstanding. The formatting-only cleanup and two-decimal currency formatter were verified locally after review.

## Quantity-product continuation review

A fresh read-only reviewer inspected the product transaction service, route/schema/tenant registration changes, request/revision UI and new regression tests. It examined identity locking and quantity conservation and used a synthetic browser VM probe. No Critical findings; one Important finding was accepted and fixed:

- An older receipt response could clear a newer form after quantity changed away and back to the original value. Payload equality alone could not distinguish separate request keys. The new failing regression reproduced that sequence; completion now carries explicit ownership of the current pending request, and add/edit/delete callers suppress obsolete completion effects. The retry retains both the newer input and key.

No other backend integrity or Minor findings were identified. No second review round was requested; the targeted regression and fresh complete suite are the fix evidence. No production app, network, secrets or database was used by the reviewer. Warehouse movements, complete backup recovery, production topology and physical browser/device behavior remain outside this review's certification.

## Warehouse and shared-identity continuation review

A fresh independent read-only reviewer inspected shared identity locking, captured warehouse mutations, transactional audit/history/replay, stock wrappers, restore gating and browser request ownership. It observed a history-only restore bypass; the host independently reproduced that request returning success, extended the guard to shipment/dispatch-only imports and added a regression. An offline synthetic reviewer probe confirmed 409 without inserting history after the fix. No remaining Critical, Important or Minor findings were reported in the reviewed slice.

The reviewer's disposable-database probe was blocked by sandbox loopback EACCES; it used offline source/handler probes instead. The host separately ran the isolated real-database regression suite with approved loopback access. Neither party contacted production. Complete T10 manifest/restore validation, per-IMEI HQ migration, singleton throughput, physical browser/native acceptance and broader release gates remain outside the conclusion.

Host compatibility checks additionally reproduced and fixed lost legacy `costPerUnit`, unknown-cost invention, missing reversed-sale projection in the read-only preflight, and malformed legacy IMEI interpolation in a removal action. Each actual regression failed before its fix. No second review round was requested; targeted checks and the fresh complete suite provide correction evidence.

## Bounded recovery continuation review

A fresh read-only reviewer inspected snapshot/validation, empty-target apply, durable control state, route write leases, parser ordering and recovery schemas. Three Important findings were accepted:

- An apply could read an old plan, pause, allow a newer validation to publish, then acquire maintenance for the superseded plan. A controlled real-DB barrier reproduced acceptance of the old plan. Publication now updates the current-plan control token and durable plan in one transaction; maintenance CAS requires that token and its unexpired deadline. Validation cannot publish through an active apply.
- Recovery-ready receipt checks omitted operational replay invariants. Offline fixtures reproduced malformed warehouse entry IDs and product normalized names/merged flags passing validation even though replay would fail. The validator now reuses the warehouse/product replay outcome contracts, alongside retained snapshot/audit checks. Regressions cover both classes.
- Active phone/sale reconciliation omitted purchase cost. The reviewer independently reproduced a sold phone costing 999 linked to a sale costing 1 passing readiness. The active-link check now compares recorded cost using the existing legacy zero convention, and the unit fixture covers the mismatch.

The host also reproduced/fixed separate audit namespaces sharing a request key and a legacy non-inventory restore bypass of the approved empty-account policy. The actual browser API is exercised over the isolated HTTP app, including validation acknowledgment shape and reviewed apply. No second reviewer round was requested; targeted regressions and the final fresh full suite provide correction evidence. UI changes were still being implemented during the peer review and are verified by host VM/HTTP tests, not a claim of independent visual review.

No production access, migration, live restore, or real process restart occurred. Raw/old writers, topology/rollout, staged large-data recovery, physical browser/native acceptance, actual interruption drills and the complete period-close financial chain remain explicitly outside this review's certification.


## Daily lifecycle continuation review

A fresh read-only reviewer identified four Important findings: reopened-history recovery could omit posting state, snapshot-local arithmetic accepted phantom sale events, report regeneration after reopen lost the prior frozen report, and report generation lacked serialization against close/reopen and other generators. Each was accepted and corrected in one pass. Targeted regressions reproduce missing state, invented events and lost report history; real-database concurrency checks exercise serialized report generation. The host additionally reproduced and fixed mutable major-unit snapshot amounts, duplicate snapshot events, malformed daily replay receipts, manual resets losing authoritative rows and deletion of frozen reports. No second review round was requested.

The browser changes are covered by host VM tests for stale loads, revision-bound requests, retained retry keys, isolated/restorable drafts, draft export/logout cleanup and unavailable historical quantities. This is not an independent visual/accessibility review. The full close, reverse, resell and empty-target restore chain is exercised against disposable MongoDB. Wider report reconciliation and physical browser/native/production acceptance remain open.


## Financial reconciliation continuation review

A fresh read-only reviewer examined the shared summary service, report/CEO routes and financial browser outputs. It independently reproduced an Important omission of EXTRA/reversal costs from daily CSV detail profits and a Minor cached CEO-print month mismatch. The host accepted both and added failing unit regressions, then fixed category-aware sold-cost export and account/month-bound printing. The reviewer ran the original 4 VM cases and focused reproductions; its review preceded the fixes and does not constitute a second-round approval. Host verification covers the corrected cases.

Additional host checks cover exact stored-money rejection, immutable closed values across raw expense drift and close/reverse/resell, report old/new retention and stable regeneration, monthly balance non-additivity, unsaved-day sales, cross-shop attribution, zero amounts and rejected monthly requests. No production migration, live-data reconciliation, economic duplicate cleanup, real browser visual/native acceptance or throughput certification is claimed.


## Stock paging continuation review

A fresh read-only reviewer checked scoped cursors, filter-before-page semantics, legacy compatibility, size/record bounds, complete snapshot exports and stock UI ownership. It independently confirmed an Important stale-scope render path: grouping could reinsert cached cards from the prior shop while a new load was pending. The host reproduced/fixed it with a VM regression and guarded cross-scope selection. The reviewer also reproduced a Minor omission of the search filter in printed stock metadata; a failing/passing unit regression now covers the escaped label. No further Critical/Important API findings were reported. No second review round, production access or physical browser/native acceptance occurred.


## Sales paging continuation review

A fresh read-only reviewer checked event-level limits, source projection/canonical conversion, posting-date filters, cursor scope, complete exports and sales UI reversal ownership. It confirmed one Important issue: single reversal checked current account/filter values but omitted loaded-page scope/ID membership and page identity after confirmation. Search debounce or a Next response could leave a stale row usable. The host reproduced/fixed that path with a unit regression, checking both scope and active original membership before review and captured page identity afterward. No other Critical/Minor findings were reported. Reviewer VM checks passed; its MongoDB initialization was blocked by sandbox loopback EACCES, so host-approved integration checks are the database evidence. No second review round, production contact or physical browser acceptance is claimed.


## Catalog paging continuation review

A fresh read-only reviewer inspected the shared document reader, resource-specific permissions/cursors, browser pager, form/delete ownership and complete outputs. It reproduced one Important issue: quoted product names/notes could still be interpreted as spreadsheet formulas when exported by an administrator. The host added a failing regression and now emits formula-leading textual fields as literals, including whitespace/control prefixes, preserving numeric values. The host additionally reproduced/fixed product deletion after a search change and malformed pager cursor acceptance. The reviewer ran the then-current 8 VM cases successfully and reported no further actionable finding; that run preceded fixes and is not second-round approval. No production access or independent visual/device acceptance occurred.


## History/report/activity continuation review

A fresh read-only reviewer found one Important issue: the shared BSON preflight measured full stored days before projecting history metadata, so several large sheets could reject a tiny index response. A synthetic probe reproduced the disparity; the host added a failing disposable-DB regression and moved projection before database-side sizing. Full exports still use their full permitted projection and retain byte/record caps. Shared stock/catalog regressions verify that selected oversized fields are still rejected before fetching. No other actionable finding was reported. Reviewer integration initialization was blocked by sandbox loopback EACCES; host-approved real-DB runs supply integration evidence. No second review round or production/visual acceptance is claimed.
