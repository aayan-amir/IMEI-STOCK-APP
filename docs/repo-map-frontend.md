# Frontend repository map

Static source map, prepared 2026-11-08. This document describes the authored browser application in `public/`; it does not assert that a flow was exercised successfully. No application/server, camera, migration, database connection, backup, restore, or external API request was run. Line anchors refer to this checkout. Server authorization and database effects require the backend map.

## Architecture and entry points

The frontend is a single HTML document with fifteen predeclared page panels, one CSS file, and nine classic scripts sharing global scope. Navigation switches CSS classes; it does not change the URL, use browser history, mount framework components, or import JavaScript modules. Inline HTML handlers and generated HTML invoke global functions directly. The comments in authored JS identify a previous automatic split from `index.html`; this is historical metadata, not a separate application entry point.

| Asset | Responsibility and source |
|---|---|
| `public/index.html` | Authentication screens, hidden authenticated shell, navigation, fifteen `.pg` sections, scan/add/sell/product/batch controls, camera dialog, generic modal, toast. [Entry metadata](../public/index.html#L5), [navigation](../public/index.html#L154), [script loading](../public/index.html#L933). |
| `public/css/app.css` | 2,698-line global stylesheet: light color tokens, flex shell, components, responsive rules, auth, confirmation modal, reduced motion. [Tokens](../public/css/app.css#L1). |
| `public/js/keyboard.js` | Immediate visual viewport/keyboard adaptation. [Initializer](../public/js/keyboard.js#L12). |
| `public/js/globals.js` | API origin, category/shop constants, device mode, session/page/data globals. [BASE](../public/js/globals.js#L4), [state](../public/js/globals.js#L64). |
| `public/js/utils.js` | DOM lookup, sidebar, modal/confirmation, keyboard shortcuts, text/currency/date formatting, API/auth fetches, clock. [Start](../public/js/utils.js#L4). |
| `public/js/ui.js` | Navigation dispatch, shop selection and per-page refresh, sidebar statistics polling. [Start](../public/js/ui.js#L4). |
| `public/js/imei.js` | Main operating UI: IMEI lookup/add/sell, batch intake, camera scanning, phone inventory/edit/delete, sales log, non-IMEI products. [Start](../public/js/imei.js#L5). |
| `public/js/daily.js` | Daily stock/cash sheet, expense/purchase/transfer rows, saved-day history, monthly P&L, most print views. [Start](../public/js/daily.js#L5). |
| `public/js/ceo.js` | Warehouse receipt/dispatch, shipment history, backup/restore, executive overview, contacts, model analytics, activity logs, saved reports, shared print/CSV helpers; also role authentication functions. [Start](../public/js/ceo.js#L5), [auth functions](../public/js/ceo.js#L906). |
| `public/js/auth.js` | Browser login attempt counters, client lookup, super-admin client management, dynamic shop controls/colors. [Start](../public/js/auth.js#L5). |
| `public/js/app.js` | Session restoration and authenticated bootstrap. [Bootstrap](../public/js/app.js#L5), [immediate initialization](../public/js/app.js#L23). |
| `public/js/zxing.min.js` | Vendored barcode decoder, loaded before authored code. Application boundary is `window.ZXing.BrowserMultiFormatReader()` and `decodeFromCanvas()`. Its minified internals were not expanded or mapped. [Integration](../public/js/imei.js#L387), [decode](../public/js/imei.js#L643). |
| `public/manifest.json`, `public/icons/icon.svg` | Install metadata and vector branding. [Manifest](../public/manifest.json#L1), [icon declaration](../public/index.html#L13). |

### Script loading and startup sequence

1. Head loads Google Fonts CSS for DM Sans/DM Mono, the local ZXing classic script, then app CSS. [HTML 15](../public/index.html#L15).
2. After all DOM elements, classic scripts load synchronously in this exact order: `keyboard → globals → utils → ui → imei → daily → ceo → auth → app`. There is no `defer`, `async`, or `type="module"`. [HTML 933](../public/index.html#L933).
3. `keyboard.js` immediately installs viewport listeners; `utils.js` immediately starts the 30-second clock interval and ticks once; `ui.js` installs a 12-second stats interval gated on `authRole`. [Keyboard 12](../public/js/keyboard.js#L12), [clock 127](../public/js/utils.js#L127), [poll 113](../public/js/ui.js#L113).
4. `app.js` reads browser session keys. If `authToken`, `authRole`, and `clientId` exist, it restores shops/role, hides the auth overlay, and boots without a separate token-verification request. Otherwise it shows the client sign-in, optionally prefilled from stored client information. [App 23](../public/js/app.js#L23).
5. `bootApp()` reveals shell, applies phone restrictions, selects restored shop (or first configured shop), calls `switchShop()`, optionally locks shop mode, initializes date/month controls, refreshes sidebar stats, loads inventory when needed, and focuses the IMEI input. [App 5](../public/js/app.js#L5).

Dependency implications: `imei.js` uses category helpers declared later in `daily.js`; `daily.js` uses `printSection`/`dlCSV` declared in `ceo.js`; `ceo.js` authentication uses lock helpers from `auth.js`; those calls happen after the scripts have loaded. `app.js` must stay last. These are shared-global dependencies, not module imports.

## HTML shell, navigation, and input inventory

The shell has a topbar with dynamic shop tabs, connection status, and clock; a sidebar grouped into shop operations, Head Office, and Tools; and `#main` holding the panels. A skip link points to `#main`. Topbar and wrapper initially use `display:none`. [HTML 23](../public/index.html#L23), [topbar 134](../public/index.html#L134), [sidebar 155](../public/index.html#L155).

`nav(page)` deactivates all `.pg` and `.ni`, activates `pg-${page}`/`ni-${page}`, closes the mobile sidebar, and dispatches the appropriate loader. It initializes some filters on entry, so navigating back to sales, expenses, monthly, or CEO can reset period controls. [UI 4](../public/js/ui.js#L4).

| Page key / HTML panel | Inputs and actions | Loader / renderer |
|---|---|---|
| `scan` [229](../public/index.html#L229) | Modes Add, Batch, Sell, Product; typed/scanner IMEI, camera. Add: category, brand, model, color, storage, buy price, primary read-only IMEI, optional secondary IMEI, notes. Sell: sale price, selling shop, buyer name/phone, notes, cross-shop warning/profit preview. Product: name, quantity, unit buy price, notes. Batch: shared category/brand/model/color/storage/buy price, per-phone IMEI1/IMEI2/color, queue/clear/save. | `setMode`, `handleImeiSubmit`, `submitAdd`, `submitSell`, `submitProduct`, `submitBatch`; scan navigation just focuses input. |
| `imeistock` [470](../public/index.html#L470) | In-stock/sold/all chips; brand/model/IMEI search and clear; group/flat toggle, expand/collapse, CSV/print; admin selection and batch edit; individual edit/delete. | `loadIMEIData`, `renderIMEIStock`. |
| `saleslog` [508](../public/index.html#L508) | Shop, from/to dates; reload, CSV, print, clear-all; date-group expand and per-sale delete. | `loadSalesLog`, `renderSalesLog`. |
| `stock` [537](../public/index.html#L537) | Work date; save/new day/CSV/print; stock category tables; editable EXTRA rows; daily expense, purchase, transfer lists; carry-forward cash; six summary cards and cash-flow strip. | `loadDay`, stock/list renderers, `recalc`. |
| `expenses` [609](../public/index.html#L609) | Shop/month filters, add expense, print, delete expense rows. Add modal: shop, date, category, amount, description. | `renderShopExpenses`. |
| `history` [633](../public/index.html#L633) | Shop filter, print; saved-day expandable sold-item details, open full day, delete. | `loadAllDays`, `renderHistory`. |
| `warehouse` [654](../public/index.html#L654) | Search, receive, dispatch, print; warehouse item delete. Receipt modal: supplier/date/reference, shared phone attributes and IMEI queue. Dispatch modal: shop/date/note, phone checkboxes. | `loadWarehouse`, `renderWarehouse`. |
| `shipments` [673](../public/index.html#L673) | Shop/month filters, receipt/dispatch actions, print, delete records; inbound and dispatch cards with phone lists and dispatch sell-through. | `loadShipments`, `renderShipments`. |
| `monthly` [692](../public/index.html#L692) | Month/shop, refresh/print, per-shop P&L cards. | `renderMonthly`. |
| `ceo` [709](../public/index.html#L709) | Month, refresh/print; KPI grid, prior-month comparison, per-shop performance, top models, quick insights. | `renderCEO`. |
| `contacts` [728](../public/index.html#L728) | Name/phone search, add/print; edit/delete; modal name/phone/email/notes. | `loadContacts`, `searchContacts`, `renderContacts`. |
| `analytics` [748](../public/index.html#L748) | 7/30/90/365-day selector, refresh/print; top sellers and stagnating inventory. | `renderAnalytics`. |
| `logs` [772](../public/index.html#L772) | Shop filter, refresh/print; activity feed, load-more cursor pagination. | `loadLogs`. |
| `reports` [794](../public/index.html#L794) | Daily/monthly type, shop, text period (`YYYY-MM-DD` or `YYYY-MM`), generate/refresh; saved report expand, print, delete, CSV in expanded body. | `loadReports`, `renderReports`, `generateReport`. |
| `backup` [823](../public/index.html#L823) | Download JSON; choose `.json` restore file; confirmation before restore. | `doBackup`, `doRestore`. |

These are input panels with button/keydown handlers rather than native `<form>` submission flows. Shared dialogs are `#camModal` (camera) and `#modal-bg > #modal` (generated content). Toast is a live status region. [HTML 852](../public/index.html#L852), [HTML 928](../public/index.html#L928).

### Authentication screen inventory

- Client screen: Client ID + site/gate password, Sign In, Manage Clients. Enter advances from ID to password then submits. [HTML 29](../public/index.html#L29).
- Role screen: admin password/Admin Login plus dynamically generated shop login buttons. [HTML 116](../public/index.html#L116).
- Super-admin screen: password verification; client ID/admin password/gate password; shop-name/color tag queue; save client; client list with pause/resume/delete; local device lock-counter reset UI. [HTML 48](../public/index.html#L48).
- The legacy `checkGate()` function still references `auth-gate`, `auth-gate-input`, and `auth-gate-err`, which are absent from the current HTML. The actual entry path is `checkClientAndGate()`. [CEO 906](../public/js/ceo.js#L906), [Auth 84](../public/js/auth.js#L84).

## Shared state, roles, shops, and persistence

### Global state boundaries

| State group | Owners / consumers |
|---|---|
| API/time/category constants | `BASE`, `today`, `ym`, `CATS`, `EXP_CATS` in globals. `today()` uses UTC ISO slicing, while displayed dates/clock use browser locale formatting. [Globals 4](../public/js/globals.js#L4). |
| Tenant/shop setup | `currentClientId`, `currentClientShops` in auth; `SHOPS`, `SHOP_COLOR`, `SHOP_RGBA`, `activeShop` in globals. `renderDynamicShops()` replaces maps, creates tabs/login buttons, injects shop CSS, and fills eight shop selects. [Auth 81](../public/js/auth.js#L81), [Auth 318](../public/js/auth.js#L318). |
| Auth/device/UI | `ROLE`, `IS_PHONE`, `authRole`, `authShop`, `_pendingGatePassword`, `shopModeActive`, `activePage`, `scanMode`, `pendingIMEI`. [Globals 26](../public/js/globals.js#L26), [Globals 64](../public/js/globals.js#L64). |
| Scanner | `camStream` global; `camMode`, last result, track, loop id, detector/canvas/context/ZXing reader in imei. [IMEI 330](../public/js/imei.js#L330). |
| Inventory UI | `allIMEIStock`, `imeiFilter`, `selectedPhoneIds`; grouping maps/open state in imei; batch queue and product array. [Globals 67](../public/js/globals.js#L67), [IMEI 662](../public/js/imei.js#L662), [IMEI 1230](../public/js/imei.js#L1230). |
| Operations/report caches | `dayState`, `allDays`, `allShopExp`, `allShipments`, `allDispatches`, `hqStock`; CEO/analytics print snapshots and logs; `rcItems`, `allContacts`, `allReports`, `reportBodyCache` in ceo; `allSalesData` in imei. [Globals 66](../public/js/globals.js#L66), [CEO 685](../public/js/ceo.js#L685). |

`allIMEISales` is declared in shared state; the sales log actually uses `allSalesData`. No browser state store, event bus, or reactive framework mediates these arrays. Render functions assign `innerHTML` or construct DOM; mutations explicitly call loaders/renderers/stats refreshes.

### Session and tenant flow

1. Client lookup fetches `/api/clients/lookup?clientId=...`; successful gate authentication POSTs `{type:'gate',password,clientId}`. The client/shop configuration goes into localStorage; the gate password stays in `_pendingGatePassword`. [Auth 84](../public/js/auth.js#L84).
2. Admin authentication POSTs `{type:'admin',password,clientId}`, stores token/role, clears stored auth shop, then boots. Shop authentication POSTs `{type:'shop',password:_pendingGatePassword,shop,clientId}`, stores token/role/shop, then boots. [CEO 930](../public/js/ceo.js#L930), [CEO 956](../public/js/ceo.js#L956).
3. Logout removes token, role, auth shop, client ID, shop configuration, and browser attempt counters, then reloads. [CEO 968](../public/js/ceo.js#L968).
4. API 401 handling clears token/role/auth shop but retains tenant/shop configuration, hides shell, reopens client login, and returns `{}`. [Utils 103](../public/js/utils.js#L103).

| localStorage keys | Usage |
|---|---|
| `authToken`, `authRole`, `authShop` | Persistent authenticated session; role/shop restored at startup and token attached to normal API calls. |
| `clientId`, `clientShops` | Tenant identity plus serialized dynamic shop configuration; restored before login/boot and client header attached to normal API calls. |
| `rl_client`, `rl_gate`, `rl_admin`, `rl_sa` | `{n,until}` local failed-attempt state, cached in `_rlCache`; five failures set a 30-minute deadline. Status/reset is in super-admin UI. [Auth 5](../public/js/auth.js#L5). |

No sessionStorage or offline data queue was found in authored public files. Browser lock counters are a local UI mechanism; server-side rate limiting/authentication must be assessed separately. `currentClientShops` is parsed with unguarded `JSON.parse` in auth and startup, so malformed stored configuration can interrupt initialization; no runtime reproduction was performed.

### Mode behavior

- Device mode is chosen once from `?mode=desktop`, `?mode=phone`, or touch support plus width ≤768. It is independent of authenticated role and is not recalculated on resize. [Globals 26](../public/js/globals.js#L26).
- A phone-mode admin keeps navigation access. Other phone users lose all `ADMIN_ONLY_PAGES`, leaving Scan and IMEI Stock. The banner says “Scan & Add only,” but scan UI includes sell/batch/product modes. [Globals 38](../public/js/globals.js#L38), [UI 6](../public/js/ui.js#L6).
- Authenticated shop mode hides other tabs and Head Office/Tools sections, locks `switchShop()`, and wraps global `nav()` to permit only `scan`/`imeistock`, even on desktop. [CEO 980](../public/js/ceo.js#L980), [UI 36](../public/js/ui.js#L36).
- The frontend hides phone buy price/profit and bulk selection from non-admins in phone-card/sell UI. Individual Edit depends on `!IS_PHONE`; an in-stock Delete button is rendered independently of admin role. Product edit/delete controls also render in product cards. These are visibility rules, not proof of server permission. [IMEI 210](../public/js/imei.js#L210), [IMEI 861](../public/js/imei.js#L861), [IMEI 1263](../public/js/imei.js#L1263).
- Dynamic tabs are built only from configured client shops; no extra HQ tab is appended. Code nevertheless recognizes sentinel `'HQ'`: inventory requests omit shop, daily sheet uses first configured shop, and some filters select All. This is a maintained code path whose normal UI reachability depends on configuration/callers. [Auth 343](../public/js/auth.js#L343), [UI 35](../public/js/ui.js#L35).

## API helper and endpoint coupling

`BASE` uses `https://www.stock-ly.app` whenever the page origin contains `localhost` or `capacitor`; other origins use themselves. This is a material development boundary: opening the local UI can direct reads/writes at production. [Globals 4](../public/js/globals.js#L4).

`api(method,url,body)` sends JSON `Content-Type`, optional bearer token, and optional `X-Client-ID`. It stringifies truthy bodies. Except for special 401 UI handling, it returns parsed response JSON regardless of HTTP status; malformed JSON and fetch errors return `{}`. `_authPost()` posts JSON directly to `/api/auth` and converts network failure to `{ok:false,error:'Connection failed'}`. [Utils 88](../public/js/utils.js#L88).

| API family | Frontend methods and parameters | Main callers |
|---|---|---|
| Tenant/auth | GET `/api/clients/lookup?clientId`; POST `/api/auth` (`gate/admin/shop`) | `checkClientAndGate`, `checkGate`, `checkAdmin`, `enterShopMode`. [Auth 94](../public/js/auth.js#L94), [CEO 913](../public/js/ceo.js#L913). |
| Super-admin | POST `/api/superadmin/verify`; GET/POST `/api/superadmin/clients`; DELETE `/api/superadmin/clients/:clientId` | Raw `fetch`, no normal API helper: verify/save/status/delete put `superAdminPassword` in JSON; listing sends `X-Super-Admin-Password`. [Auth 136](../public/js/auth.js#L136), [Auth 207](../public/js/auth.js#L207). |
| Stats/lookup | GET `/api/stats[?shop]`; GET `/api/lookup/:imei` | Sidebar, add duplicate preview, sell lookup. [UI 101](../public/js/ui.js#L101), [IMEI 163](../public/js/imei.js#L163). |
| Phone inventory | GET `/api/stock?shop&all`; daily also GET `?soldByShop&all=true`; POST `/api/stock/add`; POST `/api/stock/sell`; PUT `/api/stock/:id`; PUT `/api/stock/batch`; DELETE `/api/stock/:id` | IMEI list/add/batch/sell/edit/delete and daily reconciliation. [IMEI 112](../public/js/imei.js#L112), [IMEI 675](../public/js/imei.js#L675), [Daily 38](../public/js/daily.js#L38). |
| Sales | GET/DELETE `/api/sales[?shop]`; DELETE `/api/sales/:id`; DELETE `/api/sales/by-imei/:imei` | Sales log, clear-all, sold-card delete. UI copy says deleting sales returns phones to stock; actual mutation semantics belong to backend. [IMEI 1081](../public/js/imei.js#L1081), [IMEI 1160](../public/js/imei.js#L1160). |
| Products | GET `/api/products[?shop]`; POST `/api/products`; PUT/DELETE `/api/products/:id` | Non-IMEI product add/list/change quantity/delete. [IMEI 1232](../public/js/imei.js#L1232). |
| Day sheets | GET/PUT/DELETE `/api/days/:shop/:date`; GET `/api/days[?shop][?month]` | Daily load/save/history/delete/monthly/print. [Daily 32](../public/js/daily.js#L32), [Daily 221](../public/js/daily.js#L221), [Daily 619](../public/js/daily.js#L619). |
| Shop expenses | GET `/api/shopexpenses[?shop&month]`; POST `/api/shopexpenses`; DELETE `/api/shopexpenses/:key` | Separate expense ledger; monthly combines this with saved sheet expenses. Payload: shop/date/month/category/amount/description; deletion uses `_key`. [Daily 565](../public/js/daily.js#L565). |
| Warehouse | GET `/api/hqstock`; DELETE `/api/hqstock/:imei` | Warehouse cards, fresh dispatch selection. [CEO 5](../public/js/ceo.js#L5), [CEO 199](../public/js/ceo.js#L199), [CEO 268](../public/js/ceo.js#L268). |
| Receiving/dispatch | GET/POST `/api/shipments`; DELETE `/api/shipments/:id`; GET/POST `/api/dispatches`; DELETE `/api/dispatches/:id` | Receipt `{date,supplier,ref,items}`; dispatch `{date,toShop,note,items}`; combined history. [CEO 132](../public/js/ceo.js#L132), [CEO 180](../public/js/ceo.js#L180), [CEO 210](../public/js/ceo.js#L210). |
| Executive/analytics | GET `/api/ceo/summary?month`; GET `/api/analytics/models?days` | Overview and charts/tables rendered from response aggregates. [CEO 284](../public/js/ceo.js#L284), [CEO 497](../public/js/ceo.js#L497). |
| Contacts | GET `/api/customers[?q]`; POST `/api/customers`; PUT/DELETE `/api/customers/:id` | Search debounced 300ms, name/phone/email/notes CRUD. [CEO 397](../public/js/ceo.js#L397), [CEO 472](../public/js/ceo.js#L472). |
| Activity | GET `/api/logs?limit=200[&shop][&before]` | Reset or append feed; cursor uses last `_id` or `ts`; assumes more when page length is exactly 200. [CEO 563](../public/js/ceo.js#L563), [CEO 607](../public/js/ceo.js#L607). |
| Saved reports | GET `/api/reports`; POST `/api/reports/generate` with type/shop/period; DELETE `/api/reports/:id` | Saved snapshots, grouped by shop, lazy cached body, print/CSV. [CEO 688](../public/js/ceo.js#L688), [CEO 851](../public/js/ceo.js#L851). |
| Backup/restore | GET `/api/backup`; POST `/api/restore` with parsed file | Backup uses raw fetch with bearer only, not `X-Client-ID`; downloads Blob/object URL. Restore uses normal helper then reloads on `success`. [CEO 224](../public/js/ceo.js#L224). |

No frontend fetch call to the server settings/password-management endpoints appears in these authored scripts. The super-admin client form is the available browser configuration interface.

## Core workflows

### Single IMEI, batch, inventory, sales, products

- Main input strips non-digits and requires exactly 15 digits. Add mode first looks up duplicates and shows existing/sold phone preview; otherwise it opens the add form. Sell mode rejects unknown/already-sold records and opens sell form. [IMEI 163](../public/js/imei.js#L163).
- Add posts primary/secondary IMEI, category/brand/model/color/storage/buy price/notes/shop. Sell posts IMEI, sale price, buyer name/phone, notes, `soldByShop`; optional cross-shop warning and admin profit preview are computed in the form. Successful sell updates cached record status, refreshes sidebar, and conditionally reloads relevant page. [IMEI 210](../public/js/imei.js#L210), [IMEI 275](../public/js/imei.js#L275), [IMEI 300](../public/js/imei.js#L300).
- Batch queue validates 15-digit IMEI1/optional IMEI2, requires a shared/per-phone color, and prevents duplicate primary/secondary IMEIs across queue entries. Submission posts one phone at a time to the single-add endpoint, shows progress, retains failed entries and a reason list, then clears successful queue state. It is not a transactional batch request. [IMEI 27](../public/js/imei.js#L27), [IMEI 91](../public/js/imei.js#L91).
- Inventory fetch reverses response order, prunes stale selected IDs, then client-filters status/search. Group key is category + lowercase brand + lowercase model; color/storage variants stay in one model group. Group bodies are expanded lazily and open state is cached. Flat cards share `phoneCardHTML`. [IMEI 675](../public/js/imei.js#L675), [IMEI 699](../public/js/imei.js#L699), [IMEI 841](../public/js/imei.js#L841).
- Bulk edit collects selected IDs and sends only nonempty field inputs, with explicit nonnegative buy-price validation. Therefore blank fields mean “leave unchanged,” not “clear field.” Individual edit includes brand/model/color/storage/buy price/IMEI2/notes/category; primary IMEI is not sent in edit payload. [IMEI 955](../public/js/imei.js#L955), [IMEI 1021](../public/js/imei.js#L1021).
- Sales list requests by shop, client-filters date bounds, groups by sold date, and totals revenue/profit. Per-sale delete, delete-by-IMEI and clear-all refresh inventory/sidebar. [IMEI 1081](../public/js/imei.js#L1081), [IMEI 1160](../public/js/imei.js#L1160).
- Products are a separate non-IMEI quantity entity: add can report server-side merge, edit changes quantity, delete removes item. Products do not share the IMEI camera/sale flow. [IMEI 1232](../public/js/imei.js#L1232).

### Camera/barcode pipeline

1. `openCamera(mode)` resets scanner UI, obtains a rear-facing stream, exposes focus/torch capability affordances, attaches it to an autoplay/playsinline/muted video, explicitly calls `play()` for Safari, and chooses native `BarcodeDetector` first or ZXing fallback. [IMEI 347](../public/js/imei.js#L347).
2. `getBestCameraStream()` first requests ideal environment-facing 1280×720 video; after permission it enumerates camera labels, ranks main rear over telephoto/ultrawide/front, optionally replaces the initial stream, and applies continuous autofocus when supported. [IMEI 407](../public/js/imei.js#L407), [camera scoring 443](../public/js/imei.js#L443).
3. `startScanning()` maps the visible object-fit video crop into canvas coordinates and scans the center 80% width ×38% height region. It calls native detect or synchronous ZXing canvas decode, catches decoder failures, and schedules another frame after 66ms while the loop id/current stream remain valid. Startup listens to `playing`/`loadeddata`, plus a two-second fallback. [IMEI 615](../public/js/imei.js#L615).
4. `onBarcodeDetected` strips digits, accepts 14–16 digits outside `free` mode, de-duplicates last result, and routes by `camMode`: `rc1:next`/`rc2:next` to receipt next fields; `rc1:<index>`/`rc2:<index>` to queued receipt entries; `batch1`/`batch` to batch IMEIs; sell-mode `imei1` directly submits lookup; other modes show result/format and selectable IMEI1/IMEI2/copy actions. [IMEI 489](../public/js/imei.js#L489).
5. `useScanResult()` sends IMEI1 through main lookup (or batch field), IMEI2 to add/batch secondary field, or copies to Clipboard API then resumes scan. Main and queue validators still require 15 digits. [IMEI 565](../public/js/imei.js#L565).
6. `toggleTorch` applies track constraints. `triggerFocus` tries single-shot focus then continuous focus. `closeCamera` invalidates loop id, stops tracks, clears state, and hides dialog; Escape also calls it. [IMEI 461](../public/js/imei.js#L461), [IMEI 587](../public/js/imei.js#L587), [Utils 66](../public/js/utils.js#L66).

Browser/device success, secure-context camera permissions, camera-label accuracy, torch/autofocus support, native detector format support, and mobile print/download behavior remain untested. Error copy mentions HTTPS; that copy does not distinguish every camera failure cause.

### Daily accounting and report data boundaries

`loadDay()` always fetches saved sheet + current own-shop stock including sold records + cross-shop records sold by this shop. It preserves saved non-stock fields/EXTRA rows but rebuilds all non-EXTRA category rows from current IMEI stock, grouping by category/name/storage. Opening count is current in-stock count + selected-date sales attributed to the shop; IN resets to zero; OUT is selected-date sales. A group uses the first encountered phone buy price as `costPerUnit`. [Daily 32](../public/js/daily.js#L32).

This means opening an old sheet is a live reconciliation view, not a faithful replay of its previously saved non-EXTRA rows. Derived profit can differ from per-sale profit when a model/storage group contains phones with different costs. Those are source-derived implications, not measured discrepancies.

`renderStock()` shows read-only computed stock cells and editable EXTRA descriptions/bought/sold values. Daily expenses, purchases and transfers are separate description/amount arrays on `dayState`. They are distinct from the `/api/shopexpenses` ledger. [Daily 113](../public/js/daily.js#L113), [Daily 187](../public/js/daily.js#L187).

`recalc()` computes:

```text
sales = sum(row.soldFor)
cost = sum(non-EXTRA costPerUnit × out) + sum(EXTRA boughtFor)
subtotal = sales − dailyExpenses − purchases − transfers
cashOnHand = subtotal + carryForward
netPL = sales − cost − dailyExpenses
stockValue = sum((op + inQty − out) × costPerUnit), excluding EXTRA
```

Purchases and transfers reduce cash, not the displayed net P/L. Saving PUTs the whole sheet to `/api/days/:shop/:date`. New Day builds state, selects shop/date, loads reconciled stock, then sets carry-forward; it does not itself save the sheet. [Daily 197](../public/js/daily.js#L197), [Daily 221](../public/js/daily.js#L221), [Daily 544](../public/js/daily.js#L544).

History and monthly UI read saved day documents. Monthly combines day-sheet sales/costs/expenses with separate shop expenses and computes gross minus total expenses per shop; unsaved sheet edits are absent. CEO uses `/api/ceo/summary` aggregates instead. Saved reports use server-generated snapshots in `r.data`; they are not produced by reusing `dayState`. [Daily 619](../public/js/daily.js#L619), [Daily 691](../public/js/daily.js#L691), [CEO 284](../public/js/ceo.js#L284), [CEO 734](../public/js/ceo.js#L734).

Reports show total sales/cost/gross profit/expenses/net/units; daily detail uses `salesList`, monthly detail uses `expenseBreakdown`. Reports are grouped by shop, use `_id`, and lazily cache rendered bodies until reload/deletion. [CEO 695](../public/js/ceo.js#L695), [CEO 834](../public/js/ceo.js#L834).

### Warehouse, executive views, contacts, logs, exports

- Receipt queue uses shared phone metadata plus per-entry IMEI1/IMEI2/color; add validates lengths and duplicate IMEIs; save posts the queue as shipment items. Dispatch freshly fetches HQ stock when opened from shipments, selects phones, and sends them to a configured shop. Shipment history merges inbound and dispatch arrays and shows server `soldPhones` sell-through. [CEO 20](../public/js/ceo.js#L20), [CEO 79](../public/js/ceo.js#L79), [CEO 132](../public/js/ceo.js#L132), [CEO 199](../public/js/ceo.js#L199).
- CEO uses `current`, `prev`, `shopStats`, `topModels`, `inventoryCount`, and `inventoryValue`; frontend computes month-over-month percent and best shop. Analytics uses `topSold` and `stagnating`, with proportional CSS bars, model cost/age/shop labels. [CEO 284](../public/js/ceo.js#L284), [CEO 497](../public/js/ceo.js#L497).
- Contact search is server-side and debounced; contact cards and edit/add modals use customer data. Activity labels cover stock_add/stock_sell/stock_delete; unknown actions fall back to action text. Logs append pages without re-rendering prior rows. [CEO 405](../public/js/ceo.js#L405), [CEO 557](../public/js/ceo.js#L557).
- `printSection()` writes standalone styled HTML into a hidden same-page iframe, waits 500ms, calls native print, and removes iframe after two seconds. Print/PDF is browser printing, not a server PDF service. Daily module builds printable day, sales, shipments, inventory, expenses, history, warehouse, monthly, CEO, contacts, analytics and logs; report printing is in ceo. [CEO 642](../public/js/ceo.js#L642), [Daily 250](../public/js/daily.js#L250).
- CSV export creates a `data:text/csv` anchor and programmatically clicks it. Some export builders directly concatenate fields with commas, so CSV quoting/formula behavior is not normalized centrally. [CEO 875](../public/js/ceo.js#L875), [CEO 902](../public/js/ceo.js#L902), [Daily 236](../public/js/daily.js#L236).
- Backup uses Blob/object URL/download, then revokes URL. Restore parses user-selected JSON and posts it only after confirmation, then reloads on `success`; no frontend schema migration/version validation occurs in this function. [CEO 224](../public/js/ceo.js#L224).

## Complete authored function navigation index

Groups list each named top-level function and its source entry location. Nested callback functions and browser/vendor APIs are described in their owning workflow above.

| File | Functions by concern |
|---|---|
| `globals.js` | [7](../public/js/globals.js#L7): `today`, `ym`; [26](../public/js/globals.js#L26): `getRole`; [38](../public/js/globals.js#L38): `applyPhoneMode`. |
| `keyboard.js` | [12](../public/js/keyboard.js#L12): immediate `initKeyboardHandler`; nested `onViewportResize` at 20; resize/scroll/focusout listeners. |
| `utils.js` | [4](../public/js/utils.js#L4): `$`, `toggleSidebar`, `closeSidebar`; [17](../public/js/utils.js#L17): `showModal`, `confirmModal`, `_resolveConfirm`, `closeModal`; [82](../public/js/utils.js#L82): `pkr`, `fmtDate`, `esc`, `titleCase`, `fmtPhoneName`, `showToast`; [88](../public/js/utils.js#L88): `_authPost`, `api`; [127](../public/js/utils.js#L127): `tickClock`. |
| `ui.js` | [4](../public/js/ui.js#L4): `nav`; [35](../public/js/ui.js#L35): `switchShop`; [101](../public/js/ui.js#L101): `loadSidebarStats`. |
| `app.js` | [5](../public/js/app.js#L5): `bootApp`; [23](../public/js/app.js#L23): anonymous async startup IIFE. |
| `auth.js`: locks/session | [10](../public/js/auth.js#L10): `_rlGet`, `_rlFail`, `_rlClear`, `_rlLocked`, `_rlTimeLeft`, `_rlRemaining`, `_rlLockedMsg`, `_rlErrMsg`; [48](../public/js/auth.js#L48): `renderLockStatus`, `resetLock`; [84](../public/js/auth.js#L84): `checkClientAndGate`. |
| `auth.js`: management | [128](../public/js/auth.js#L128): `verifySuperAdmin`, `showSuperAdmin`, `hideSuperAdmin`; [177](../public/js/auth.js#L177): `addShopTag`, `removeShopTag`, `renderShopTags`; [207](../public/js/auth.js#L207): `saveClient`, `loadClientsList`, `toggleClientStatus`, `deleteClient`; [318](../public/js/auth.js#L318): `renderDynamicShops`, `updateShopBadges`. |
| `imei.js`: intake/sales | [5](../public/js/imei.js#L5): `setMode`; [27](../public/js/imei.js#L27): `addToBatchQueue`, `renderBatchQueue`, `removeBatchEntry`, `clearBatchQueue`, `submitBatch`; [163](../public/js/imei.js#L163): `handleImeiSubmit`, `showAddForm`, `showSellForm`, `cancelForm`, `showPreview`, `hidePreview`, `submitAdd`, `submitSell`. |
| `imei.js`: scanner | [347](../public/js/imei.js#L347): `openCamera`, `openCameraForImei2`, `getBestCameraStream`, `pickBestRearCamera`, `closeCamera`, `clearScanResult`, `flashField`, `onBarcodeDetected`, `useScanResult`, `toggleTorch`, `triggerFocus`, `startScanning`. |
| `imei.js`: inventory | [667](../public/js/imei.js#L667): `expandAllGroups`, `collapseAllGroups`, `loadIMEIData`, `setIMEIFilter`, `toggleGrouped`, `renderIMEIStock`; [792](../public/js/imei.js#L792): `updateBulkActions`, `togglePhoneSelection`, `clearPhoneSelection`, `getSelectedPhones`, `openGroupBatchEdit`, `toggleGroup`, `phoneCardHTML`; [897](../public/js/imei.js#L897): `openEditPhone`, `saveEditPhone`, `openBatchEditModal`, `saveBatchEdit`, `deletePhone`, `exportIMEICSV`. |
| `imei.js`: sales/products | [1081](../public/js/imei.js#L1081): `loadSalesLog`, `renderSalesLog`, `toggleDateGroup`, `deleteSale`, `deleteSaleByIMEI`, `exportSalesLogCSV`, `clearAllSales`; [1232](../public/js/imei.js#L1232): `submitProduct`, `loadProducts`, `renderProducts`, `editProductQty`, `saveProductQty`, `deleteProduct`, `updateSearchClearBtn`, `clearIMEISearch`. |
| `daily.js`: sheet | [5](../public/js/daily.js#L5): `makeEmptyDay`, `guessCat`, `autoSelectCat`, `autoBrandFromCat`, `loadDay`, `renderStock`, `onRC`, `updateCatTotals`, `addRow`, `removeRow`; [187](../public/js/daily.js#L187): `renderExpenses`, `addExp`, `delExp`, `renderPurchases`, `addPurchase`, `delPurchase`, `renderTransfers`, `addTransfer`, `delTransfer`, `recalc`, `saveDay`, `exportDayCSV`. |
| `daily.js`: print | [250](../public/js/daily.js#L250): `printDaySheet`, `printSalesLog`, `printShipments`, `printIMEIStock`, `printExpenses`, `printHistory`, `printWarehouse`, `printMonthly`, `printCEO`, `printContacts`, `printAnalytics`, `printLogs`. |
| `daily.js`: day/expense/history/monthly | [544](../public/js/daily.js#L544): `openNewDayModal`, `startNewDay`, `renderShopExpenses`, `deleteShopExp`, `openAddExpenseModal`, `saveShopExp`; [619](../public/js/daily.js#L619): `loadAllDays`, `renderHistory`, `toggleHistCard`, `loadHistDay`, `deleteHistDay`, `renderMonthly`. |
| `ceo.js`: warehouse | [5](../public/js/ceo.js#L5): `loadWarehouse`, `renderWarehouse`, `openReceiveModal`, `addToReceiveQueue`, `renderRCItems`, `removeReceiveQueueItem`, `clearReceiveQueue`, `saveReceive`; [168](../public/js/ceo.js#L168): `openDispatchModal`, `saveDispatch`, `openDispatchFromShipments`, `loadShipments`, `renderShipments`; [224](../public/js/ceo.js#L224): `doBackup`, `doRestore`, `deleteShipmentRecord`, `deleteWarehouseImei`. |
| `ceo.js`: overview/contacts/analytics | [284](../public/js/ceo.js#L284): `renderCEO`; [397](../public/js/ceo.js#L397): `loadContacts`, `searchContacts`, `renderContacts`, `openAddContactModal`, `openEditContactModal`, `saveContact`, `deleteContact`; [497](../public/js/ceo.js#L497): `renderAnalytics`. |
| `ceo.js`: logs/reports/export | [567](../public/js/ceo.js#L567): `_buildLogDetail`, `_logRowHtml`, `_renderLogsLoadMore`, `loadLogs`, `printSection`; [688](../public/js/ceo.js#L688): `loadReports`, `renderReports`, `renderReportData`, `printReport`, `toggleReportBody`, `generateReport`, `deleteReport`, `exportReportCSV`, `dlCSV`. |
| `ceo.js`: role auth | [906](../public/js/ceo.js#L906): `checkGate`, `checkAdmin`, `enterShopMode`, `logout`, `applyShopMode`. |

## CSS, accessibility, PWA, and device boundaries

CSS starts with light neutral surfaces, green accent, status colors, shop-color placeholders, DM Sans/Mono families, radius and keyboard-height variables. The misleading `--white` token contains dark foreground `#1c1917` for the light theme. HTML and body are fixed-height, overflow-hidden; body is a column flex container and shrinks by `--keyboard-height`. Individual page/stock/table containers own scrolling. [CSS 1](../public/css/app.css#L1), [CSS 37](../public/css/app.css#L37).

| CSS section | Source entry |
|---|---|
| Shell: topbar, sidebar, main, toolbars | [63](../public/css/app.css#L63), [179](../public/css/app.css#L179), [305](../public/css/app.css#L305). |
| Buttons, date inputs, stock tables, bottom panels | [370](../public/css/app.css#L370), [456](../public/css/app.css#L456), [473](../public/css/app.css#L473), [686](../public/css/app.css#L686). |
| Scan panel, phone cards, preview, forms, filters | [898](../public/css/app.css#L898), [981](../public/css/app.css#L981), [1169](../public/css/app.css#L1169), [1183](../public/css/app.css#L1183), [1318](../public/css/app.css#L1318). |
| Empty/modal/camera/toast | [1395](../public/css/app.css#L1395), [1419](../public/css/app.css#L1419), [1518](../public/css/app.css#L1518), [1560](../public/css/app.css#L1560). |
| Monthly/warehouse/shipments, scrollbars | [1598](../public/css/app.css#L1598), [1644](../public/css/app.css#L1644), [1738](../public/css/app.css#L1738), [1759](../public/css/app.css#L1759). |
| CEO, contacts, analytics, logs, reports | [1778](../public/css/app.css#L1778), [1962](../public/css/app.css#L1962), [1995](../public/css/app.css#L1995), [2097](../public/css/app.css#L2097), [2163](../public/css/app.css#L2163). |
| Mobile, auth, reduced motion/skip link, confirmation dialog, search clear | [2241](../public/css/app.css#L2241), [2387](../public/css/app.css#L2387), [2569](../public/css/app.css#L2569), [2598](../public/css/app.css#L2598), [2674](../public/css/app.css#L2674). |

Responsive rules use 700px (analytics), 600px (warehouse/sidebar/toolbar), 480px (forms/mobile shell), and 400px (small auth) breakpoints. At ≤600px the sidebar becomes a fixed off-canvas drawer with backdrop/hamburger. At ≤480px the clock hides, stock tables scroll horizontally with a minimum width, cards use two columns, forms become one column, controls use larger touch dimensions/16px text to avoid iOS input zoom, and analytics become one column. Safe-area insets protect topbar/main/sidebar/auth; auth max-height uses `100dvh`. CSS responsive widths and JS phone-mode width (768px) are separate mechanisms. [CSS 2003](../public/css/app.css#L2003), [CSS 2275](../public/css/app.css#L2275), [CSS 2316](../public/css/app.css#L2316), [CSS 2413](../public/css/app.css#L2413).

`keyboard.js` runs whenever `window.visualViewport` exists, although its comment describes Capacitor-only use. It listens to viewport resize/scroll, computes `innerHeight - visualViewport.height`, updates CSS, scrolls focused controls into a nearby scrollable container, and resets height after focusout when input focus leaves. There is no actual Capacitor runtime guard in this file. [Keyboard 12](../public/js/keyboard.js#L12).

Accessibility provisions verified in source: skip link; sidebar items with `role="button"` and `tabindex`; global Enter/Space activation for role-button elements; Escape closes camera/modal/preview; camera/generic dialog roles; toast `role="status"`/`aria-live="polite"`; reduced-motion CSS disables scan animation and shortens transitions. [HTML 23](../public/index.html#L23), [HTML 158](../public/index.html#L158), [Utils 65](../public/js/utils.js#L65), [CSS 2569](../public/css/app.css#L2569).

Source limitations, not an accessibility audit: generated shop tabs are clickable divs without the sidebar's role/tabindex setup; generic modal code replaces HTML and toggles a class without focus trap/restoration; some inputs use standalone labels without associations and many rules remove outlines. Keyboard/screen-reader behavior and contrast were not exercised. [Auth 351](../public/js/auth.js#L351), [Utils 17](../public/js/utils.js#L17), [HTML 276](../public/index.html#L276).

Manifest declares root start URL, standalone display, portrait-primary orientation, theme/background colors, and one SVG icon with `any maskable` purpose. HTML has mobile/app-capable and viewport-fit metadata. No service-worker registration or service-worker file exists under `public/`; manifest metadata alone does not establish offline operation. No native Capacitor API calls appear in authored browser scripts. [Manifest 1](../public/manifest.json#L1), [HTML 5](../public/index.html#L5).

External frontend dependencies are Google Fonts, browser APIs (fetch/storage/media/viewport/clipboard/download/print), and ZXing fallback. Normal deployed API calls use the current origin; localhost/Capacitor target the configured production origin. No charting framework is needed: executive/analytics visuals are HTML/CSS.

## Integration cautions identified during mapping

These are static observations with likely behavior derived from control flow, not browser test results or an exhaustive defect/security audit.

1. **Confirmation resolution cancels before acceptance.** `_resolveConfirm(val)` calls `closeModal()` first; `closeModal()` clears the resolver and resolves it with `false`. The later attempt to resolve `val` cannot run. Therefore consumers awaiting `confirmModal()` appear to receive false even after Confirm. This affects delete, clear-sales, restore and client-status flows. [Utils 45](../public/js/utils.js#L45), [Utils 54](../public/js/utils.js#L54).
2. **Transport failures can look like successful empty responses.** `api()` catches fetch/JSON failures and returns `{}`; callers such as saveDay/saveShopExp and batch intake often rely on thrown errors or `d.error`, so success messages can occur without a confirmed successful response. Sidebar stats also marks online after an empty object because its catch does not receive helper failures. [Utils 94](../public/js/utils.js#L94), [Daily 221](../public/js/daily.js#L221), [Daily 611](../public/js/daily.js#L611), [IMEI 112](../public/js/imei.js#L112), [UI 101](../public/js/ui.js#L101).
3. **Status chips filter the existing fetch.** Initial inventory fetch uses `all=false` while filter is in_stock; `setIMEIFilter` changes the flag and renders without fetching. If the server omits sold stock on that request, sold/all chips cannot show it until another load occurs. [IMEI 675](../public/js/imei.js#L675), [IMEI 696](../public/js/imei.js#L696).
4. **Inventory render cache is coarse.** `_stateKey` considers count/view/filter/first+last IDs, not search text, selected state, or record content. Changes with identical endpoints/count can skip rendering unless a forced render/other key change occurs. [IMEI 715](../public/js/imei.js#L715).
5. **Daily historical data is partly reconstructed live.** Non-EXTRA saved stock rows are replaced using current stock; first-grouped cost is reused. Keep this distinction explicit when comparing history/monthly to CEO/report/sales totals. [Daily 87](../public/js/daily.js#L87).
6. **Auth/UI reset is partial on expiry.** 401 clears auth globals/storage and hides shell, but does not reset `shopModeActive` or restore wrapped global nav/hidden DOM sections. A full logout reload resets everything; a same-page role change after expiry may retain old UI restrictions. [Utils 103](../public/js/utils.js#L103), [CEO 980](../public/js/ceo.js#L980).

Remaining verification boundaries: actual endpoint response shapes/permission enforcement, persisted tenant isolation, historical accounting correctness, production deployment headers/caching, camera support on physical devices, native printing/downloading, installability, accessibility, and real network failures require controlled runtime work outside this source map.
