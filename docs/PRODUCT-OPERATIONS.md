# Quantity product operations

Product mutations now commit Product, essential AuditLog and optional ProductOperation request receipt together. Transactions require a replica set or transaction-capable cluster; no standalone fallback is used. Shop identity comes from authentication. Admin callers can choose a configured shop or `null` for HQ.

Names normalize with Unicode NFKC, trimmed/collapsed whitespace and lowercase matching within one shop. A ProductIdentity row keyed by the SHA-256 of `(shop, normalizedName)` serializes cooperating writers using its built-in unique `_id`. Existing Product IDs remain stable. Legacy names are checked alongside normalized names and ambiguous duplicate groups return 409; no automatic deduplication or index migration is performed. Legacy candidate scans and the retained lock collection still need the planned scale/index evaluation. No other writer may bypass this service after migration.

## Mutation contracts

- `POST /api/products` accepts `name`, whole nonnegative `quantity`, optional two-decimal nonnegative `buyPrice`, `notes`, and admin `shop`. It atomically adds to a matching product or creates one. Missing quantity retains the legacy zero default; invalid explicit quantities are rejected instead of coerced/truncated. Same-identity concurrent additions preserve every accepted quantity.
- Existing unit cost is never silently replaced. A differing submitted cost returns 409 and requires a separately named product lot. This deliberately avoids inventing weighted-average accounting or rewriting historical purchase costs. Quantity products still represent inventory, not booked sales. Additional lot UI and accounting remain later work.
- `PUT /api/products/:id` supports either an absolute `quantity` with `expectedRevision`, or a signed whole-number `adjustment`. An adjustment cannot make stock negative or exceed safe integer limits. Name/notes edits also require the captured revision. Purchase cost replacement is rejected. Conflicting names fail closed.
- `DELETE /api/products/:id` requires `expectedRevision` captured before confirmation. A product updated since the prompt opened returns 409. Requests remain scoped to the signed-in shop; unavailable/foreign products return 404 before revision checks.
- Successful additions to an existing product and quantity/metadata edits increment revision; a new product begins at revision zero. Deletion records its captured revision in the audit. List responses explicitly expose zero for legacy rows without the field. Blind old-client absolute edits/deletes return 409 with a reload instruction. Signed adjustments provide the additive API option; no new withdrawal UI is implied.

Optional `Idempotency-Key` accepts 8–128 ASCII letters, digits, hyphens and underscores. Within the tenant, the same key and normalized actor/operation intent return the original outcome. Different intent conflicts; malformed stored outcomes fail closed. Concurrent duplicate requests have one product movement/audit/receipt. A delete retry returns its original acknowledgment even if a new product with the same name has since been added.

Essential audit records include product identity, before/after quantities, accepted delta, revision, role/shop and optional request key. Audit failure aborts the quantity change and receipt. Customer or unrelated inventory behavior is not involved.

## Browser behavior and limits

The current form retains one pending request per add/edit/delete action and reuses its key for unchanged retries. Changed intent gets a new key. Keys are held in memory, not promised across reloads. Absolute edits capture the revision when the editor opens; deletes capture it before confirmation. Responses cannot clear newer product input or update another signed-in/shop context. Product names are displayed as text and are no longer interpolated into JavaScript action arguments. The quantity input has a linked label and explicit whole-number step; the icon delete control has an accessible name.

Existing generic confirmation behavior remains gated pending the other destructive workflows. This slice does not enable warehouse, restore or unrelated destructive confirmations. Product mutations have their own server revision/identity safeguards.

The legacy backup format does not yet cover products, ProductIdentity or ProductOperation. Complete versioned recovery is an explicit T10 release gate; current exports are not product recovery files. Existing product history has not been backfilled, and manual writes outside the service have not been certified. Warehouse movements, global IMEI uniqueness, broad request lifecycle/UI polish, scale benchmarks and physical-browser/Android acceptance remain separate plan tasks.

## Verification

`tests/integration/product-quantity.test.cjs` exercises concurrent legacy and new-name additions, 5/8-unit withdrawal conservation, replay/conflict, stale edits/deletion, differing costs, ambiguous identities, audit rollback, actor ownership, edit/add races, exact movement provenance and invalid replay history in an isolated local replica set. `tests/unit/product-requests.test.cjs` executes the actual browser functions in the DOM VM for retry keys, captured revisions, newer input, zero/invalid quantities, context switches and safe action rendering. Prior fake-model ownership tests were replaced by real database ownership assertions; the existing auth ownership matrix also remains active.
