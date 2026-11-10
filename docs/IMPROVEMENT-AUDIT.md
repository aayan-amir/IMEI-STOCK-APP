# Stock-ly improvement audit

Reviewed 2026-11-08 against baseline `38e4110` and the current working tree. This is an implementation backlog, with source evidence and completion checks, for making the existing inventory app reliable, fast, and polished.

## Executive assessment

The highest-value work is repairing trust in the app: a confirmation must confirm, a failed save must stay failed, a phone must be sold once, historical accounts must remain historical, and backups must restore all business data. These defects affect the value of subsequent performance and interface work.

Keep the current Express/MongoDB/vanilla-JavaScript architecture for the first passes. A framework rewrite would expand the work without itself resolving the stock, accounting, and recovery defects below. Incremental separation of business logic and UI state is justified; a rewrite is not established as necessary by this audit.

There are **45 improvement areas** below. They are not 45 equally certain bugs. Evidence labels:

- **Reproduced:** isolated execution of current functions or a deterministic example; no database or hosted API.
- **Source:** directly observed implementation behavior or missing guard. Production incidence is not established.
- **Risk:** a failure mode implied by the implementation, requiring concurrency, fault-injection, database, or device validation.
- **Proposal:** a product or engineering improvement to validate; not a demonstrated defect.

Priorities: **P0** protects persisted stock, financial correctness, access, or recovery; **P1** repairs core usability and scale; **P2** completes polish and maintainability. Priority is implementation order, not a security severity rating.

## Evidence obtained safely

No application server, migration, MongoDB connection, or hosted business-data endpoint was run. No credential or private-key contents were opened. Existing map documents were used for navigation; important findings were checked in owning source.

| Check | Observed result |
|---|---|
| Current authored JavaScript syntax | 30 files passed `node --check`; vendor ZXing excluded |
| Confirm modal, actual `utils.js` in a Node VM with DOM stubs | `_resolveConfirm(true)` resolved the promise to `false` |
| Actual API helper with rejected fetch | Returned `{}` |
| Actual API helper with non-JSON HTTP 500 | Returned `{}` |
| Actual `loadDay()` with two same-model sales costing 100 and 200 | Grouped cost used by `recalc()` was 200; actual combined cost was 300 |
| Inventory render-key expression | Changing a price without changing count/end IDs produced the identical key |
| Date expression at 2026-11-08 01:00 in Karachi | Produced `2026-11-07` |
| Static HTML label inspection | 28 label elements; none used `for` or wrapped a form control. Individual controls may still have other accessible-name mechanisms |
| Tracked PNG/SVG footprint | 74,781,161 bytes, approximately 74.8 MB; not an APK-size measurement |
| Dependency installation | `node_modules` absent; application integration tests and native build not run |

The first VM attempt lacked a DOM method used by escaping. The successful rerun stubbed escaping for fixed fixture strings; confirmation resolution, API handling, and daily grouping executed the current application functions. These probes are diagnostic reproductions, not a passing regression suite.

## 1. Restore correctness and data safety

### 01 — P1 · Reproduced · Affirmative confirmations are discarded

**Evidence:** `public/js/utils.js:45` calls `closeModal()` before reading `_confirmResolver`; `closeModal()` resolves it with `false` and clears it at line 54. Delete, reverse, clear, and restore flows using this helper cannot receive an affirmative result through this path.

**Change:** detach the resolver, close the modal, then resolve exactly once with the chosen value. Define what happens when another modal opens while a confirmation is pending.

**Complete when:** confirm yields true, cancel/backdrop/Escape yield false, replacement does not strand a promise, and repeated activation cannot resolve twice. Exercise each destructive caller after repairing this guard: previously unreachable operations will become reachable.

### 02 — P0 · Reproduced + source · API failures can become success messages

**Evidence:** `public/js/utils.js:94` ignores non-401 HTTP status and returns `{}` on network/parse errors and 401. `public/js/imei.js:275` treats any result without `error` as a successful add and clears the form. `public/js/daily.js:221` reports saved after any resolved API result, including a JSON error response.

**Change:** establish one explicit error contract for status, network, timeout, validation, rate limiting, and malformed responses. Migrate all callers together; simply making the helper throw will break callers lacking catches. Retain entered data and distinguish unavailable data from a genuinely empty list.

**Complete when:** offline, 401, 403, 409, 429, 500, HTML responses, and aborted requests never produce a successful save or clear unsaved input. Successful mutations require an acknowledged response.

### 03 — P0 · Risk · Selling the same phone is not concurrency-safe

**Evidence:** `routes/stock.js:93` reads status, then saves Phone at line 114, then creates Sale at line 132. The compensating rollback is separate and does not clear `soldByShop`. Two requests can pass the same initial status check.

**Change:** use a conditional state transition plus an atomic unit for Phone and Sale, with an operation/idempotency key for retries. Verify deployment topology before selecting MongoDB transactions. A conditional Phone update alone does not make the multi-document sale atomic.

**Complete when:** simultaneous sales of one IMEI produce one acknowledged sale and one conflict; response loss/retry does not duplicate a sale; injected write failures leave consistent stock and sales.

### 04 — P0 · Source + risk · Database uniqueness does not enforce business identities

**Evidence:** `db/index.js:78` declares a non-unique IMEI index. Day, HQStock, Report, and Product schemas at lines 97, 117, 157, and 165 do not enforce their application-level unique keys. Routes precheck/upsert these identities.

**Change:** inventory duplicates first, decide identity rules, then migrate and enforce unique indexes for primary IMEI, day `(shop,date)`, HQ singleton, report `(type,shop,period)`, and normalized product identity where intended. Include missing/null legacy IMEIs in migration design; do not blindly add unique indexes to dirty data. Cross-collection warehouse/shop IMEI uniqueness needs an additional design, not just a Phone index.

**Complete when:** concurrent creates/upserts cannot create duplicates, conflicts return 409, and a rehearsed migration preserves legacy records.

### 05 — P0 · Source + risk · Warehouse receipt and dispatch can partially apply or overwrite concurrent work

**Evidence:** `routes/warehouse.js:124` reads and replaces the entire HQ items array; receipt history saves afterward at line 138. Dispatch inserts Phones at line 218 and updates HQ separately at line 223, followed by dispatch history. Concurrent array replacements can lose other receipts/dispatches; later failures can leave multiple representations inconsistent.

**Change:** transactional stock movement or a durable recoverable movement ledger, conditional inventory removal, and idempotent receipt/dispatch IDs. Retain one ownership/location invariant per IMEI.

**Complete when:** overlapping receipts and dispatches cannot lose inventory, duplicate placement, or leave movement history inconsistent after injected failures.

### 06 — P0 · Source + risk · Sale reversal and deletion need a consistent accounting model

**Evidence:** `routes/sales.js:17`, `:40`, and `:58` update Phone and delete Sale separately, identifying Phones by IMEI. Reversal unsets `salePrice` and `soldAt` but leaves `soldByShop`. `routes/stock.js:259` also removes sales when deleting sold stock.

**Change:** link reversals to a specific sale/movement, perform coordinated writes, clear all sale-state fields, and preserve a financial audit trail. Decide retention and whether historical sales are voided rather than erased.

**Complete when:** reversal after retry, concurrent activity, or resale cannot revert the wrong sale; historical reports have a documented, consistent treatment of reversals.

### 07 — P0 · Source · Backup is incomplete and restore changes business meaning

**Evidence:** `routes/backup.js:10` exports seven model groups but omits Products, Customers, AuditLog, and Report. Restore allowlists at lines 48, 59, 70, and 81 omit `soldByShop`, phone notes, `carryForward`, and expense `month` respectively. Some fields in those allowlists do not exist in the live schemas. The Day schema actually persists `carryForward` (`db/index.js:104`).

**Change:** versioned backup schema covering tenant business models and their actual fields; explicitly document master identity/session exclusions. Preserve stable IDs and selling attribution. Provide compatibility conversion for existing version-1 backups.

**Complete when:** fixture export → empty-tenant restore → export preserves all agreed fields and links, including products, contacts, cash carry-forward, cross-shop sales, and monthly expense totals.

### 08 — P0 · Source + risk · Restore is neither reliably reported nor repeatable

**Evidence:** `routes/backup.js:80`, `:101`, and `:108` insert records without retaining IDs and catch insertion failures, then return `{success:true}` at line 115. Other collections merge/upsert, HQ is replaced, and empty arrays do not clear existing data. This is a mixed merge, not an exact snapshot restore. The 50 MB route parser at line 37 is preceded by global `express.json()` at `server.js:67`.

**Change:** validate the entire file and version before writes; show a dry-run summary; define merge versus replacement semantics; return exact counts/errors; preserve identity and support retry. Put bounded large-body parsing where it can actually apply. Choose a rollback/staging strategy suitable for backup volume.

**Complete when:** malformed, unsupported, oversized, duplicate, interrupted, and repeated restores have explicit outcomes; no partial restore is silently reported as complete.

### 09 — P0 · Reproduced · Mixed purchase costs yield incorrect daily profit

**Evidence:** `public/js/daily.js:32` groups same-model/storage phones using the first phone's `buyPrice`; `recalc()` at line 199 multiplies that cost by all sold units. Costs 100 + 200 become 100 × 2.

**Change:** sum exact sale costs independently of display grouping. Distinguish stock valuation from cost of goods sold, and preserve per-sale cost snapshots.

**Complete when:** different costs, cross-shop sales, zero-cost entries, reversals, and grouped/flat displays agree with the sale ledger to the currency's supported precision.

### 10 — P0 · Source · Historical daily sheets are rebuilt from current stock

**Evidence:** `public/js/daily.js:32` fetches live stock for every selected date, discards saved non-EXTRA rows, counts currently in-stock phones, and sets opening to current stock plus selected-day sales; inbound quantity is always zero. Later receipts, sales, transfers, and edits can change a past day's reconstructed values.

**Change:** decide the accounting contract: draft/reconciled current day versus an immutable closed-day snapshot or ledger-based historical reconstruction. Define reopen permissions and version history.

**Complete when:** a closed day remains stable after subsequent stock movements and metadata edits; historical opening + inbound − outbound reconciles to historical closing.

### 11 — P0 · Source · Profit and expenses have competing sources of truth

**Evidence:** `public/js/daily.js:197` includes daily-sheet expenses and EXTRA entries. `routes/analytics.js:65` uses Sale and ShopExpense. `routes/reports.js:34` uses day expenses for daily reports, but monthly reports at line 58 use ShopExpense only; daily `ALL` reports use no Day document and thus zero day expenses.

**Change:** define one financial model for sales, cost, expenses, extras, transfers, purchases, and closing balances; explicitly label any intentional cash-versus-accrual differences. Derive screens/reports from shared calculations.

**Complete when:** the same seeded period reconciles across daily sheet, history, monthly P/L, CEO, reports, print, and export. Differences must be explained by explicit accounting rules.

### 12 — P0 · Reproduced + source · Business dates use inconsistent timezone assumptions

**Evidence:** `public/js/globals.js:7` uses UTC for today, and `daily.js` compares UTC timestamp substrings to selected days. `routes/analytics.js:60` uses UTC month but constructs the previous month with local `Date` at line 62 and converts back to UTC. Around midnight/month boundaries these operations need not agree with the shop's calendar.

**Change:** set a tenant business timezone, store instants consistently, and derive day/month boundaries in that timezone. Validate real dates and require period shape to match daily/monthly report type (`routes/reports.js:30` currently accepts either).

**Complete when:** Karachi midnight, month/year rollover, server timezone differences, and a second tenant timezone produce correct and consistent periods.

### 13 — P0 · Source + risk · Daily saves can overwrite another editor

**Evidence:** `routes/days.js:35` replaces submitted day fields without revision checks; `public/js/ui.js:35` switches context and `loadDay()` replaces `dayState` without a dirty-state decision.

**Change:** revision-based conditional saves and visible conflict handling; dirty indicators, preserved drafts, and protection when navigating, changing date/shop, or expiring a session. Do not silently resubmit writes after an ambiguous network failure.

**Complete when:** two editors cannot silently erase one another; context changes and reconnects preserve or explicitly discard edits.

## 2. Tighten access and validation boundaries

### 14 — P0 · Source · Product mutations bypass shop ownership filtering

**Evidence:** listing and creation scope shop sessions in `routes/products.js:8` and `:27`; edit/delete at lines 59 and 77 use only record ID with `anyAuth`.

**Change:** include authorized shop ownership in mutation predicates and centralize scope rules. Make missing and inaccessible results behave consistently.

**Complete when:** a shop cannot edit/delete another shop's product even with its ID; admin access still follows the agreed tenant policy.

### 15 — P1 · Source / policy decision · Cross-shop sale authority is broader than ordinary stock ownership

**Evidence:** `routes/stock.js:93` finds the phone tenant-wide and line 101 accepts any valid `soldByShop`, including for a shop session. The UI explicitly supports cross-shop sales, so this is not automatically a bug.

**Change:** document who may sell another shop's stock and who may choose the credited shop. If cross-shop selling is allowed, require explicit visibility/acknowledgment and record both identities; prevent unauthorized attribution changes.

**Complete when:** role/ownership/credited-shop combinations have an agreed authorization matrix and automated coverage.

### 16 — P0 · Source · Authentication throttling does not count ordinary wrong-password responses as failures

**Evidence:** `middleware/auth.js:83` uses `skipSuccessfulRequests:true`; `routes/clients.js:47`, `:54`, and `:65` return HTTP 200 for bad credentials. Successful HTTP responses are skipped by the configured limiter's default success classification. Browser-only lockouts are not enforcement.

**Change:** align HTTP failure statuses or limiter success classification with authentication outcome; balance IP and account limits for shared shop networks. Use a shared store if running multiple instances.

**Complete when:** repeated bad passwords consume the server-side limit regardless of browser storage; valid login recovery and shared-network behavior are tested.

### 17 — P0 · Source · Superadmin has a known fallback and inconsistent response redaction

**Evidence:** `middleware/auth.js:21` defaults to literal `superadmin`. Create/update returns full Client documents at `routes/clients.js:134` and `:138`, while list redacts password hashes at line 153.

**Change:** fail closed or disable platform administration when configuration is missing; consistently project public Client fields. Consider authenticated, revocable platform-admin sessions as a later identity improvement.

**Complete when:** an unset secret cannot authorize administration; no response returns password hashes or secret material.

### 18 — P0 · Source · Session lifecycle ignores account changes

**Evidence:** `middleware/auth.js:35` checks token/expiry but not current Client status or shop membership. Session embeds a shop snapshot. Password updates (`routes/clients.js:85`) and client changes/deletion do not revoke existing sessions. `deleteSession` exists without a logout route.

**Change:** server logout, revocation on relevant credential/status/shop changes, and current tenant-state enforcement. Resolve the session once per request; reuse it for tenant selection and authorization rather than querying twice.

**Complete when:** logout, pause, deleted tenant, removed shop, and password changes have explicit immediate session outcomes; cached model handles cannot authorize a deleted tenant.

### 19 — P0 · Source + risk · Tenant handles are allocated before authorization is established

**Evidence:** `middleware/auth.js:105` accepts a supplied tenant ID when session lookup fails and still attaches tenant models at line 123; route auth rejects later. The database handle cache is unbounded (`db/index.js:200`). This does not prove unauthorized data reads, because business routes still have auth guards.

**Change:** authenticate before creating tenant handles, validate tenant identity/existence, and bound/evict caches with a deletion lifecycle.

**Complete when:** invalid tokens/arbitrary tenant IDs cannot grow tenant/model state, and deleted tenants are removed from the cache.

### 20 — P1 · Source · Validation and errors vary by route

**Evidence:** sparse schema constraints (`db/index.js:60` onward); batch stock validation differs from single edits (`routes/stock.js:196`, `:245`); product quantities are coerced/truncated and bad prices become zero (`routes/products.js:25`, `:64`); daily payloads include mixed/untyped arrays (`routes/days.js:35`). Sale price rejects NaN but not all non-finite numbers (`routes/stock.js:98`).

**Change:** shared boundary validators for finite money, integer quantity, IMEIs, real dates, enum status, allowed shop, IDs, bounded strings/arrays, and required metadata. Reject malformed input instead of silently turning it into zero. Return field-level 400/422 errors and distinguish duplicate/conflict from server failures. Decide currency representation before migration.

**Complete when:** the same invalid value is rejected consistently across create/edit/batch/restore; malformed IDs do not become unexplained 500s.

### 21 — P1 · Source · Runtime configuration and error handling are incomplete

**Evidence:** `server.js:47` parses `ALLOWED_ORIGINS` but uses unrestricted `cors()`; inline handlers require permissive CSP at lines 54–55. There is no central JSON API error/404 handler after route mounting.

**Change:** validate environment configuration at startup; implement the documented origin policy including native/local origins; standardize JSON errors with request IDs and safe logging. Migrate inline handlers before tightening CSP. Configure parser limits intentionally.

**Complete when:** allowed/denied origins, parser errors, unknown API routes, and unexpected failures have predictable contracts. Check that development origin and CSP policies agree.

## 3. Optimize the actual request and rendering paths

### 22 — P1 · Source · Lists transfer entire histories

**Evidence:** unbounded stock, sales, days, shipments, customer, and product queries in their route list handlers; `public/js/imei.js:1081` downloads all sales before UI date filtering. Reports are capped at 100 (`routes/reports.js:15`) but have no next-page contract.

**Change:** bounded server-side pagination, date/shop/status/search filters, explicit stable sorting and tie-breakers, DTO projections, and lean reads where model behavior is unnecessary. Make export an explicit full-data path rather than accidentally exporting only a page.

**Complete when:** normal page payloads stay bounded as history grows; navigation and export produce correct results with multiple pages and ties.

### 23 — P1 · Source / measurement needed · Indexes do not match several frequent queries

**Evidence:** `db/index.js` defines Phone and AuditLog indexes but no explicit Sale, Day, ShopExpense, Customer, Report, or Product query indexes. Queries filter sales by selling shop/date and expenses by month/shop.

**Change:** measure representative `explain('executionStats')` before adding targeted compound indexes; likely candidates include Sale attribution/date, Day shop/date, expense shop/month, and Product shop/normalized-name. Match cursor sort order. Account for the fallback attribution `$or` and migrate it if appropriate.

**Complete when:** representative workloads show lower examined documents and bounded latency without unnecessary write/index overhead. Schema declarations alone do not establish deployed index state.

### 24 — P1 · Source · Analytics hydrates/loads records to aggregate in Node

**Evidence:** `routes/analytics.js:15` and `:65` read matching sales/stock then group/reduce in JavaScript; reports do similar work at `routes/reports.js:36` and `:60`.

**Change:** database-side grouped summaries, finite date ranges, narrow projections, and reusable accounting queries. Add scoped caching only after correctness and invalidation rules are established.

**Complete when:** large fixture datasets return the same financial totals with lower response size, process memory, and measured request time.

### 25 — P1 · Source · Background and boot requests do redundant work

**Evidence:** `public/js/ui.js:113` polls stats every 12 seconds, including hidden tabs; `switchShop()` calls stats and `bootApp()` also awaits stats (`public/js/app.js:11`, `:15`). Tenant middleware and route guards query the same session twice.

**Change:** deduplicate in-flight reads, refresh after acknowledged writes, pause/background-backoff polling, and reuse request session state. Polling frequency should reflect a defined freshness requirement.

**Complete when:** one boot does not issue duplicate identical stats calls; hidden tabs cease routine polling; a sale refreshes dependent views once.

### 26 — P1 · Risk · Late responses can overwrite a newly selected shop/page

**Evidence:** shared `activeShop`, `allIMEIStock`, and `dayState` are assigned after awaited requests (`public/js/imei.js:675`, `daily.js:32`); `switchShop()` starts fresh loads without request cancellation or a request-context guard.

**Change:** capture tenant/shop/date/query context per load, abort superseded reads, and discard responses whose context no longer matches. Separate independent view state.

**Complete when:** deliberately resolving A after B during rapid shop/date/filter switching never paints A under B's label.

### 27 — P1 · Reproduced · Inventory render cache ignores actual record changes

**Evidence:** `public/js/imei.js:717` keys only count, grouping/filter, and first/last IDs. Edited price/model/color, middle-row changes, and shop changes with overlapping IDs are not represented.

**Change:** explicit render invalidation/data revisions or keyed record updates; preserve selection/expanded groups deliberately. Do not trade correctness for flicker avoidance.

**Complete when:** price, model, status, selection, and search-result changes appear immediately without force-refresh or accidental loss of expansion state.

### 28 — P1 · Source · Inventory rendering scales with the whole dataset

**Evidence:** `renderIMEIStock()` at line 699 filters/groups arrays and assembles cards with `innerHTML`; search triggers the same path. Global arrays retain complete collections.

**Change:** first bound the dataset through pagination; then measure rendering and add debounced search, normalized searchable values, incremental updates, or virtualization only if needed. Keep accessible table/card navigation and bulk selection semantics.

**Complete when:** a representative large inventory stays responsive while typing, filtering, expanding, and selecting; measure p95 interactions rather than assuming a faster framework fixes it.

### 29 — P1 · Source · Initial loading includes the scanner and every feature

**Evidence:** `public/index.html:18` loads ZXing synchronously in the head; remaining feature scripts are loaded for all users at lines 933–941. Measured ZXing size is 292,357 bytes (87,701 bytes with local gzip).

**Change:** load scanner code on first scanner use and feature code when needed, preserving existing global dependencies until deliberately modularized. Define an asset delivery strategy with versioning and appropriate compression/cache headers at the app or host.

**Complete when:** login/ordinary inventory does not fetch the decoder; scanner still works on first use, after failure/retry, and in the packaged app. Measure cold load before/after.

### 30 — P1 · Source · Batch addition pays one round trip per phone

**Evidence:** `public/js/imei.js:110` awaits `/api/stock/add` serially for each queued entry; failed API results can currently also be counted as saved.

**Change:** bounded validated bulk endpoint with item outcomes and operation IDs, or carefully limited concurrency after backend invariants are fixed. Make partial completion and retry explicit.

**Complete when:** large batches finish with bounded requests, exact success/failure counts, and retry only failed/unacknowledged entries without duplicates.

### 31 — P1 · Source + risk · HQ is one growing document and products use read-modify-write quantities

**Evidence:** `db/index.js:117` stores all HQ items in an Array; warehouse moves read/replace that array. `routes/products.js:30` finds a product and adds quantity in memory before saving.

**Change:** atomic product increments with a normalized identity and conflict-safe upsert. Plan per-IMEI warehouse records or a unified inventory/movement model instead of unlimited singleton growth; migrate only after correctness safeguards and reconciliation tooling.

**Complete when:** simultaneous product receipts retain both increments and warehouse operations scale without fetching/replacing the full tenant inventory document.

## 4. Polish the workflows users repeat

### 32 — P1 · Source / proposal · Consistent loading, failure, empty, and saved states

**Evidence:** `loadIMEIData()` converts non-array failures into empty stock; `loadDay()` assumes `stockItems.forEach` exists; mutation feedback varies by caller.

**Change:** one UI-state pattern: loading, loaded-empty, loaded-data, stale-with-error, retry, and saved. Keep last good data visibly stale after failures, avoid flicker, show local field errors, and prevent double-submit while retaining input.

**Complete when:** every page and mutation handles slow network/offline/permission/session/conflict scenarios with accurate copy and an obvious recovery action.

### 33 — P1 · Source / proposal · Modal and form accessibility needs a complete interaction contract

**Evidence:** `showModal()` injects HTML without moving/trapping/restoring focus (`utils.js:17`); the shared dialog at `index.html:928` has no accessible-name reference. All 28 static labels lack `for` or nested controls. There are already positive foundations: live toast, skip link, keyboard activation helper, and reduced-motion CSS; preserve them.

**Criteria:** WCAG 1.3.1 Info and Relationships (A), 3.3.2 Labels or Instructions (A), 4.1.2 Name, Role, Value (A), 2.4.3 Focus Order (A), and 2.4.7 Focus Visible (AA). A full conformance judgment needs rendered/manual testing.

**Change:** associate labels and errors, name dialogs, move focus into a modal, contain modal navigation, make the background inert, restore the opener, and supply consistent visible focus. Prefer native buttons while preserving existing keyboard operation.

**Complete when:** keyboard and screen-reader users can sign in, add/sell/edit, confirm/cancel, use the scanner alternative, and return to the invoking control without reaching background controls through an open modal.

### 34 — P2 · Proposal · Navigation, filters, and active context should remain predictable

**Evidence:** `nav()` (`public/js/ui.js:4`) switches hidden sections and resets some date filters; shop selection and per-page filters interact. Filters have active visual classes but need consistent exposed state.

**Change:** preserve relevant query/filter state, add URL/history handling where useful, expose active page/filter semantics, and keep shop/date scope unmistakable near risky actions. Separate role-based access from screen-size presentation.

**Complete when:** users can navigate away/back and retain intended filters; browser back and refresh have defined behavior; keyboard/screen-reader users receive the active context. Apply WCAG 4.1.2 to state and 2.4.6 Headings and Labels (AA) to control descriptions.

### 35 — P1 · Proposal · Scanner workflow needs device-level recovery and speed checks

**Evidence:** `public/js/imei.js:347–658` coordinates permission, stream selection, torch, focus, two-IMEI modes, native decoder/fallback, and delayed callbacks. Desktop inspection cannot establish its reliability on actual cameras.

**Change:** test denied/unavailable camera, unsupported torch/focus, rapid open/close/reopen, background/resume, orientation, duplicate detections, secondary IMEI, and slow decoder loading. Always retain manual entry. Reuse entry metadata for repetitive stock intake without silently carrying data into an unrelated sale.

**Complete when:** a physical Android/browser matrix shows no lingering camera indicator after close, no duplicated scan actions, clear permission recovery, and measurable scan-to-add/sell completion times.

### 36 — P2 · Proposal · Desktop and phone layouts need a visual consistency pass

**Evidence:** one 58,373-byte stylesheet spans many feature-specific rules and breakpoints; mobile tables explicitly use horizontal overflow (`public/css/app.css:2328`). No rendered visual audit was performed, so spacing, contrast, and target-size failures are not asserted here.

**Change:** consistent spacing/type/field/button tokens, dense readable inventory, aligned monetary figures, visible hierarchy, restrained statuses, sticky context/actions where useful, and content-aware mobile cards/tables. Review empty and very long content as carefully as normal data. Keep loss/profit meaning understandable without color alone.

**Complete when:** screenshot/manual checks cover 320/390px phones, tablet, desktop, 200% text, text-spacing overrides, keyboard focus, long shop/model names, and large PKR values. Measure contrast and targets against WCAG 1.4.3 (AA), 1.4.11 (AA), 1.4.10 (AA), 1.4.12 (AA), and 2.5.8 (AA); do not assume every two-dimensional data table must become a card.

### 37 — P1 · Source / proposal · Exports and printing need trustworthy output

**Evidence:** `public/js/imei.js:1072` joins unescaped CSV cells, and truthy checks turn some zero values into blanks. `public/js/ceo.js:875` centralizes download but not field serialization; print uses timed iframe behavior at line 642.

**Change:** shared CSV serializer with quoting for commas/quotes/newlines, safe treatment of spreadsheet-formula-leading text, explicit money/date formatting, and an IMEI-preservation format or spreadsheet export. Print after content/fonts are ready, using print lifecycle cleanup and clear active filters/totals.

**Complete when:** quotes, commas, newlines, Unicode, formula-leading names, zero amounts, 15-digit/leading-zero identifiers, multiple pages, and cancelled print produce correct portable output. Verify downloadable files on the Android wrapper as well as desktop.

## 5. Make local development, Android, and releases reproducible

### 38 — P0 for safe testing · Source · Local frontend defaults to hosted API

**Evidence:** `public/js/globals.js:4` sends localhost and Capacitor requests to `https://www.stock-ly.app`. A local UI is not an isolated test environment; Express CSP also allows only same-origin connections.

**Change:** explicit environment/API-origin configuration, same-origin local defaults, conspicuous nonproduction context, and a seeded disposable tenant/database. Keep native production origin separately configured.

**Complete when:** browser and automated test network logs prove local testing cannot contact hosted business data unintentionally; native packaged builds use their intended environment.

### 39 — P1 · Source · Application regression tests and CI are missing

**Evidence:** `package.json:8` is a failing placeholder. Existing Android tests are templates, and instrumentation expects a different package (runtime map). Syntax checks do not verify business logic.

**Change:** start with deterministic helper/accounting tests, API tenant/shop access tests, concurrency/fault-injection tests, backup round trips, and browser happy/failure paths against isolated fixtures. Introduce lint/syntax/test/build checks in CI, prioritizing stock/accounting over implementation-mirroring tests.

**Complete when:** CI protects the invariants in areas 01–21 and one add → sell → reverse → report → backup/restore journey. Tests must never use the hosted tenant.

### 40 — P1 · Source · Node and native package contracts are inconsistent

**Evidence:** manifest declares Node >=18 while locked Mongoose/MongoDB require >=20.19.0. Android Gradle references Capacitor packages absent from npm manifest/lock; ordinary `npm ci` cannot supply those native inputs.

**Change:** align runtime declarations with a deliberately selected supported deployment version; restore compatible Capacitor core/CLI/Android dependencies and documented sync/build commands. Validate wrapper/test package identities. Verify versions and toolchain documentation at implementation time.

**Complete when:** a clean checkout can install, run isolated tests, sync assets, and build a debug Android app through documented commands on a clean environment.

### 41 — P1 · Source · Native icon assets are unnecessarily large

**Evidence:** 74.8 MB of tracked images; multiple density-specific launcher PNGs are each exactly 4,666,881 bytes. This is source footprint, not proof of delivered APK bloat or startup impact.

**Change:** inspect source dimensions, generate appropriate density assets/adaptive icon layers, optimize losslessly where appropriate, and remove redundant generated copies from the source workflow only after confirming ownership.

**Complete when:** installed launcher/splash appearance is unchanged or improved across densities and the measured APK/source footprint is reduced. Record actual artifact sizes before claiming download/runtime gains.

### 42 — P1 · Source / proposal · Native keyboard, back, sharing, and network behavior need explicit acceptance

**Evidence:** manifest uses `adjustPan`, Capacitor sets Keyboard resize `none`, and there is custom viewport code. The config names a Keyboard plugin without declaring its package. Native cleartext allowlist and `allowBackup=true` deserve intentional policy decisions (Android manifest/network config).

**Change:** verify installed plugins, keyboard/focused-field visibility, safe areas, hardware back behavior, app background/resume, file import/export/print integration, and production network/backup requirements.

**Complete when:** real-device tests cover small screens and slow/offline networks without hidden focused fields, unexpected app exits, broken downloads, or unintended cleartext requests.

### 43 — P1 · Source / proposal · Runtime health and business observability are too limited

**Evidence:** `server.js:84` returns a useful DB-not-ready 503, but there are no dedicated liveness/readiness endpoints, request IDs, latency instrumentation, or coordinated shutdown in the entry point. `logAction()` is fire-and-forget and only some mutations use it.

**Change:** separate process liveness from database readiness, handle graceful termination/reconnect lifecycle, record bounded structured request/error metrics, and expand durable audit coverage for sensitive business mutations. Define retention and avoid logging secrets/customer details unnecessarily.

**Complete when:** deployment probes, DB outages, termination during requests, slow queries, failed audit writes, and failed movements are diagnosable with correlation IDs and clear operational signals.

### 44 — P1 · Source + risk · Maintenance scripts and repository artifacts need containment

**Evidence:** `create-client.js` has its own schema and bypasses live password hooks; historical migration utilities can overwrite data; `scratch/check_clients.js` prints password fields (runtime map). Git tracks `certs/key.pem` and IDE/build artifacts despite ignore rules. Key contents were not opened and current use is unknown.

**Change:** archive/label historical destructive tools, use live schema/service logic for supported provisioning, require explicit targets and dry-run summaries for maintenance, and remove credential output. Review tracked private-key exposure with the owner; remove from tracking and rotate if it was a real exposed credential. Clean generated artifacts deliberately without deleting needed local files.

**Complete when:** supported provisioning creates valid hashed credentials; maintenance cannot silently target production; credential/artifact review is documented and actionable cleanup is verified.

### 45 — P2 · Proposal · Reduce shared-state coupling after behavior is protected

**Evidence:** nine ordered browser scripts share global state/inline handler names; large frontend modules combine data loading, financial calculation, HTML generation, exports, and event behavior. Routes combine authorization, validation, stock movements, and persistence.

**Change:** extract pure accounting/format/export functions, explicit per-view state, scoped API services, and domain mutation services incrementally. Consolidate CSS tokens and shared components without introducing abstraction for its own sake. Update repository maps as ownership changes.

**Complete when:** core business functions can be tested without DOM/server boot; loading one feature does not depend on unrelated globals; role/shop rules have one authoritative implementation.

## Execution order and decision points

| Pass | Work | Exit condition |
|---|---|---|
| A — Establish safe feedback | 38, initial 39, 01–02, 27, 33 core dialog/labels | Local fixtures are isolated; confirm/save/error states are reliable; repaired confirmation callers are checked |
| B — Protect business records | 03–08, 14, 16–20, critical 21 | Concurrent/retried sale, dispatch, reversal and restore are consistent; access boundaries and session revocation are tested |
| C — Reconcile accounts | 09–13, shared money/date rules from 20 | One agreed set of period fixtures agrees across all screens and exports |
| D — Reduce work per interaction | 22–26, 28–31, 29 asset delivery | Measured request counts, payloads, query work, and interaction latency improve with equivalent results |
| E — Complete workflow polish | 32–37, 15 policy, 34 navigation | Browser and physical-device flows are clear, accessible, recoverable, and efficient |
| F — Release and maintain | 40–45, remaining 21/39 | Clean builds, operational checks, Android acceptance, and updated documentation are repeatable |

Some work overlaps passes. For example, a lightweight index required for an integrity constraint belongs in B; a performance index still needs query measurement in D. Full backup atomicity and warehouse normalization are larger changes than a helper fix and should be scoped separately.

Product decisions before implementing their dependent areas: cross-shop sale/credit permissions (15), closed-day and reversal semantics (06/10), expense/cash/profit definitions (11), tenant business timezone (12), restore merge/replacement (08), and supported role capabilities on phones (34/42). Existing safe fixes and isolated measurement do not depend on deciding all of these at once.

## Measurement plan

Establish baseline with isolated tenants containing small, medium, and large datasets, for example 100 / 10,000 / 100,000 historical sale/stock records. These are proposed fixture sizes, not known production volumes. Use representative physical phones and a throttled browser connection.

- Cold sign-in/inventory: requests, compressed transfer, first usable content, long tasks, and memory.
- Inventory search/shop change: p50/p95 interaction time and stale-response correctness.
- API lists/analytics: p50/p95 latency, returned bytes/records, heap, and MongoDB documents/keys examined.
- Add/sell/batch/dispatch: acknowledged completion time, request count, duplicate/conflict rate under concurrency, and recovery after response loss.
- Accounting: exact reconciliation assertions rather than approximate visual comparisons.
- Scanner: time to camera readiness, time to valid detection, duplicate detections, and stream cleanup.
- Android: clean build duration, APK/download size, installed size, startup, and file/keyboard/camera behavior.

Set numeric performance budgets after recording the baseline and typical shop hardware; do not invent a speedup percentage from source inspection.

## Boundaries of this audit

This audit covers the mapped frontend, API, persistence, reporting, recovery, runtime, and native surfaces. It cannot prove that every bug has been found. No live database indexes/data, infrastructure configuration, production timings, visual contrast, physical-device scanner behavior, or Android build were verified. Performance opportunities and visual proposals are explicitly distinguished from reproduced defects.

Only this report was added by the audit. Product code, database data, runtime configuration, Git history/index, and the prior map files were not modified.
