# Saved history, report and activity pages

Administrator-only `/api/v2/days`, `/api/v2/reports` and `/api/v2/logs` now serve bounded `{items,total,nextCursor,hasMore}` lists. The web screens reuse the shared pager and document reader: 50 records by default, 100 maximum, projected lean reads and scoped anchored ObjectId cursors. Next/Previous replace the visible page. The legacy endpoints retain their array shapes, existing ordering and existing caps; the activity screen no longer appends an ever-growing loaded list.

## Filters and order

- History supports configured owner shop, month and open/closed status. Missing legacy status/revision is presented as open/revision zero. An open status filter includes missing legacy status.
- Reports support configured shop, month and daily/monthly type. An explicit `shop=ALL` selects stored ALL-shop reports; omitting shop includes every stored report. Screen filters are independent of report-generation inputs.
- Activity supports shop, exact action and inclusive Karachi from/to dates over the recorded timestamp. Omitting shop includes account-wide events. Dates do not rewrite the recorded audit timestamp.

All filters are scalar and validated before paging. Cursors bind resource, tenant, permissions/configured shops and filters. New lists order by immutable ID descending, reflecting record creation order rather than promising exact business-date, audit timestamp, report period or last-regeneration order. Legacy date/period ordering remains available on the legacy endpoints. Date/month filters make the intended period explicit.

Per-response reads share a snapshot. Traversal across responses is anchored and live: normal newer IDs wait for refresh, deletes disappear, edits/imports can affect membership and Previous is live. Pages are not a coherent full-account backup.

## Honest daily history

The history page is now a saved-day index, not a second financial calculator. It projects date/shop/status/revision and retained closed financial metadata. It omits potentially large draft categories and closed ledger detail.

Closed entries display their retained snapshot revenue, expenses, net profit and net units. Known rule/revision and monetary precision are checked; invalid retained figures require reconciliation. Open draft entries do not recompute purported current totals from saved stock rows. **Open full day** uses the selected current page's saved ID, validates shop/date and opens the existing authoritative daily workflow. Historical quantities or current physical stock are not invented by this index.

History printing exports all matching saved days. Closed figures stay frozen; open figures are marked unavailable with an Open full day prompt. It does not add open drafts into a financial grand total. Use daily/monthly financial summaries for reconciled business totals.

## Complete records and retained reports

Each resource has `/export` with the same filters and no cursor/limit. It returns `{items,total,complete:true}` only when the full snapshot fits 5,000 records and 8 MiB; otherwise 413. Report exports retain prior report history/data, audit exports retain details, and history exports contain full saved Day records. Page projections can omit heavy fields without dropping them from complete exports.

The shared size guard now projects permitted output fields before calculating BSON bytes in MongoDB. This keeps small metadata pages available when omitted fields are large. The guard still runs before document fetching into Node; final JSON size is bounded too. Full exports are measured against their full permitted record projection. A regression covers five large saved sheets that fit as a metadata index but exceed the full export limit.

History/log printing requests complete exports independently of the loaded page. JSON all matches downloads `stockly-record-export` files with resource/filter/time metadata. These are record exports, **not complete recovery backups**; the reviewed business backup/restore workflow is unchanged. Late context changes suppress output. Individual report print/CSV/expand/delete use only the owning loaded page. Deletion review is invalidated by account/filter/page changes, and server-side frozen-report/history retention remains authoritative.

## Verification boundaries

Unit/VM and disposable-database tests cover pages, filters, admin access, resource/scope cursors, legacy arrays, complete output, retained report/audit data, closed history precision, stale caches, rejected requests and projected-size behavior. The date-rollover regression fixture now follows the actual current posting business date rather than expecting yesterday after the shop's cursor has advanced; production posting rules were unchanged.

Physical browser/native/accessibility acceptance, measured production query plans/indexes, large streaming exports, shipment paging and broader fetch/polling optimization remain open. No record repair, index migration, deployment or installed-client cutoff is automatic.
