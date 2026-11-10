# Bounded movement history

GET /api/v2/movements and its /export variant are owner-only additive contracts. Original GET /shipments and /dispatches still return their installed-client arrays; no movement collection or mutation/recovery identity changed. The new client uses one filtered page and retains its previous good page after failures. Print and JSON fetch a complete bounded snapshot instead of treating the loaded page as all history.

Filters: month YYYY-MM; shop ALL for both sources, HQ for warehouse receipts, or a configured destination shop for dispatches. Actual shop bootstrap preserves ALL/HQ alongside configured shops. Limits default 50, maximum 100; export permits neither limit nor cursor and caps the combined matches at 5,000 records / 8 MiB. Unknown/repeated filters, wrong-shop cursor reuse and staff reads fail explicitly.

Ordering is retained business date descending, ObjectId descending, then source rank (dispatch before inbound on an otherwise identical key). Cursors bind account/role/configuration and normalized filters using the existing event cursor codec. Source rank keeps equal IDs in Shipment and Dispatch distinct. Traversal is live with an upper anchor: newer records above the anchor stay out; deletions and backdated arrivals can change later pages/counts. Each page and complete export is internally snapshot-consistent, not a frozen whole-query multi-page traversal.

The server counts and reads narrow metadata separately for the two sources, then fetches only selected record IDs inside the same transaction. Metadata is projected before sorting. BSON and final response sizes are bounded before complete nested data is returned; limits do not become partial successful exports. No per-record current-phone join is performed. The new view presents retained movement facts and does not claim that a current sale belongs to an old dispatch merely because an IMEI matches.

The page renders at most 50 movement cards and expands nested item details on demand. Costs preserve authoritative zero and do not replace malformed primary costs with a legacy fallback. Malformed historical items remain explicit review issues. Print renders all items from the complete acknowledged export; JSON remains a record export, not a recovery backup. Superseded dual full-history fetches/arrays and cloned-page printing were removed.

## Local measured workload

Run npm run bench:movements. It creates a new disposable loopback replica set and synthetic account, seeds 1,000 receipts plus 1,000 dispatches with 20,000 total nested items, and destroys it after the run. It does not load .env or accept a production database URI. Optional --preview and --baseline-public=PATH keep explicitly requested local acceptance previews open; stop them with Ctrl+C. No new dependency is required.

Observed on Windows, Node v24, the fixed destination-A November 2026 fixture, two warmups per mode and 12 measured trials per mode, alternating order with explicit GC before each sample:

| Measure | Legacy two-array reads/client filter | New page 50 |
|---|---:|---:|
| p50 including HTTP response parsing |285.1ms|46.8ms|
| p95 including HTTP response parsing |333.7ms|55.0ms|
| Combined response body bytes |4,525,582|114,443|
| Records retained for selected destination |1,000|50|
| Observed Mongoose operations |7|7|
| Median process heap increase observed at response finish |43,227,720 bytes|3,174,032 bytes|

The process heap observation combines the synthetic HTTP client and server in one Node process. It is not a peak measurement or browser heap metric. Mongoose-operation counts are not wire-command counts/getMore counts. These are 12 local warm trials against a small fixed in-memory dataset; they do not certify production/phone latency or large-account index behavior. Adopted fixture targets: page 50, p95 below 250 ms, response below 256 KiB and initial visible history below 1,000 descendant elements. This implementation meets those fixture targets; no global cache, virtualization or production index migration was added to obtain the result.

Actual desktop browser comparison on the same synthetic account: legacy destination-A view rendered 1,000 cards/60,001 descendant elements; the current page rendered 50 cards/450 descendants before expansion, and 500 descendants after expanding one 10-item record. Next/previous worked. Both All movements and Warehouse receipts were reachable after fixing the independently reviewed select-initialization gap. Current reflow was observed at 390 and 320 CSS pixels; 320px document/page scroll widths remained 320. No native print dialog or physical-device behavior is claimed.

## Verification and remaining gates

Six MongoDB integration cases cover source-ID ties, filters/roles/cursor isolation, legacy response compatibility, retained nested export, combined byte/count limits and anchored live changes. Six UI cases cover one bounded request, late-account replies, on-demand details, faithful zero/unknown costs, complete printing and actual shop option initialization. Independent review found the unreachable ALL/HQ choices; unit and real-browser regressions now pass. Full-suite results are in FEATURE-EXECUTION.md.

Index/explain work for actual deployment datasets remains original T15, with an isolated rehearsal before any authorized production DDL. Larger accounts still need measured query plans; exact counts without deployed supporting indexes can scan matching history. Current bounded rendering does not justify adding virtualization. Original physical Android, camera, native exports and global legacy destructive-action gates remain separate.
