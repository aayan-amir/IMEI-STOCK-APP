# Reconciled financial summaries

`GET /api/financial-summary?type=daily|monthly&period=YYYY-MM-DD|YYYY-MM&shop=A|ALL` is an administrator-only, read-only summary. It uses a snapshot transaction and the same financial service as generated reports and the CEO dashboard. Reads require transaction-capable MongoDB, as do existing inventory mutations. The monthly screen and its print action consume this API instead of reconstructing money from saved stock rows.

## Calculation contract, version 2

- Phone income and original sold cost come from retained sale events, credited to the selling shop. Ownership remains separate. Reversals are signed events in their recorded posting period.
- Manual EXTRA income and cost are included in revenue, cost and gross profit. Manual entries do not create phone units. Report screens, printouts and CSV include these entries separately from phone sales.
- Daily manual expenses and separate ShopExpense records are distinct sources. Each source is included once. A closed day's frozen shop expenses replace live records for that date; they are not added to them. Matching text or amounts does not establish that two independent records describe the same expense. Existing economic duplicates require reconciliation with the business owner.
- Net profit is revenue minus sold/manual cost and expenses. Purchases and transfers affect cash movement, not profit. Cash movement is revenue minus expenses, purchase cash and transfer cash. Daily cash on hand includes the recorded opening carry.
- Monthly cash movement sums daily movements. Monthly `cashOnHand` and `carryForward` are null: repeated daily opening balances are not additive and are not presented as a monthly closing balance.
- Current inventory is labelled current even when viewing a past month. Historical physical reconstruction is not inferred from current stock.

Closed days use their retained rule-version-1 snapshot, with arithmetic validation, inside version-2 aggregate summaries. Open days use authoritative sale events plus their current manual entries and separate shop expenses. Unsaved local drafts affect the daily editing preview; save them to include them in server summaries. Sales do not require a saved daily sheet to appear in monthly totals.

The response provides `financial`, per-shop `shopStats`, source dates/revisions/status, ledger events, explicit expense sources and manual entries. Duplicate daily records, unsupported frozen rule versions, unknown attribution, inconsistent expense dates/months and invalid stored amounts fail for reconciliation. Invalid request periods/shops return input errors. Data queries are batched by period, with no per-day database query loop.

## Retained generated reports

Generation serializes against relevant shop accounting changes and other generators. Data includes calculation version and source revisions. Identical data returns the existing report and timestamp. Changed data archives the preceding figures and generation time before replacing the displayed version, including legacy reports and reports regenerated after reopening. History is bounded to 30 entries; reaching that limit requires managed archival rather than silent truncation.

Reports containing closed sources or retained prior versions cannot be deleted through the compatibility delete action. The UI marks them as retained history. Print and CSV use stored report figures, show cash separately and preserve zero-valued sales. Daily CSV includes actual sold cost, including manual costs and signed reversal costs. CEO printing checks the selected month and account ownership of its loaded summary.

## Acceptance boundaries

Targeted unit, VM and disposable-database tests cover the core daily/monthly/ALL/CEO/generated/print/CSV calculations, mixed costs, manual entries, separate expenses, cross-shop attribution, close/reverse/resell, reopening, report retention and legacy ambiguity. This advances T13; it does not certify historical manually entered stock rows, economic duplicate expense cleanup, every legacy history/analytics view, complete export formatting, production throughput or physical browser/native accessibility. No legacy repair or production migration is automatic. Prior generated figures remain available in report history when recalculated; a business-data reconciliation rollout is still required.
