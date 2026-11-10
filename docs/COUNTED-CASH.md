# Counted cash and recorded payments

Implementation is additive and disabled by default. No live activation, migration, deployment or external payment has been performed.

## Activation and compatibility

VERIFIED_CASH_ENABLED requires FULLY_PAID_SALES_ENABLED and CUSTOMER_RETURNS_ENABLED. The server advertises verifiedCashClose only to owners when all three contracts are enabled. Missing capabilities or older servers leave the new controls hidden. Activation requires compatible writers across every server instance; rolling back to a binary that ignores durable records is unsafe. Disable new actions while retaining current readers and evidence instead.

Cash/Bank sales negotiate X-Stockly-Sale-Version:2. Cash-format sheet writers negotiate X-Stockly-Manual-Version:2 and need an idempotency key. Financial-only save/reset explicitly sets cashFinancialOnly:true; it never asserts a real payment. Earlier valid operation receipts replay before new-writer checks. After a shop acquires cashFormatVersion 1, unsupported daily writers and legacy expense creation reject before mutation even when features are disabled again. Retained payment-linked or counted-cutover expense evidence cannot be deleted.

Current authored browser/API contracts have unit and real MongoDB coverage. Disposable desktop browser owner flow and 390/320px cash-form reflow were observed. Prior stocktake and paid-sale/return browser journeys are in FEATURE-EXECUTION.md. Physical Android/camera and 200-percent text acceptance remain unverified. No minimum APK or browser support window has been invented; keep production activation off until the actual supported clients and deployment topology are checked.

## Sources and meaning

One original Sale ID is one fully-paid receipt, credited to its signed-in selling shop. Stock costs, HQ intake/dispatch, accessory quantity changes, StockOperation retries and accounting reversals are not independent physical payments. Original Cash receipts remain cash even after an accounting reversal.

A CustomerReturn restores sellable stock to the original owning shop immediately. Its separate full refund records actual Cash/Bank method, actual paying shop and occurrence. It does not execute a payout. An unrecorded post-cutover refund blocks verification conservatively across shops until its paying shop is known. An administrative correction without refund classification remains explicitly incomplete.

CashEntry is the single retained identity for a completed other-income receipt, expense, supplier payment or shop transfer. Cash transfers debit the sender and credit the recipient; receiving a transfer is not financial revenue. Bank movements do not change physical till cash. Income cost is a financial cost, not proof of a supplier payment. Confirmed expenses share an exact ShopExpense identity for existing financial outputs; this duplicate representation never counts as a second payout.

Daily sheets project canonical income/purchase/transfer rows read-only and exclude them from saves and drafts. Restoring a manual draft retains those derived rows. Existing financial DayVersion rule 1 and report rule 2 keep their original meanings; their sheet balance is labelled unverified. The distinct cash rule 1 uses integer paisa and does not reinterpret old snapshots. New cash-value formatting keeps exact final paisa even at the supported integer limit.

## Count, review and close

An owner physically counts an opening balance and records a reason/confirmation. No opening float, cutover instant or old payment method is invented. Known precutover history remains historical. Undated existing unknowns can be captured by exact identity/facts at this counted baseline; new or changed unknowns remain incomplete.

Expected cash = counted opening + recorded Cash inflows - recorded Cash outflows. Difference = actual count - expected cash. Unknown current facts produce incomplete records and a null expected value, not zero. A variance requires an owner reason. Same-millisecond exclusions validate source facts and apply only at that exact boundary, so later refunds cannot disappear under an old identity.

CashCheckpoint retains the counted baseline, scoped source flows, calculation, actual count, reason, configuration, predecessor/revision, operation outcome and linked financial close. Cash count, DayVersion, audit and posting advance commit atomically. Reopening a financial sheet retains its previous versions and never rewinds cash evidence or posting dates. The current financial policy disallows closing a future posting day.

Reviews bind all shop period versions, source facts, current day revision and account/recovery configuration. Infrequent close transactions lock all configured periods in sorted order because a new return may later be refunded by any shop. A conflicting payment/return causes serialization or an explicitly stale review requiring refresh/recount. Actual payment/refund/administrative-reversal occurrence is selected inside each transaction attempt, preventing a successful later retry from falling before a committed cash boundary.

A restored or reconfigured account needs a new physical baseline. Retained operations can still return their exact original outcomes without repeating stock, money or closing effects.

## Unknown outcomes and recovery

Before a POST, the browser saves an unresolved command/key in an account/shop-scoped local journal, verifies storage, and binds in-memory completion to the current authenticated context. The journal contains command evidence, not credentials. Reload/restart offers an explicit retry of the identical request. Storage failure stops submission. A temporary 403/409/503 after an earlier unknown outcome cannot discard that original request. Successful acknowledgment clears its journal; unreadable saved evidence blocks a new command rather than silently overwriting it.

V3 recovery covers all 23 business collections: legacy 19 plus Stocktake, CustomerReturn, CashEntry and CashCheckpoint. Old v1/v2 paths refuse newer evidence. Export/review/apply/readback preserve complete source links, methods, paying shops, physical/financial dates, source calculations, ordered count chains, essential audits and original replay results. Checkpoint source reconciliation rejects invented flows; acknowledged legacy evidence remains retained. Recovery is empty-account-only and bounded to 5,000 business documents / 8 MiB. Checksums detect changes but do not authenticate a maliciously rewritten file.

## Verification evidence

Focused tests cover exact Cash/Bank treatment, variance/zero inputs, stale reviews, incomplete refunds, source conflicts, cutover boundaries, source bounds, legacy writer exclusion, audit rollback, retry timestamps, receipt/return races, per-shop unknown retries, restart journal recovery, read-only derived rows and tampered backup rejection. The combined integration journey covers cross-shop sale -> counted close -> immediate return -> actual paying-shop refund -> Bank resale -> old retries -> empty-account restore while preserving one current phone state and frozen figures. See FEATURE-EXECUTION.md for actual full-suite checkpoints and remaining device/release gates.
