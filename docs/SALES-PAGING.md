# Bounded sales event history

The web sales log requests `GET /api/v2/sales` instead of downloading the complete legacy ledger. The additive response is `{items,total,nextCursor,hasMore,pageTotals}`. Default limit is 50 events, maximum 100. Original sales and retained reversals are separate events and may appear on different pages. Existing `/api/sales` array responses and canonical financial/report/backup readers remain unchanged.

## Filters and amounts

Supported scalar filters are `shop`, `from`, `to`, `kind` and `q`. Shop means **selling attribution**, with the existing legacy owner fallback. Shop sessions are restricted to their authenticated selling shop; they cannot request another shop. Admin ALL includes the tenant's ledger. Kind is all, sale or reversal. Date bounds are inclusive Karachi posting business dates, including explicit later open-period posting dates; legacy records fall back to the recorded instant in Karachi. Search uses up to 80 characters/eight literal terms across phone, IMEI and buyer fields. Invalid dates, ranges, filters, limits and cursors fail explicitly.

MongoDB projects permitted source fields and expands event positions for filtering and traversal. Selected rows are converted and validated by the existing `saleEvents` function; monetary rules are not independently reimplemented in an aggregation. Page events therefore carry the same original/correction IDs, exact signed major/minor amounts and physical occurrence versus effective posting dates as the canonical ledger. Invalid selected history requires reconciliation, with no silent rounding.

The screen labels matching event count separately from loaded-page count. Revenue, phone profit, net phone units and date-group counts are **page totals**. Phone profit excludes manual income and business expenses; use the financial summary views for business net profit. Server `pageTotals` applies only to the returned events, not the full query.

## Cursor and live traversal

Order is business date descending, then source sale ObjectId descending, then event kind with reversal before original on ties. Within a business date this is source-identity order, not a promise of exact occurrence-time order. The cursor stores this full position and first-page upper anchor. Cursor scope includes tenant, permission/configured shops and all filters; stock cursors and event cursors have separate versions and validation. Scope fingerprints are not authentication signatures. Authorization is rebuilt on every request.

Count, size and event data within one response share a snapshot. Across responses traversal is **live**: deletes disappear, updates and older-ID imports may affect membership, and new events above the anchor wait for refresh. A later reversal can change an original event's reversal metadata even while the new correction itself lies above the cursor anchor. Previous is also live. Combining pages does not produce a recoverable or accounting-consistent snapshot.

## Complete output and safe actions

`GET /api/v2/sales/export` uses the same filters, without cursor/limit, and returns `{items,total,complete:true,totals}` only for a complete snapshot fitting **5,000 events and 8 MiB**. Original plus reversal counts as two events. Database-side BSON size checks precede result materialization in Node; final JSON is bounded too. Oversize returns 413 without a capped success result. Larger streaming exports remain a managed-procedure follow-up.

CSV and print request this endpoint independently of the loaded page. CSV quotes fields and retains zero/signed values; print includes shop, date, kind, search, correction labels and all-matching scope. Changed account/filter context discards late export responses. No output falls back to a partial page after failure.

The former Reverse All button now says **Reverse sales on this page**. It captures only loaded active original IDs. Corrections and already reversed originals are excluded. Single reversal additionally verifies active-original membership and loaded-page scope. Confirmation is invalidated by an account/filter or loaded-page change. Server reversal identity/transaction protections remain authoritative.

## Limits of this slice

Network/DOM rows are bounded, and aggregation execution has a 10-second budget with no automatic disk spill. Computed event-date sorting/counting still scans relevant source history; production query plans, indexes, p50/p95 and large-data throughput remain T15 work. No automatic index, data migration or installed-client cutoff is introduced.

Unit/VM and disposable-database tests compare paged events with the canonical ledger, cover legacy dates, later posting periods, kinds/search/attribution, cursor scope, ties, live deletes/reversals, projected fields, limits and complete exports. A 600-sale/1,200-event fixture asserts the default page JSON is less than one eighth of the legacy full-ledger response. This is fixture payload evidence, not a production latency claim. Real browser/native/accessibility verification, other list migrations and broader rendering/polling work remain outstanding.
