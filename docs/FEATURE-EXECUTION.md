# Simple feature execution ledger

Plan: docs/superpowers/plans/2026-11-10-simple-stockly-final-plan.md

Current work includes the bounded durable bulk-intake browser/backend flow and source changes to guarded confirmations, existing-account status changes and lighter statistics reads. The latest full run completed 590/591 tests: one existing inventory-preflight child process returned no exit status; it was not diagnosed or rerun. Subsequent confirmation/status/statistics changes are explicitly untested because the user stopped further test work. Previous green checkpoints below remain historical evidence, not verification of current source. New business feature flags remain default off. Physical Android/build, real camera/print and other release acceptance gates remain unverified; the entire original backlog is not claimed complete.

Historical Task 0 starting state. Source checkpoint: C:/Users/AAYAN/.codex/visualizations/2026/11/08/01a1bb2b-7498-73f1-9672-9e82dc49166d/stockly-source-checkpoints/feature-baseline-1794275792674. Contains 132 allowlisted files with verified SHA-256 manifest; excludes secrets, dependencies and vendor assets. This is source recovery, not a business backup or full native artifact archive.

Compatibility contract: existing page IDs and legacy array endpoints remain. New business capabilities default off and require server authorization; absence of capability must not trigger optimistic new commands. Fully paid only; unknown historical tender remains unknown. Immediate accepted return restores stock through the retained sale-specific correction, with refund proof separate. No global confirmation enablement before all affected destructive callers are guarded.

At the initial checkpoint, remaining Task 0 work was observed browser/admin/shop journeys, executable capability tests and positive confirmation/permission review. Later entries below record execution beyond that checkpoint.

Fresh verification: 333/333 tests passed, zero skipped (92.3 seconds); syntax checked 104 authored files. Browser/native acceptance remains outstanding.


Task 1 started: grouped the sidebar into Overview, Inventory, Sales, Daily Close, Reports and Administration while preserving all 15 legacy destination IDs and existing loaders/routes. Overview/Reports/Customers/Phones/Movements labels replace overlapping or misleading labels. Scanner shortcut remains in Inventory. Explicit owner-only section markers replace dependence on old Head Office/Tools labels while retaining compatibility fallback. No confirmation helper, business write or financial rule was enabled/changed. New navigation regression observed failing before implementation, then passing. Remaining: actual browser journeys/visual acceptance, capability contract tests, full action/dialog review and subsequent feature tasks.
Fresh Task 1 shell verification: 335/335 tests passed, zero skipped (84.6 seconds); syntax checked 105 authored files. Ruling: reversible navigation markup may progress under VM/regression coverage while physical browser acceptance remains a release gate; no new business feature or destructive confirmation is activated. Task 1 is partial, not certified complete.

## Continued execution: read-only evidence and recovery

Removed the repetitive Overview Quick Insights block and changed generated summary headings from Invoice to Report. Added retained-sale receipts with exact paisa, text IMEI, recorded seller/owner separation, reversed status and explicit unknown payment/refund evidence. Reprinting performs no business write. Added owner-only bounded IMEI evidence by retained sales, receiving, dispatch and audit sources; legacy IMEI matching is labelled as evidence with possible gaps. Late source/account responses cannot overwrite a newer selection. Inherited object-property source names are rejected.

Browser observations used a disposable loopback replica and synthetic account only: owner sign-in exposed all six navigation groups; phone History preserved the leading-zero IMEI and showed explicit empty/gap notices; source switching worked; shop sign-in exposed only Inventory navigation and retained scan/phone access. The 368px viewport showed inventory controls without horizontal clipping. This is a limited browser smoke check, not complete alias/focus/320px/Android/print acceptance. Fixture was stopped afterward. Initial failed login was the tester entering the admin credential in the gate-password step, not an application defect.

Fresh pre-recovery full suite: 341/341 passing, zero skipped. Later recovery run: 347/347 passing, zero skipped (120.9 seconds); subsequent review fixes and comparison work are newer and need another full run. Syntax before recovery additions: 109 authored files.

Recovery v3 now explicitly covers the existing 19 v2 collections plus observation-only Stocktake metadata. V2 remains readable without inventing feature facts; v2 export refuses newer stock-check evidence instead of omitting it. Both review and apply inspect all 20 collections for target emptiness. The UI requests v3 and reviews stock-check counts. Legacy import rejects complete envelopes and requires reviewed empty-account recovery. New validation covers stock-check scope, exact identifiers, unique captured members, revisions, bounded observations/operations and completion timestamps. No stock-check writer or UI is active yet; operation schema must be finalized with that writer before activation.

Independent read-only review found two issues, both reproduced with failing regressions and fixed: complete envelopes falsely accepted by legacy import, and observations after a stock check finished. One focused concurrent database run failed to start its disposable MongoDB; isolated serial rerun passed 42/42, zero skipped, including both fixes and authenticated capability negotiation. No production database was contacted. Capabilities advertise only role-authorized evidence/receipt reads and keep stocktake/tender/customer-return/verified-close writers false.

Task 4 comparison rules have three passing unit cases: unchanged missing observations are discrepancies; sale/custody/cost/identity/timestamp/configuration changes require recheck; arrivals, wrong-shop scans and duplicate scans remain separate. Comparisons do not mutate inventory or money. Durable capture/scan/review commands and the operator UI remain to implement and recovery-test before enabling stock checks. Tasks 0/1/2 still retain their broader acceptance checklist; Task 3 remains partial until actual writer outcomes are round-tripped.

### Stock-check execution and approved payment policy

Subsequent work implemented durable capture, scans, frozen review and cancellation with original replay acknowledgments, revision conflicts, essential transactional audit, byte/count limits and v3 round trips. Owner-only API/list and the Choose shop / Scan / Review screen are present. STOCKTAKES_ENABLED defaults false; capability absence keeps controls hidden and direct commands are rejected server-side. A disposable browser account completed the full count journey with its leading-zero IMEI retained. This did not change inventory or financial records. Full suite at that checkpoint: 371/371, zero skipped, 91.4 seconds. Later tender changes need a fresh full result. Desktop smoke verification does not certify 320px/Android/camera or assistive-technology acceptance.

Review identified and regressions reproduced two further defects, now fixed: MongoDB aggregation needed explicit ObjectId casting to share the review fetch's size bounds; count-start identity must survive restore into another empty client. Stock-check recovery now reconciles operation fingerprints, contiguous revisions, exact acknowledgments and their retained audits. Completed review differences reconcile to captured members and observations, including tamper rejection. Runtime activation is explicit and no live setting has been changed.

User explicitly approved Cash / Bank, return to the original owning shop, and a full refund recorded separately with its actual method. They then said they are away, to keep working and ask no further questions until complete. Cash opening/cutover must consequently be supplied by the eventual owner setup screen, never invented by implementation.

Task 5 in progress: one versioned fully-paid payment record is stored on the retained sale itself (one sale ID is one payment identity), avoiding a duplicate collection. Accepted amount is derived from exact sale price, never entered twice. The sale, stock state, payment evidence, audit and replay receipt commit together. FULLY_PAID_SALES_ENABLED defaults false. When enabled, new writers require explicit version 2 negotiation and Cash/Bank; old valid requests can still replay retained outcomes before the new-writer gate. V2 export refuses payment evidence, while v3 validates and restores it exactly. Legacy unknown methods remain unknown. Focused tests pass for wrong-method/amount/credit rejection, audit rollback, oversell race, reversal/resale replay, role credit, method receipts and empty-account recovery. Shared capabilities now serve both the stock-check and sale forms without duplicate boot requests. The full tender regression run is ongoing; no new closing/cash-verification interpretation is enabled.

### Return/refund phase and current cash work

Later full checkpoints passed 382, 397 and 409 tests respectively, zero skipped; 409 took 103.1 seconds and predates the latest display-only polish and cash calculator. Task 6 now has owner-only default-off API and inline sale-specific review, physical receipt confirmation, original-owner restoration, separate confirmed full refund with actual paying shop, retained original outcomes, and exact v3 recovery. The v3 catalogue is currently the 19 legacy collections plus Stocktake and CustomerReturn; it remains an unreleased evolving format until the remaining cash metadata is finalized.

Independent review found unsafe Mixed result replay and legacy-v1 tender stripping. Both were reproduced with failing tests and corrected: one shared return-evidence validator now serves replay/review/recovery; v1/v2 paths refuse new evidence and require reviewed current-format recovery. Refund paying shop must be configured. UI requests retain an immutable command/key when uncertain, expose explicit retry, require actual receipt/refund confirmation, escape attributes, clear old-account evidence, and preserve original source IDs on correction rows. New forms have larger controls and readable Karachi timestamps. Real disposable-browser journey passed Cash sale credited to A from B stock -> return to B -> separately recorded Bank refund from B. No external payment was initiated; the fixture was stopped afterward.

Task 7 source audit confirmed the existing Sheet balance is not verified physical cash: it includes Bank revenue and accounting reversals and lacks channels/identities on manual rows. Supplier/stock costs and accessory quantity changes do not prove payments. No existing calculation rule or closed snapshot is being repurposed. A pure distinct cash-rule calculator now has five passing cases covering exact paisa, Cash/Bank separation, refund outflows, historical unknowns, current incomplete records, duplicate identities, opening-boundary source IDs, zero balances and overflow.

Remaining cash implementation must establish an owner-counted opening/cutover, serialize review/close against AccountingState versions and recovery/configuration epochs, and cover every money-bearing writer before activation. Working implementation direction: one canonical versioned manual money record for actual other income, expenses, purchase payments and completed shop transfers, with source IDs and retained corrections; route current form aliases to it after explicit client cutover. Existing inventory costs are excluded. Existing Day/ShopExpense representations must not count that canonical payment twice. Keep earlier financial inputs and frozen rule-1 DayVersion/rule-2 Report meanings intact; generated current financial inputs may reference canonical new records, while verified cash has its own frozen evidence/rule version. Unsupported manual writers must reject before mutation or make cash records explicitly incomplete. Never guess classification or occurrence, and do not claim the current pure calculator or source audit completes Task 7. Cash activation remains off until source coverage, recovery, replay, close races and owner UI pass.


### Cash source and cutover integrity checkpoint

Full regression checkpoint: 429 tests passed, zero failures/skips (115.2 seconds), before the following incremental UI/source work. Syntax checked 134 authored JavaScript files at that checkpoint. CashEntry remains internal; verified cash activation is off and Task 7 is unfinished.

Durable cash-format accounts now reject legacy unclassified expense creation and require explicit modern daily writer negotiation plus a request key. Earlier valid daily receipts still replay before gates. Updated daily saves declare financial-only corrections; request keys retain the contract version across retries. GET day supplies the account's durable format marker without persisting transport metadata into Day. Backup validation reconciles cash-format metadata and marked manual checksums to retained operations/audits; linked expense deletion cannot erase a completed payment.

New bounded transactional cash-source reader and pure normalization preserve original sale receipts, actual paying-shop refunds, paired transfers and one canonical expense identity. Bank remains excluded from physical cash; unknown payments, unresolved refunds and unclassified accounting reversals prevent verified totals. Source reads enforce a combined 5,000-record/8-MiB ceiling, share one transaction, project authored fields, and include original sale links and linked expenses even across the cutover boundary.

Independent review found four Important issues, each reproduced RED then corrected GREEN: refund conflict timestamp hidden before cutover; conflicting duplicate IDs filtered by shop; missing daily operation keys making accepted cash-format saves unrecoverable; and manual-format downgrade hidden by deleting audit checksum fields. Focused source/entry suite: 19 passed, zero failures/skips; API/daily UI suite: 28 passed. A new full run is required after these changes.

Task 7 remaining: owner-counted opening/cutover, frozen close evidence and atomic posting advancement, source-version race guards, canonical payment routes/forms, normal three-value close UI, recovery of cash checkpoints, full journey/device checks. No physical-cash verified badge or guessed opening has been enabled.


### Counted-cash implementation and browser checkpoint

Fresh full checkpoint before the most recent UI changes: 455/455 tests passed, zero skipped, 116.4 seconds. Source catalog v3 now comprises 23 collections: legacy 19 plus Stocktake, CustomerReturn, CashEntry and CashCheckpoint. V3 remains unreleased pending final review and acceptance. Default activation remains false; VERIFIED_CASH_ENABLED requires fully-paid sales and customer-return support. No live flags or settings changed.

Implemented owner-confirmed counted opening and retained close, integer paisa expected/count/difference, variance reason, exact original replay, current configuration/recovery binding, and a new physical baseline after restore. Cash counts, financial DayVersion and posting advancement share one outer transaction; late audit failure rolls all of them back. Original Day/report rules remain unchanged. Cash checkpoint recovery validates its source facts, calculation, linked financial close, ordered chain, account cursor, audit and exact outcome; invented coherent flow evidence is rejected.

Ruling: serialize infrequent cash closes by touching every configured shop's existing AccountingState in sorted order. This avoids another persistent global authority and closes the pending-return phantom across unknown actual paying shops. Cost: an unrelated shop payment can make the owner's reviewed count stale and require refresh/recount. Tests cover receipt and cross-shop return races. Return/refund/manual-payment retries now choose their occurrence anew inside each transaction attempt; RED/GREEN regressions prevent a later successful retry from disappearing before a concurrent cutover. Explicit test clocks remain supported.

Undated existing legacy unknowns can be captured as exact historical evidence at an owner-counted baseline; changed/new unknowns still block verification. Boundary exclusions apply only at that exact instant and validate payment facts/duplicates first. Known old amounts are never reclassified as Cash or Bank.

Owner UI has Count cash / Record payment. Normal count view has Expected cash / Cash counted / Difference; owner explicitly confirms actual physical count or a just-completed payment. Income, expense, supplier-payment and completed-transfer aliases route to the canonical payment form when enabled. Derived financial rows remain read-only and are excluded from sheet saves/drafts, including draft restoration. Unknown outcomes keep exact keys and immutable commands per account/shop; late account replies cannot replace current evidence. Recovery review includes the new record counts.

Disposable real-browser acceptance: counted opening 100.00 -> Cash expense 10.01 -> expected 89.99 -> counted 89.99/zero difference -> saved close. At 390px the initial action row clipped Cancel; the scoped form layout was corrected and rechecked at 390 and 320px with all buttons inside the modal and no horizontal overflow. Tab moves count input to reason. Viewport reset and preview fixture stopped afterward. Browser zoom shortcuts did not establish 200-percent text, so that case is not claimed; physical Android/camera remain unverified. Earlier real-browser stocktake and sale/return checks remain recorded above.

Combined real-DB journey passed: cross-shop Cash sale, counted close, immediate original-owner return, separately confirmed actual-paying-shop Cash refund, Bank resale, old request retries and reviewed empty-account restore. One current phone state and frozen financial/cash close evidence remain intact. Independent review additionally found draft restoration dropping derived purchase/transfer rows; reproduced RED and fixed GREEN. Another new transfer-form missing label helper was reproduced and fixed using actual configured shop metadata.


### Final cash-review fix pass

All material review findings were reproduced before correction: persisted undefined fields no longer break acknowledged undated-source recovery; referenced legacy expense evidence cannot be deleted; unresolved commands survive reload in an account/shop local journal; storage failure prevents submission; a later temporary rejection cannot discard an earlier unknown request; administrative reversal retries now timestamp the successful transaction attempt. Derived supplier/transfer rows also survive manual draft restoration. Focused regressions passed for every correction. Integer-paisa display and frozen count confirmation were added without changing financial rules.

A full checkpoint passed 478 tests, zero failures/skips, 121.8 seconds, while the final confirmation-display check was being added; a final stationary-source run will follow the completed package. Syntax 142 authored JavaScript files passed before the final UI refinements. No deployment, production data, live environment setting, commit or push changed. COUNTED-CASH.md records compatibility, authority, rollback, source bounds and device gates.


### Stable counted-cash/dialog verification

Full stationary-source suite: 484/484 passed, zero failures/skips, 120.7 seconds. Shared dialog work also has four focused RED/GREEN cases for accessible naming, focus restoration, forward/backward containment including heading focus, inert background restoration and replacement cancellation. The stand-alone unit run initially hit sandbox loopback denial for HTTP fixtures; the authorized rerun passed 287/287. No application failure was hidden by changing expectations. Legacy destructive-positive behavior remains held as documented in DIALOG-SAFETY.md; no destructive action was globally enabled.

The cash feature implementation package is locally verified and still default off. Remaining acceptance/release gates: physical Android/camera, actual 200-percent text enlargement, deployed writer/support matrix and legacy destructive caller safeguards. Original scale/scanner/native backlog work continues independently; this checkpoint is not a declaration that the entire 23-task improvement effort is complete.

Verified source checkpoint after the 484-test package: C:/Users/AAYAN/.codex/visualizations/2026/11/08/01a1bb2b-7498-73f1-9672-9e82dc49166d/stockly-source-checkpoints/counted-cash-1794290852732. Authored source/tests/docs only; secrets, dependency/vendor binaries and native build artifacts are excluded. SHA-256 copies verified. Historical test logs are archived beside this checkpoint to keep the checkout clean.


## Original T17 continuation: lazy scanner and lifecycle

After the 484-test cash/dialog source checkpoint, extracted the existing scanner block from imei.js into scanner.js with its global ABI retained. Removed eager ZXing loading. Reproduced and fixed late permission reopening, stale decode actions, old focus timers, visibility/navigation/session leaks, optional capability shutdown and decoder retry races. Independent review's synchronous insertion failure was also reproduced and corrected. Eighteen focused cases pass. Full stable suite: 502/502, zero failures/skips, 122.4 seconds. Browser verified current entry without an eager decoder and actual bundled decoder recovery after an injected first-load 503. Initial declared JS response bodies fell 582,996 -> 294,703 bytes at the same 16 requests. See SCANNER-LIFECYCLE.md for exact measurement scope; physical camera/APK acceptance remains unverified.

T14 movement-history paging is next; existing Shipment/Dispatch array endpoints remain for compatible installed clients. No production flags, data, migrations, commit or deployment changed.


## Original T14 continuation: movement history

Added owner-only v2 combined movement pages/export without altering legacy Shipment/Dispatch arrays. Stable date/id/source ordering preserves equal IDs across sources. Metadata/detail snapshot reads, normalized account/filter cursors, combined record/byte bounds and exact complete export are tested. UI now performs one server-filtered request, keeps a bounded card page, expands nested items on demand and prints/downloads all acknowledged matches. Removed old full-history arrays/loader and cloned-page print behavior. Read-only movement facts no longer assert unsupported sold-from-old-dispatch attribution.

Twelve focused integration/UI cases passed. Independent review found the actual bootstrap omitted ALL/HQ destinations; reproduced in VM and real browser, fixed both markup and option initialization, then verified warehouse-only and combined choices. Next/previous, expansion and 390/320px reflow passed in the disposable large fixture. No native print job was sent. Two test preview servers and their disposable database were stopped, and agent-created preview tabs were closed.

Ruling: retain live anchored traversal and page-level totals; complete output uses a separate bounded snapshot. Cost: later deletion/backdated intake can change later pages/counts; a list cursor is not a frozen recovery snapshot. Ruling: render retained movement evidence without the legacy inferred current-sale badge. Cost: this screen no longer offers an unproven per-dispatch sell-through metric; legacy API fields remain compatible.

Measured fixed workload and reproducible script are documented in MOVEMENT-PAGING.md. p95 ~333.7 -> 55.0 ms, raw response 4,525,582 -> 114,443 bytes; initial descendant elements 60,001 -> 450 at page 50. Same selected destination/month and synthetic account; no production/device speed claim. No new cache/virtualization/index DDL was needed to meet the fixture budget. Full stable verification is running.


## Original T16 continuation: scoped refresh and summary ownership

Removed duplicate startup stats request by explicit in-flight sharing; post-mutation refresh remains fresh. Sidebar reads capture token/account/shop and generation, abort superseded requests, skip hidden-tab polling and back off repeated failures (24 seconds initially, maximum 5 minutes). No result TTL or cross-account cache was introduced. HQ reads capture token/account independently of warehouse form state, discard late results, and clear another owner's cache before requesting. Dispatch launched from Movements always refreshes HQ and cannot open after a failed read, account/form change, navigation away or away-and-back.

Analytics and expense reads now guard owner/token/filter/generation; print refuses mismatched cached results. Current failures show explicit Retry; old errors cannot replace a newer result. Session expiry closes business dialogs and restores sign-in interactivity. Old good HQ data remains available after a same-owner transient failure; explicit owner fixture markers now test that distinction. No legacy destructive confirmation path was enabled.

Seventeen new regressions (16 refresh/summary/dispatch plus one expiry focus case) were reproduced red then fixed. Independent review found two additional issues (late dispatch after navigation and indefinite Loading on failure); both reproduced and fixed, including away-and-back navigation coverage. Stable full suite: 531/531, zero failures/skips, 126.9 seconds (.read-refresh-stable-all.log). Syntax check follows this package. Original native/device, intake, release and destructive-action gates remain open; this is not whole-project completion.


## Original T21 continuation: print readiness and cleanup

Removed fixed print/readiness/frame-removal timers in the shared helper. One active job waits for the actual written document, fonts and decoded images, rechecks account/session, and cleans on afterprint/pagehide or handled failure. Session expiry cancels pending readiness without leaving private frames; repeated clicks cannot create competing jobs. Nine new tests pass. Independent review raised a readiness check; a real delayed-image fixture reproduced complete-document/incomplete-image printing, then verified decoded images and synthetic-afterprint cleanup after the fix. Repeated instrumented browser invocation had no warnings/errors. Native print opened a separate synthetic 200-row document but blocked DOM automation, so its temporary tab was closed without sending a physical job. Actual native dialog cancellation, PDF pagination and Android remain explicit acceptance gates; see PRINTING.md.

Full settled suite: 540/540, zero failures/skips, 126.5 seconds (.print-final-all.log). Syntax: 151 authored JavaScript files. Temporary loopback print servers and agent-created print tabs were stopped/closed. No runtime dependencies added, live flags changed or production data accessed.


## Original T21 continuation: shared CSV quoting

Removed the duplicate stock/sales CSV quote functions and reused the existing formula-neutralizing quoteCSVCell already used by product export. New stock/sales tests reproduce formula-like brand/customer/notes, Unicode, embedded quotes/newlines, zero amounts, leading-zero IMEI strings and negative numeric reversal amounts. Thirty-two focused export/paging/catalog/reversal cases pass; stable full suite: 542/542, zero failures/skips, 123.7 seconds (.csv-final-all.log).

CSV bytes retain identifier text but spreadsheet automatic type inference is outside ordinary CSV quoting. Import IMEI columns as Text, or use JSON/source evidence for exact machine identifiers; no universal Excel auto-open precision guarantee is claimed. The literal apostrophe for formula-like strings is intentional. No spreadsheet library or extra runtime dependency was introduced. Broader export scope metadata/identifier-preserving desktop format remains part of T21 follow-up.


## Original T23 continuation: bounded shutdown and accepted application work

Added explicit SIGTERM/SIGINT and server.shutdown() lifecycle: mark readiness unavailable, stop retry scheduling/listening, drain accepted work, await pending startup connection, then disconnect DB. Repeated signals share the drain. Total deadline is 10 seconds; CLI exits nonzero on failed shutdown. Real HTTP reproduced an idle keep-alive delaying close; finish-triggered idle cleanup corrected it.

Independent review found socket close alone did not drain accepted handlers or post-response recovery lease release. Reproduced both RED, then added per-app promise tracking around tenant middleware and each route handler outside recovery finally. Closed-response delayed continuations cannot start fresh business work. The actual recovery wrapper's retained lease release is gated in an HTTP regression. Router tracking is idempotent and preserves recovery markers across app factories. A real hung HTTP response is forcibly closed on deadline. Startup retry cancellation, pending connect and hung disconnect are separately tested. Follow-up review found no further material defect.

Stable full suite: 558/558, zero failures/skips, 130.7 seconds (.shutdown-work-final-all.log). Syntax: 157 authored JavaScript files. Earlier .shutdown-final-all.log was green at 551 before the accepted-work review gap was found; it is not the final evidence. See release-runbook.md for deployed supervisor/DB-outage/hard-kill limits. No real OS/service-manager signal delivery is certified by emitted Node signal events on Windows.

Added CURRENT-ARCHITECTURE.md as a current-source overlay and linked it from the historical repo map. Recorded actual absent Android toolchain/dependencies in android-build-and-acceptance.md; no native build/device or global software installation is claimed. Native/source-policy fixes await a runnable native baseline. The master 23-task plan remains active, including bulk intake, remaining unsafe legacy destructive workflows, query/index and native/release acceptance.


Verified local source checkpoint (558-test stage): C:/Users/AAYAN/.codex/visualizations/2026/11/08/01a1bb2b-7498-73f1-9672-9e82dc49166d/stockly-source-checkpoints/read-print-shutdown-1794297323886. Authored allowlisted source/tests/docs only; SHA-256 copies verified. Agent-created phase test logs are archived in its test-logs folder with their own checksum manifest; historical red logs are retained as red evidence. This is not a business backup or full native/dependency archive.


## Bulk intake and direct implementation continuation

Replaced the serial per-phone browser save loop with bounded25-item packets and a durable immutable job containing every queued item/key before POST. Independent per-tab job IDs, reload/closed-tab recovery, definite-failure correction and unresolved-request retention are implemented. The real-API dropped-response/reload case and focused33 cases passed before the user stopped test work. The final broad run was590/591, with one preflight subprocess lacking an exit status; no more tests were started after the stop instruction. See BULK-INTAKE.md for the isolated benchmark and exact proof/journal contract.

Then implemented the common confirmation resolver fix and guarded action callers, an atomic existing-account status endpoint, removal of permanent account deletion from the UI, and stats aggregation/projection instead of loading complete phone documents/customer metadata. Updated existing fixture expectations but did not execute them. No production access, feature activation, migration, commit, push or deployment.


Current authored-source checkpoint: C:/Users/AAYAN/.codex/visualizations/2026/11/08/01a1bb2b-7498-73f1-9672-9e82dc49166d/stockly-source-checkpoints/implementation-no-tests-1794310997992. Latest confirmation/status/statistics changes intentionally untested per user instruction. Agent-generated intake logs archived alongside it.
