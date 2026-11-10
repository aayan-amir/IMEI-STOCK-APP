# Bounded stock lists and complete exports

This is the stock portion of T14. The web inventory screen now requests one page of 50 phones and replaces that page on Previous/Next. It does not accumulate the whole inventory in the DOM. Group counts and selection refer to the loaded page; the matching-record count refers to the server query window. Batch actions use explicit loaded IDs, with no hidden query-wide selection.

## Additive API

`GET /api/v2/stock` returns `{items,total,nextCursor,hasMore}`. `limit` defaults to 50 and is restricted to 1–100. Each item has its original `_id` plus string `id`. The route uses an explicit projection and lean reads. The existing `/api/stock` array response is unchanged for installed clients and existing complete-data consumers. No Android support cutoff or automatic upgrade is assumed.

Filters are applied before paging:

- `shop`: configured owner shop, or ALL. A shop session defaults to its authenticated owner shop and cannot request a different owner shop.
- `soldByShop`: configured selling shop. Shop staff may query their own selling attribution across owner shops; they cannot query another selling shop. If an explicit owner shop is also supplied, both filters apply.
- `status`: in_stock (default), sold, or all.
- `q`: up to 80 characters/eight whitespace-separated terms, normalized and matched literally without interpreting user regex. Every term must match a brand, model, primary/secondary IMEI, color or storage field.
- `from`/`to`: inclusive Karachi business dates filtering the stored `addedAt` intake instant, not sale posting dates. The current stock screen exposes shop/status/search; date filters are API capabilities.

Invalid scalar/unknown filters, invalid dates, reversed ranges and malformed cursors fail rather than silently broadening the query. Cursor scope includes tenant, role, authenticated shop, configured shops and normalized filters. The cursor fingerprint is a scope check, not an authentication signature; authorization and filters are rebuilt independently for every request. Editing cursor contents cannot grant broader access.

## Traversal and limits

Sort is immutable ObjectId descending, with the first page's highest ID retained as the upper anchor. Later pages request IDs below the previous last row. Timestamp ties therefore do not duplicate or drop records. Normal newer ObjectId inserts are excluded until refresh; deletions are skipped. Reads within one response share a snapshot, including count and size checks.

Traversal across responses is **live**, not a retained database snapshot. Updates to status/shop/search fields, restores or manually inserted older IDs may change membership between pages. Previous traversal is also live, and returning to the first page can include new arrivals. Matching counts are current within the cursor's anchor window. Use the complete snapshot export for a coherent file rather than combining pages into a recovery or accounting dataset.

Count, size and row queries have a 10-second server execution budget. Database-side BSON size aggregation rejects oversized selected windows before loading documents into Node. Final serialized responses are also limited to 8 MiB. The shared reader now measures the permitted output projection in MongoDB before fetching documents. Unselected large fields do not block a small page; final serialized bytes are still capped.

## Complete CSV and print

`GET /api/v2/stock/export` accepts the same filters, without cursor/limit. It reads the matching set under one snapshot transaction and returns `{items,total,complete:true}` only if the full set fits **5,000 records and 8 MiB**. Exceeding either bound returns 413, with no partial-success file. Larger exports require a managed procedure; a streaming export job is not implemented.

CSV and print request this endpoint independently of the displayed page. They retain the captured account/shop/status/search context and discard responses after that context changes. CSV quotes fields and preserves zero amounts; print includes status/search and explicitly says all matching records. Export results do not replace the visible page cache. Backup and financial summaries retain their separate complete-data contracts.

## Verification and remaining work

Disposable-database checks cover tie traversal, server filters, cursor tenant/role/filter scope, inserts/deletes between pages, unchanged legacy arrays, projections and complete/oversized exports. A 600-phone fixture checks that the 50-phone page JSON is less than one eighth of the legacy complete-array JSON. This proves bounded payload reduction for that fixture, not production latency or database throughput.

VM tests cover paging, current-page selection, failures preserving last-good data, stale shop/account responses, grouping after a scope change, complete exports and printed search metadata. Search requests are debounced by 250 ms. Native buttons and a live status message expose paging and selection scope; this is not physical browser/screen-reader acceptance.

Sales/history/shipments/contacts/products/reports/logs pagination, broader rendering/polling work, streaming large exports and measured production query/index optimization remain later plan work. No production indexes, stored records, rollout policy or installed native clients were changed.
