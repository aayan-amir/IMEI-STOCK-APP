# Shared dialog and destructive-action gate

## Current implementation update

The positive confirmation path now captures its resolver before closing, so Confirm performs the selected action. Phone deletion, sale reversals (including IMEI lookup and every bulk chunk), product/warehouse/contact/open-report deletion capture account/token/shop/navigation and their relevant record/page context. Stale completions cannot update a different context. Phone deletion wording no longer promises deleting sale history; staff no longer see the owner-only phone-delete control.

Platform pause/resume captures the platform credential context and uses an existing-account-only status endpoint with expected-status conflict detection and auth-version rotation. Permanent account deletion was removed from the UI; the compatibility handler only explains that pausing retains records. No tenant data was deleted by these edits. The old backend deletion endpoint was not activated or exercised by this work.

These latest changes were implemented without running tests, following the user's explicit instruction. Earlier dialog tests and gates below describe the prior checkpoint, not current verification.

## Historical caller audit (superseded by the update above)

The shared modal now has an accessible name, heading focus, bounded Tab/Shift-Tab navigation, inert background, opener restoration, Escape/backdrop cancellation and cancellation when another dialog replaces a pending confirmation. Tests cover replacement and focus both from controls and from the initially focused heading. These target keyboard/focus behavior (WCAG 2.1.1, 2.4.3) and dialog name/role (4.1.2); they do not establish complete accessibility conformance.

The legacy confirmModal positive path remains held. Its close-before-resolve behavior is deliberately not globally enabled by the new features. A regression asserts that positive legacy confirmation still cannot launch a destructive mutation. New stock-check, reviewed recovery, return/refund and counted-cash actions use explicit captured command/context/retry reviews and separate positive controls instead.

## Caller audit

| Caller | Existing protection | Gate before global positive enablement |
|---|---|---|
| deletePhone | Captured ID; server stock identity lock and active-sale exclusion; retained history | Capture authenticated owner and list/card context through review/completion; correct old sale-removal wording |
| deleteSale | Captured sale ID and loaded page/scope; retained server reversal | Exercise actual positive dialog with account/shop/page change and unknown response |
| deleteSaleByIMEI | Resolves exact current sale ID before review; server targets that sale | Bind owner before its asynchronous lookup and through review/completion |
| clearAllSales | Captures loaded active IDs and page/scope | Recheck authenticated context between multi-request batches, not just before the first request |
| deleteProduct | Captured product/revision/page/scope and retained request key | Positive-dialog/replaced-context acceptance before shared activation |
| deleteWarehouseImei | Captured HQ entry identity/scope and retained request key | Positive-dialog/replaced-context acceptance before shared activation |
| deleteContact | Captured contact/page/scope | Positive-dialog/replaced-context acceptance before shared activation |
| deleteReport | Captured report/page/scope; server refuses frozen history deletion | Positive-dialog/replaced-context acceptance; update legacy invoice wording |
| toggleClientStatus | Captured client/status; platform password checked server-side | Bind platform authorization before review and through asynchronous completion |
| deleteClient | Explicit client target and server platform authorization | Destructive tenant deletion lifecycle/recovery/write fencing needs separate safe implementation; never enable it accidentally as a utility side effect |

No phone, sale, product, customer, report or tenant was deleted by this audit. These old positive paths are a remaining release/workflow limitation; preserving their existing gate is not certification that their UI is finished. Source compatibility aliases and underlying authorization checks remain present. See the original improvement plan T06/T08-T10 for the pending guarded destructive workflows.
