# Daily sheets and retained closing

Daily sheets use Karachi business dates and exact PKR to two decimal places. Only administrators can save, close, reopen or reset a sheet. Every mutation requires the loaded `expectedRevision`, including revision zero for a new sheet. A stale request returns 409. An optional `Idempotency-Key` binds retries to the original command and audited acknowledgment; changing its payload conflicts.

Saving accepts manual EXTRA entries, expenses, purchases, transfers and carry-forward. Phone revenue and original sold cost come from retained sale events, including signed reversals; client financial rows cannot replace them. Mixed purchase costs are summed per sale. Purchase and transfer cash movements are distinct from profit expenses. Standalone shop expenses are included once at close.

`POST /api/days/:shop/:date/close` freezes a versioned snapshot of financial totals, manual entries, ledger events and shop expenses. The day, immutable DayVersion, essential audit, retry receipt and posting-period advancement commit together. A concurrent sale either belongs to that close or posts to the next open period. Future dates cannot be closed. Current-date inventory can be captured as **at-close** inventory; unavailable historical opening and movement quantities remain unavailable, never invented as zero.

`POST /api/days/:shop/:date/reopen` requires the captured revision and a reason of at least three characters. It preserves the previous DayVersion. Reopening never rewinds the shop posting cursor: later sales and reversals continue in the current open period. A new close creates a new version. Day history metadata and report history are bounded to 30 entries; reaching the limit requires review rather than silent truncation. The retained DayVersion documents are not deleted by this limit.

`DELETE /api/days/:shop/:date` is a compatibility command for a revision-guarded **manual reset** of an open sheet. It retains the day identity, ledger-derived rows and audits. The old history-delete control was removed. Closed or previously frozen reports cannot be deleted; regeneration after reopening archives the earlier closed report. Single-shop daily reports generated from a closed sheet use its retained snapshot.

## Drafts and recovery

The browser keeps manual drafts in tab-scoped session storage, separated by account, role, authenticated shop and sheet. Drafts expire after 24 hours, with at most 20 retained entries and a bounded serialized size. Storage failures show a notice and keep an in-memory copy. Explicit logout clears this draft storage. A draft restores only against the same open revision; conflicting or closed-sheet drafts remain downloadable for manual review. Draft JSON is not a business recovery file.

Complete version-2 recovery now includes 19 business collections, adding AccountingState, DayVersion and DayOperation. Validation recomputes snapshot totals, checks retained sale event identities/amounts, rejects duplicate events and preserves posting state beyond prior closes, including reopened days. Missing new collections are reported as incomplete coverage; older exports are not silently expanded. Reviewed apply remains restricted to an empty account.

## Remaining acceptance

This implements part of T12, with targeted T06/T13 integration. It does not certify ALL-shop/monthly/CEO reconciliation, historical physical movement reconstruction, legacy data reconciliation, production throughput, real browser/native accessibility or process-restart recovery. Those remain separate plan gates. No production migration is performed.
