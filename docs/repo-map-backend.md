# Backend source map

Source inspection dated 2026-11-08. This describes checked-in code, not a running deployment or the contents of any database. No server, migrations, database connections, or secret files were used. Source references are repository-relative, one-based line numbers. The companion overview and inventory describe frontend/runtime files.

## Shape and request lifecycle

The backend is one CommonJS Express application. `server.js` loads environment configuration, imports the shared database module and tenant middleware, mounts 12 route modules, starts MongoDB connection attempts, and listens immediately on `0.0.0.0` using `PORT || 3000`. There is no service/repository layer: route handlers call tenant Mongoose models directly (`server.js:3-15,95-114`).

Request middleware runs in this order:

1. Proxy trust configuration: explicit boolean or nonnegative integer `TRUST_PROXY`; invalid explicit values become `1`; production defaults to `1` (`server.js:18-34`).
2. Production HTTPS redirect when an `x-forwarded-proto` header exists and is not `https` (`server.js:38-45`).
3. Unrestricted `cors()`. `ALLOWED_ORIGINS` is parsed into a variable but is not passed to CORS (`server.js:47-48`).
4. Helmet. CSP allows same-origin scripts plus inline scripts/handlers and unpkg; Google fonts/styles; same-origin/data images; same-origin connections. `upgrade-insecure-requests` is disabled (`server.js:50-63`).
5. Global JSON parser, then static files from relative directory `public` (`server.js:67-68`). Static responses therefore precede the API middleware below.
6. All `/api/` requests: 300 requests per IP per minute (`server.js:71-72`).
7. `/api/clients/lookup`: additional 100 requests per 15 minutes (`server.js:74-81`).
8. All `/api/` requests: return 503 unless the primary Mongoose connection has `readyState === 1`. This also gates public login and superadmin requests (`server.js:84-90`).
9. All `/api` requests: tenant model attachment, except the exemptions below (`server.js:92-93`).
10. Routers in order: clients, stock, sales, days, expenses, warehouse, customers, logs, analytics, reports, backup, products (`server.js:96-107`). Per-route authentication occurs here, after tenant selection.

There is no custom global error handler or catch-all API handler in `server.js`. Most route handlers catch and emit JSON 500 errors; stock listing/add/stats and sales listing are examples without a local `try/catch`. Actual uncaught-error handling depends on the installed Express runtime.

## Authentication, tenancy, and shop scope

### Shared identity and tenant selection

- `Client` and `Session` are models on the primary connection. Business data is stored in database `tenant_${clientId}` using `mongoose.connection.useDb(..., { useCache: true })`, additionally cached in an in-process `Map` (`db/index.js:200-223`). These are logical tenant database handles over the primary connection, not independently configured MongoDB connections.
- Tenant middleware skips exactly `/auth`, any path starting `/clients/lookup`, and any path starting `/superadmin` (`middleware/auth.js:105-108`). `/auth/password` is not exempt.
- It initially reads `x-client-id` or query `clientId`; a valid bearer session with `clientId` overrides either supplied value. Missing client ID returns 400. It does not look up the `Client` document to verify existence/status (`middleware/auth.js:110-123`).
- It attaches `req.tenantDb`, 11 models, and `req.validShops` copied from the session or `[]` without a session (`middleware/auth.js:123-139`). Model property `HQStockModel` maps to Mongoose model name `HQStock`; other property names match model names.
- All business routes require a bearer session, so selecting a tenant header alone does not authorize data access. Tenant middleware executes a session lookup and the route auth middleware performs another session lookup (`middleware/auth.js:59-70,112-117`).

### Sessions and roles

- Tokens are 32 random bytes encoded as hex. Creation stores role, optional shop, client ID, valid shop snapshot, and an eight-hour expiry in shared MongoDB. `getSession` explicitly filters expired sessions, in addition to the TTL index (`middleware/auth.js:21-38`; `db/index.js:204-213`).
- Exact `Authorization: Bearer <token>` parsing is used. Missing/expired session returns 401; a role outside the route's allowlist returns 403. `adminOnly` permits `admin`; `anyAuth` permits `admin` and `shop` (`middleware/auth.js:59-74`).
- There is no separate staff/user identity schema, JWT, refresh token, or logout route. A `deleteSession` helper exists and is exported, but no source caller uses it (`middleware/auth.js:41-43,146`; route inventory).
- Client passwords are bcrypt hashes with cost 10; the Client pre-save hook hashes modified password fields. Comparisons use bcrypt (`db/index.js:4-5,183-198`).
- Gate verification returns only `{ok}`; admin/shop login creates a session. Shop login uses the shared gate password and verifies the selected shop belongs to the client's shop IDs (`routes/clients.js:24-81`).
- Superadmin uses a separate static secret from `SUPER_ADMIN_PASSWORD`, with literal fallback `superadmin`; it does not receive or require a session. The static comparison uses `timingSafeEqual` after a length check. List uses `X-Super-Admin-Password`; the other superadmin endpoints use the JSON body (`middleware/auth.js:21,45-56`; `routes/clients.js:112-176`).
- `authLimiter`: 15 attempts per 15 minutes; `superAdminLimiter`: 20 per 15 minutes; both configure `skipSuccessfulRequests: true` (`middleware/auth.js:82-100`). Password mismatches for gate/admin/shop login are returned as HTTP 200 `{ok:false}` (`routes/clients.js:43-65`). Consequently the success-skipping limiter treats those mismatch responses as successful HTTP responses; this is a source-derived interaction, not a live rate-limit test.

### Scope is decided in each route

Tenant database selection is centralized; shop filtering is not. `admin` can generally access all data inside its tenant. `shop` is forced to its own shop for stock listing, stock addition, stats, product listing, and product addition. Lookup and sale operate across the tenant; product edits/deletes use only record ID. The endpoint tables describe these differences explicitly.

`buildSalesByShopQuery(shop)` attributes revenue to `soldByShop`, falling back to `shop` only when `soldByShop` is missing or null; missing/non-string shop produces `{}`. This helper is used by stock stats, sales listing/deletion, and reports (`utils/helpers.js:8-17`). CEO summary performs the related fallback in JavaScript (`routes/analytics.js:79`). Phone `shop` is stock ownership; `soldByShop` is selling attribution, and sale deliberately preserves ownership (`routes/stock.js:100-128`).

## Complete HTTP route inventory

All paths below include the `/api` mount. **Admin** means bearer `admin`; **Any** means bearer `admin` or `shop`; **Super** means static superadmin secret checked by the handler; **Public** means no bearer check. Every row still passes the server's database-readiness gate and applicable rate limits. Scope is within the selected tenant unless marked **master**.

There are **52 declarations in 12 modules**: clients 7, stock 8, sales 4, days 4, expenses 3, warehouse 10, customers 4, logs 1, analytics 2, reports 3, backup 2, products 4. Role totals: 37 Admin, 9 Any, 4 Super, 2 Public.

### Client access and platform administration — `routes/clients.js` (7)

| Method and path | Access / scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/clients/lookup` | Public; master | Query `clientId` required; 404 unknown, 403 paused; returns `{shops}`. No write. | `routes/clients.js:9-21` |
| POST `/api/auth` | Public; master | Body `clientId,type,password,shop`. Unknown client 404; paused 403. `gate` checks gate password, returns `{ok}`. `admin` checks admin password, writes admin Session, returns token/role/shops. `shop` checks gate password and valid shop, writes shop Session, returns token/role/shop/shops. | `routes/clients.js:24-81` |
| PUT `/api/auth/password` | Admin; master Client selected from session | Body current admin password plus optional new admin/gate password. Rechecks current password; saves Client through hashing hook. Returns success. Does not revoke sessions. | `routes/clients.js:85-109` |
| POST `/api/superadmin/verify` | Super; master | Body `superAdminPassword`; returns `{ok:true}` or 403 `{ok:false}`. No session or write. | `routes/clients.js:112-118` |
| POST `/api/superadmin/clients` | Super; master | Body secret plus `clientId,adminPassword,gatePassword,shops,status`. Finds existing client and applies truthy replacements or creates Client with default active status; saves through hash hook; returns Client document. | `routes/clients.js:121-142` |
| GET `/api/superadmin/clients` | Super; master | Header secret; lists all Clients excluding admin/gate password fields. No write. | `routes/clients.js:147-158` |
| DELETE `/api/superadmin/clients/:clientId` | Super; master + target tenant | Body secret; deletes master Client, then drops `tenant_${clientId}` database. Does not remove shared Sessions or cached tenant handle. | `routes/clients.js:161-176` |

Client shop entries are flexible array elements, not a child schema; login expects each to have an `id` (`db/index.js:179`; `routes/clients.js:41`). Create/update returns the unprojected Client while list explicitly removes password fields (`routes/clients.js:134,138,153`).

### IMEI stock and sale creation — `routes/stock.js` (8)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/lookup/:imei` | Any; tenant-wide | Looks up Phone by primary IMEI, without ownership/status filter; returns phone or `{}`. No write. | `routes/stock.js:10-18` |
| GET `/api/stock` | Any; shop session forced to own shop, admin optional valid shop | Query `all=true` includes every status; otherwise only `in_stock`. Valid `soldByShop` overrides ownership filter; shop user can request only its own selling shop or gets 403. Returns lean rows with `id: _id`. Invalid admin shop filter becomes tenant-wide. | `routes/stock.js:22-42` |
| POST `/api/stock/add` | Any; shop session forced to own shop, admin body shop | Requires trimmed 15-digit IMEI, prechecks Phone duplicates. Trims metadata; invalid/negative/non-finite buy price becomes 0. Creates in-stock Phone with addedAt, then non-awaited `stock_add` AuditLog. Returns phone. Does not check HQ inventory for same IMEI. | `routes/stock.js:46-80` |
| POST `/api/stock/sell` | Any; tenant-wide Phone lookup | Requires existing unsold 15-digit IMEI and numeric price >0. Selling shop is explicit body `soldByShop` if in session validShops, else authenticated shop, else owning shop. Marks Phone sold, creates Sale with stored profit, optionally creates/enriches Customer, and emits non-awaited `stock_sell` log. Returns Sale. No own-stock predicate, and a shop user may explicitly attribute sale to any valid shop. | `routes/stock.js:83-172` |
| GET `/api/stats` | Any; shop forced own, admin optional valid shop | Counts all owning-shop Phone statuses; revenue/sales count use selling-shop helper. Returns inStock/sold/total/totalRevenue/salesCount. Invalid admin shop becomes tenant-wide. No write. | `routes/stock.js:176-193` |
| PUT `/api/stock/batch` | Admin; selected IDs tenant-wide | Nonempty valid ObjectId string array required. Allows brand/model/color/storage/buyPrice/imei2/cat/notes/shop; buy price must be numeric >=0, imei2 is digits-only, trims nonempty strings. `updateMany`, rereads, returns matched/modified/phones. Does not edit primary IMEI or sale snapshot. | `routes/stock.js:196-242` |
| PUT `/api/stock/:id` | Admin; selected ID tenant-wide | Same allowed field names as batch; sets supplied fields directly, without batch normalization. Returns updated Phone or 404. Does not update existing Sale. | `routes/stock.js:245-256` |
| DELETE `/api/stock/:id` | Admin; selected ID tenant-wide | Validates ObjectId. If Phone is sold, deletes all Sales matching IMEI first; deletes Phone, emits `stock_delete` log. Missing phone still returns success. | `routes/stock.js:259-281` |

### Sale history and reversal — `routes/sales.js` (4)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/sales` | Admin; optional selling-shop helper | Optional query shop; returns matching Sale documents without pagination. No write. | `routes/sales.js:9-13` |
| DELETE `/api/sales` | Admin; optional selling-shop helper | Finds matching sales, collects IMEIs, marks matching Phones in_stock and unsets salePrice/soldAt, then deletes matching Sales; returns deleted count. Empty result returns 0. | `routes/sales.js:17-37` |
| DELETE `/api/sales/by-imei/:imei` | Admin; tenant-wide | Finds first Sale by IMEI or 404; reverts first Phone by IMEI, then deletes that Sale. Returns success. | `routes/sales.js:40-55` |
| DELETE `/api/sales/:id` | Admin; tenant-wide | Finds Sale by ID or 404; reverts first Phone by sale IMEI, then deletes Sale. Returns success. | `routes/sales.js:58-73` |

All three reversal handlers leave Phone `soldByShop` intact. None updates Customer records, saved Reports, Day records, or audit logs (`routes/sales.js:25-31,45-49,63-67`).

### Day ledgers — `routes/days.js` (4)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/days` | Admin; optional arbitrary shop | Query shop/month; validates month shape YYYY-MM, applies date-prefix regex, sorts descending date, returns lean days. No write. | `routes/days.js:8-22` |
| GET `/api/days/:shop/:date` | Admin; path shop/date | Finds one Day, returns document or `{}`. No write. | `routes/days.js:25-32` |
| PUT `/api/days/:shop/:date` | Admin; path shop/date | Upserts Day. Accepts cats directly, replaces expenses/purchases/transfers only if arrays, converts carryForward to number or 0. Returns day. No server-side calculation of ledger totals. | `routes/days.js:35-54` |
| DELETE `/api/days/:shop/:date` | Admin; path shop/date | Deletes one matching Day, returns success. | `routes/days.js:57-65` |

### Shop expenses — `routes/expenses.js` (3)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/shopexpenses` | Admin; optional shop/month | Exact query filters, descending date. Returns lean expenses with `id` and `_key` aliases for `_id`. No write. | `routes/expenses.js:8-19` |
| POST `/api/shopexpenses` | Admin; supplied shop | Trims shop/date/month/category/description; finite amount retained (negative allowed), otherwise 0; creates ShopExpense with addedAt; returns expense plus `_key`. | `routes/expenses.js:22-40` |
| DELETE `/api/shopexpenses/:id` | Admin; selected ID | Deletes ShopExpense; returns success. | `routes/expenses.js:43-50` |

Day `expenses` and `ShopExpense` are separate data sources. A write to one does not synchronize the other (`routes/days.js:38-49`; `routes/expenses.js:24-35`).

### HQ warehouse, shipments, dispatches — `routes/warehouse.js` (10)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/hqstock` | Admin; tenant HQ | Finds HQStock with key hq, returns document or `{items:[]}`. No write. | `routes/warehouse.js:9-16` |
| PUT `/api/hqstock` | Admin; tenant HQ | Replaces entire items array (nonarray becomes empty) using upsert; sets key hq and updatedAt. No item validation. Returns stock. | `routes/warehouse.js:19-32` |
| DELETE `/api/hqstock/:imei` | Admin; tenant HQ | Removes matching items by normalized 15-digit IMEI or raw string fallback, then saves updatedAt. Missing HQ succeeds. | `routes/warehouse.js:35-62` |
| DELETE `/api/hqstock/at/:index` | Admin; tenant HQ | Parses index; nonnumeric 400; removes one item at in-range index and saves updatedAt. Out-of-range/missing HQ succeeds. | `routes/warehouse.js:65-82` |
| POST `/api/shipments` | Admin; tenant HQ | Requires nonempty items. If every item has truthy IMEI: normalizes/validates 15-digit values, rejects duplicate payload/Phone/HQ IMEIs, appends normalized items to HQ. Then creates Shipment storing original items and date/supplier/ref/addedAt. Mixed/non-IMEI payloads create history only. | `routes/warehouse.js:85-144` |
| GET `/api/shipments` | Admin; tenant-wide | Lists Shipment descending date. No write. | `routes/warehouse.js:147-154` |
| DELETE `/api/shipments/:id` | Admin; selected history ID | Deletes Shipment only; does not reverse received HQ stock. | `routes/warehouse.js:157-164` |
| POST `/api/dispatches` | Admin; validated destination shop | Requires toShop in session validShops and nonempty items. If every item has IMEI: validates unique 15-digit values, rejects Phone duplicates, requires HQ presence, builds Phones from HQ metadata, inserts Phones, removes HQ items. Then creates Dispatch with original items. Mixed/non-IMEI payloads create history only. | `routes/warehouse.js:167-236` |
| GET `/api/dispatches` | Admin; tenant-wide | Lists history descending date; computes totalPhones from normalized IMEI count or qty sum. Computes soldPhones by current sold Phone matching destination owning shop and IMEI. Adds these derived fields to response; does not persist them. | `routes/warehouse.js:239-269` |
| DELETE `/api/dispatches/:id` | Admin; selected history ID | Deletes Dispatch only; does not move shop Phones back to HQ. | `routes/warehouse.js:272-279` |

`/hqstock/:imei` cannot match `/hqstock/at/:index` because the latter has two path segments. Warehouse normalize function removes nondigits (`routes/warehouse.js:6`). Individual HQ item fields are arbitrary embedded array objects; normalized receive records currently use imei/imei2/cat/brand/model/color/storage/buyPrice/notes/addedAt (`routes/warehouse.js:95-106`).

### Contacts — `routes/customers.js` (4)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/customers` | Admin; tenant-wide | Optional string q truncated to 200 chars and regex-escaped; case-insensitive name or phone substring query; sorts name. No write. | `routes/customers.js:8-22` |
| POST `/api/customers` | Admin; tenant-wide | Requires truthy name; creates name/phone/email/notes/addedAt. Returns customer. | `routes/customers.js:25-35` |
| PUT `/api/customers/:id` | Admin; selected ID | Sets supplied name/phone/email/notes after string conversion; returns updated customer or 404. | `routes/customers.js:38-56` |
| DELETE `/api/customers/:id` | Admin; selected ID | Deletes Customer; returns success. No cascade to historical buyer snapshots in Sales. | `routes/customers.js:59-66` |

### Audit history — `routes/logs.js` (1)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/logs` | Admin; optional arbitrary shop | Query limit defaults 200, clamps 1-500. before may be log ObjectId (lookup timestamp and use ts/_id tie-break) or parseable date (strict earlier timestamp). Invalid non-ID/date is 400; unknown valid ObjectId adds no cursor predicate. Sort ts descending then _id descending. No write. | `routes/logs.js:9-43` |

Only stock add/sell/delete call `logAction`. Logging is fire-and-forget and catches its own failures, so a successful stock response does not prove an audit document was persisted (`middleware/auth.js:76-80`; `routes/stock.js:76,162,273`).

### Analytics — `routes/analytics.js` (2)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/analytics/models` | Admin; tenant-wide | days defaults 30; recent Sale lookback is configurable, stale Phone cutoff fixed 30 days. Returns top 15 sold models by count with revenue/profit; top 15 stagnating models by oldestDays with quantity/cost/shop summary. No write. | `routes/analytics.js:9-51` |
| GET `/api/ceo/summary` | Admin; tenant-wide | Optional month shape YYYY-MM, else current UTC ISO month. Reads current/prior sales, current ShopExpense, current in-stock Phones. Returns current revenue/profit/expenses/net/units, previous revenue/profit, per selling-shop metrics, top 5 models, current inventory count/value. No write. | `routes/analytics.js:54-132` |

The summary computes prior month via local `new Date(y,m-2,1)` followed by UTC `toISOString`; inventory is current inventory even when querying a historical month (`routes/analytics.js:60-69,125-126`). Revenue/profit attribution uses `soldByShop || shop`; ownership is unchanged. Profit is summed from Sale snapshots rather than recalculated from current Phone purchase cost (`routes/analytics.js:79-85,106-110`).

### Persisted reports — `routes/reports.js` (3)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/reports` | Admin; optional shop/type | Lists latest 100 matching saved Reports, descending period. No write. | `routes/reports.js:9-20` |
| POST `/api/reports/generate` | Admin; specified shop or ALL | Requires type/shop/period; regex allows YYYY-MM or YYYY-MM-DD for either type. Daily reads Sale prefix plus selected Day; daily expenses sum day.expenses[].amt, ALL uses no Day and 0 expenses. Monthly reads Sale prefix and ShopExpense exact month. Computes financial summaries; upserts Report keyed type/shop/period; returns report. Other types 400. | `routes/reports.js:23-94` |
| DELETE `/api/reports/:id` | Admin; selected ID | Deletes saved Report; leaves original business data. | `routes/reports.js:97-104` |

Reports are snapshots updated only on generation. Daily includes a salesList with stock-owning `shop`, although selection uses selling-shop helper. Monthly includes expenseBreakdown. There is no server-side shop membership validation in report generation (`routes/reports.js:25-30,35-56,59-87`).

### Export/import — `routes/backup.js` (2)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/backup` | Admin; tenant-wide | Parallel reads Phones/Sales/Days/ShopExpenses/HQStock/Shipments/Dispatches; JSON version 1, exportedAt, seven data keys. No Customer/AuditLog/Report/Product/master identity export. No write. | `routes/backup.js:8-33` |
| POST `/api/restore` | Admin; tenant-wide | Accepts same seven keys. Field allowlists, then sequential collection operations: upsert Phones by IMEI, Sales by ID or IMEI+soldAt, Days by shop/date; insert expenses; replace HQ items; insert shipments and dispatches. No collection wipe. Some unordered insert errors are logged and swallowed; returns success without per-record results. | `routes/backup.js:37-120` |

Restore is a merge/import, not a full replacement. See exact field fidelity and consistency boundaries below. The route-local JSON parser declares a 50mb limit, but a global JSON parser runs first (`server.js:67`; `routes/backup.js:37`); the later parser cannot make an earlier parser accept an already-rejected body. This is a middleware-order inference, not an exercised upload test.

### Quantity-based products — `routes/products.js` (4)

| Method and path | Access / shop scope | Inputs, behavior, response, write effects | Source |
|---|---|---|---|
| GET `/api/products` | Any; shop forced own, admin optional query shop | Lists Product by optional shop, ascending name; lean response adds id alias. No write. | `routes/products.js:8-18` |
| POST `/api/products` | Any; shop forced own, admin body shop or null | Requires nonblank name; quantity integer clamped >=0. Finds exact case-insensitive escaped name in same shop. If existing: adds quantity and optionally updates price/notes. Else creates Product. Returns product and merged true for merge. | `routes/products.js:21-56` |
| PUT `/api/products/:id` | Any; ID-only across tenant | Sets supplied name/quantity/buyPrice/notes; quantity integer clamped >=0; returns updated product or 404. No shop predicate or ownership check. | `routes/products.js:59-74` |
| DELETE `/api/products/:id` | Any; ID-only across tenant | Deletes Product by ID, returns success. No shop predicate or ownership check. | `routes/products.js:77-85` |

Product quantity is independent of IMEI Phone stock, warehouse movements, Sale records, and financial report calculations. There is no product-sale endpoint or automatic quantity decrement in these handlers.

## Database model inventory

`db/index.js` defines **13 schemas: 11 tenant schemas and 2 shared schemas**. Unless noted, declarations use String/Number/Array without required, enum, min/max, relation/ref, or schema-specific indexes. Every model additionally has Mongoose/MongoDB identity fields; `_id` and the normal version key are not manually declared. No explicit collection names are configured, so model naming supplies them. Only Phone enables automatic timestamps explicitly.

Legend: S = String, N = Number, A = unrestricted Array, Mixed = `mongoose.Schema.Types.Mixed`. These are declarations, not verified contents or a claim that every historical document matches the current schema.

| Schema / model | Scope | Every explicitly declared field | Defaults, hooks, indexes, source |
|---|---|---|---|
| PhoneSchema / Phone | Tenant | S: imei, imei2, brand, model, color, storage, status, shop, soldByShop, cat, notes, addedAt, soldAt. N: buyPrice, salePrice. | status default in_stock; timestamps true adds createdAt/updatedAt; toJSON virtuals true. Nonunique indexes `{imei:1}`, `{shop:1,status:1}`, `{createdAt:-1}`. `db/index.js:60-80` |
| SaleSchema / Sale | Tenant | S: imei, brand, model, shop, soldByShop, buyerName, buyerPhone, notes, soldAt. N: buyPrice, salePrice, profit. | No explicit indexes/defaults/timestamps. `db/index.js:82-95` |
| DaySchema / Day | Tenant | S: shop, date. Mixed: cats. A: expenses, purchases, transfers. N: carryForward. | No unique shop/date constraint or explicit indexes/timestamps. `db/index.js:97-105` |
| ShopExpenseSchema / ShopExpense | Tenant | S: shop, date, month, category, description, addedAt. N: amount. | No explicit indexes/defaults/timestamps. `db/index.js:107-115` |
| HQStockSchema / HQStock (`req.models.HQStockModel`) | Tenant | S: key, updatedAt. A: items. | key default hq; items explicit default []; key is not declared unique. `db/index.js:117-121`; `middleware/auth.js:130` |
| ShipmentSchema / Shipment | Tenant | S: date, supplier, ref, addedAt. A: items. | No explicit indexes/defaults/timestamps. `db/index.js:123-129` |
| DispatchSchema / Dispatch | Tenant | S: date, toShop, note, addedAt. A: items. | No explicit indexes/defaults/timestamps. `db/index.js:131-137` |
| CustomerSchema / Customer | Tenant | S: name, phone, email, notes, addedAt. | No required/unique name or phone and no explicit indexes. `db/index.js:139-145` |
| AuditLogSchema / AuditLog | Tenant | S: action, shop, role, ts. Mixed: details. | ts default current ISO string. Indexes `{ts:-1}`, `{shop:1,ts:-1}`. `db/index.js:147-155` |
| ReportSchema / Report | Tenant | S: type, shop, period, generatedAt. Mixed: data. | Comments describe daily/monthly, but no enum; no unique type/shop/period index. `db/index.js:157-163` |
| ProductSchema / Product | Tenant | S: name, shop, notes, addedAt. N: quantity, buyPrice. | name required; quantity default 0; no unique name/shop index or quantity min. `db/index.js:165-172` |
| ClientSchema / Client | Primary shared DB | S: clientId, adminPassword, gatePassword, status. A: shops. | clientId required unique; both passwords required; shops default []; status default active enum active/paused. Modified passwords hashed bcrypt10 on save; compareAdminPassword/compareGatePassword methods. `db/index.js:175-200` |
| SessionSchema / Session | Primary shared DB | S: token, role, shop, clientId. String array: validShops. Date: expiresAt. | token required unique indexed; expiresAt TTL index expires 0; explicit compound `{token:1,clientId:1}` index. No role enum or client reference. `db/index.js:204-213` |

No schema declares foreign-key-style refs. Linkage is by strings: tenant clientId is in database name/session; shop IDs are strings copied from Client shops; sale↔phone and warehouse items link by IMEI; report/day identity is a set of strings. Buyer details are Sale snapshots, not Customer references.

### Connection behavior and index lifecycle

- `connectMongo()` connects using `MONGO_URI`, guarding concurrent attempts with `reconnecting`. Timeouts: selection 30s, socket 45s, connect 30s, heartbeat 10s. Failures increment counter and retry with `min(1000*2^attempt,30000)` milliseconds; first failed attempt schedules 2s. Success resets counter. Disconnection triggers reconnection; error event logs (`db/index.js:9-47`).
- On the first primary connection open, code tries to drop `clients.slug_1`; every drop error is swallowed. This is an automatic startup mutation, not merely a read or explicit migration (`db/index.js:49-57`).
- Tenant handles are cached by raw clientId in a Map and Mongoose useDb cache; there is no cache eviction function (`db/index.js:216-223`).
- Schema index declarations are catalogued above; whether indexes actually exist or finished building in a deployment was not inspected. IMEI, HQ key, shop/date, report identity, and product name/shop are not declared unique.

## Business workflows and data ownership

### Provision → choose client → authenticate

Superadmin creates/updates Client shops/passwords/status. Public lookup supplies shop menu. Optional gate check returns a boolean; actual shop login independently verifies the same gate password, and admin login independently verifies admin password. Session records validShops at login. Subsequent requests bind tenant to Session clientId and carry its shop snapshot (`routes/clients.js:9-81,121-142`; `middleware/auth.js:110-138`).

Client pause is checked by lookup/login only. Password updates, paused status changes, changed shops, and Client deletion do not invalidate existing Sessions in the shown source; authenticated business requests do not re-read Client (`routes/clients.js:15,37,85-109,121-176`; `middleware/auth.js:35-38,105-139`). The observed behavior is session-based access until expiry, independent of later identity changes; no live access test was run.

### Acquire stock → dispatch → sell

Two stock entry paths exist: direct add creates Phone immediately at a shop; IMEI shipments place embedded items in HQ. Dispatch validates warehouse membership, copies HQ metadata into new shop Phones, removes selected HQ items, and stores history (`routes/stock.js:46-80`; `routes/warehouse.js:85-144,167-236`).

Sale changes the existing Phone and writes a separate Sale snapshot. Ownership remains `phone.shop`; revenue can belong to a different `soldByShop`. Gross profit is salePrice minus Phone buyPrice at sale time. Customer auto-save is nonfatal: it requires a nonempty buyerName, searches exact case-insensitive escaped name OR exact phone, fills a missing phone on an existing contact, or creates a name/phone contact. Buyer phone without a name does not create a contact (`routes/stock.js:100-159`). Sale history and analytics read snapshot costs/profit; later phone edits do not recalculate old sales.

Reversal deletes Sale(s) and restores phone status/pricing timestamps, leaving selling-shop attribution and contacts. Deleting a sold Phone deletes all its IMEI Sale rows first; shipment/dispatch deletion affects history only. None of these operations updates saved reports (`routes/sales.js:17-73`; `routes/stock.js:259-281`; `routes/warehouse.js:157-164,272-279`).

### Ledger → expense register → reporting

Day is a flexible per-shop/date ledger containing category aggregates and arrays; the backend persists client-supplied structures. ShopExpense is an independent month-tagged register. Daily report expenses come from Day.expenses[].amt; monthly/CEO expense totals come from ShopExpense.amount. Daily ALL intentionally has zero day expenses because no Day is loaded. Reports are persisted snapshots; model analytics and CEO summary are live queries (`routes/days.js:35-54`; `routes/reports.js:34-88`; `routes/analytics.js:9-132`).

### Quantity products

Products maintain name/quantity/cost per shop independently. Repeated case-insensitive same-name addition in a shop performs read-modify-save merge. This is separate from shipments, dispatches, IMEI sales, and analytics. Shop listing/addition are scoped; product update/delete rely only on tenant and record ID (`routes/products.js:8-85`).

## Consistency boundaries and source-backed caveats

These are implementation boundaries directly visible in source, not a penetration test or a claim about observed production failures. A search of backend source found no `startSession`, `withTransaction`, `startTransaction`, `commitTransaction`, or `abortTransaction` usage. Multi-document workflows use sequential ordinary operations, with the specific compensation described below.

| Workflow | Write order / recovery | Practical boundary and evidence |
|---|---|---|
| Direct Phone creation | Duplicate lookup → Phone save → asynchronous AuditLog | IMEI check is separate from insert and schema index is nonunique; source does not enforce a concurrent uniqueness invariant. Direct add checks Phone, not HQ. `routes/stock.js:54-76`; `db/index.js:78` |
| Sell | Read Phone/check status → save sold Phone → save Sale → optional Customer → async log | If Sale save fails, attempts to restore status/salePrice/soldAt; rollback errors are logged. It does not unset soldByShop. There is no atomic status-conditioned update coupling concurrent sales. Contact/log failures do not undo sale. `routes/stock.js:93-159,162-166` |
| Sale reversal | Update Phone(s) → delete Sale(s) | No compensating rollback if later delete fails; soldByShop is not unset. `routes/sales.js:23-31,45-49,63-67` |
| Delete sold Phone | Delete matching Sales → delete Phone → async log | Multiple writes without transaction or compensation. `routes/stock.js:266-275` |
| IMEI shipment | Read existing Phone/HQ → replace HQ merged array → save Shipment | HQ write can precede a failing history save. Entire HQ array is assembled from a prior read, not appended with a condition. `routes/warehouse.js:119-139` |
| IMEI dispatch | Read/check Phone and HQ → insertMany Phones → replace HQ items → save Dispatch | No transaction or compensating delete if later HQ/history write fails. Ordered insertMany is specified, which orders work but is not a multi-collection transaction. `routes/warehouse.js:185-231` |
| HQ manual edit/delete | Read/replace whole items array or read-modify-save | No coupling to Phone existence or shipment/dispatch history. `routes/warehouse.js:19-78` |
| Product merge | Find same-name shop record → increment JS quantity → save | Separate read/write, no atomic $inc or unique name/shop constraint declared. `routes/products.js:29-39`; `db/index.js:165-172` |
| Day/report upsert | findOneAndUpdate with logical identity predicate | No corresponding unique indexes declared for shop/date or type/shop/period. `routes/days.js:45-49`; `routes/reports.js:84-88`; `db/index.js:97-105,157-163` |
| Tenant deletion | Delete Client → drop tenant DB | No transaction, session purge, or tenant cache eviction. `routes/clients.js:168-171`; `db/index.js:216-223` |
| Backup export | Seven reads in Promise.all | No database snapshot transaction; collections may reflect different moments if concurrent writes occur. Four tenant models and shared identity are omitted. `routes/backup.js:10-28` |
| Restore | Sequential upserts/inserts/replacement; some insert failures swallowed | No overall rollback, deletion of absent records, data-version validation, or per-record success report. Repeated restore inserts fresh expenses/shipments/dispatches. `routes/backup.js:39-115` |

### Restore field fidelity

The import allowlists do not match the current schema completely (`routes/backup.js:47-112`; `db/index.js:60-172`):

- Phone allowlist omits `soldByShop` and `notes` (also does not restore original timestamp identity fields). New/imported records therefore cannot recover those omitted values from backup; existing values may survive because this is `$set` merge.
- Sale allowlist omits `soldByShop` and `notes`; it includes undeclared imei2/cat/color/storage fields.
- Day allowlist omits `carryForward`; it includes undeclared tSales/tCost/tExp/netPL/lastUpdated.
- Expense allowlist omits `month`, which monthly reports and CEO summary query. Inserts create new identities instead of restoring original `_id` values.
- Shipment/Dispatch allowlists omit `addedAt` and include some undeclared fields (`source`, and selected others). Original items arrays are copied without a nested schema allowlist.
- HQ items have a separate allowlist; fields outside it are not copied. If hqstock is supplied with nonarray items, HQ items becomes empty.
- Customer, AuditLog, Report, Product, Client, and Session have no export/import branch.

The observable source fact is the allowlist mismatch. Exact handling of undeclared fields is governed by the installed Mongoose defaults; no database round-trip was used to establish historical document behavior.

### Other contract distinctions

- Stored dates are mostly ISO/date-prefix strings, not Date fields. Only Session expiry and Phone automatic timestamps have native Date declarations. Month/date regex validation checks shape, not calendar validity (`db/index.js:60-211`; `routes/days.js:14`; `routes/reports.js:30`; `routes/analytics.js:57`).
- `/analytics/models` accepts numeric conversion of days without an explicit finite/nonnegative guard; invalid date conversion is caught and returns 500 (`routes/analytics.js:11-13,48-50`).
- Single phone edits have fewer validation/normalization checks than batch phone edits. Neither changes historical Sale snapshots (`routes/stock.js:207-231,247-250`).
- Success on a delete does not always mean a record existed: several delete handlers deliberately omit a not-found check. Sale reversal and selected update handlers do return 404 when missing; see the route inventory.
- Shop membership/status/passwords are session snapshots or login-time checks as described above. There is no blanket shop-ownership middleware: the exact route predicate is the access boundary.

## Where to make future backend changes

| Change | Primary source locations | Related consistency/contracts to check |
|---|---|---|
| Add a tenant entity | `db/index.js`; `middleware/auth.js:125-136`; new/existing route; `server.js:96-107` | Backup/restore coverage, frontend payload shape, shop scope. |
| Change client identity/session policy | `routes/clients.js`; `middleware/auth.js`; shared schemas `db/index.js:175-213` | Existing session lifetime and validShops snapshot; superadmin static-secret contract. |
| Change sale ownership/revenue attribution | `routes/stock.js:83-172`; `utils/helpers.js`; `routes/sales.js`; `routes/analytics.js`; `routes/reports.js` | Preserve distinction between stock-owning shop and selling shop; reversal and restore fields. |
| Change warehouse flow | `routes/warehouse.js`; HQStock/Shipment/Dispatch/Phone schemas | IMEI versus mixed/non-IMEI history branch, operation order, history deletion behavior. |
| Change accounting/reporting | `routes/days.js`; `routes/expenses.js`; `routes/reports.js`; `routes/analytics.js` | Day expense `amt` versus ShopExpense `amount`, saved snapshot versus live query, period/timezone rules. |
| Change quantity products | `routes/products.js`; `db/index.js:165-172` | Shop-scoped create/list versus ID-only mutation; merge concurrency; intentionally independent stock ledger. |
| Change backup format | `routes/backup.js`; all current schemas | Seven-key version1 scope, field omissions, merge versus replacement, parser middleware order. |

