# Stock-ly: complete tracked-file and symbol index

Generated from the current tracked file list and source declarations. The companion JSON is the machine-readable source. No secrets or IDE cache contents were read.

## Scope

- Baseline commit: `38e4110fddabbe9b2344c7b780b09353016f3902`.
- 132 tracked files; 30 authored JavaScript files; 52 route declarations.
- Named function declarations are indexed below; anonymous callbacks, arrow functions, and generated vendor symbols are not counted as named functions.
- Android resources, IDE files, certificates, wrapper binaries and release metadata are inventoried by path/size only.
- New mapping docs and Serena files are not part of the original tracked-file baseline.

## Source files and named functions

### `create-client.js`

39 lines. Dependencies: `dotenv`, `mongoose`, `crypto`.

| Function | Source line |
|---|---|
| `run` | 13 |

### `db/index.js`

247 lines. Dependencies: `mongoose`, `bcrypt`.

| Function | Source line |
|---|---|
| `connectMongo` | 22 |
| `getTenantDb` | 218 |

### `middleware/auth.js`

156 lines. Dependencies: `crypto`, `express-rate-limit`, `../db`.

| Function | Source line |
|---|---|
| `generateToken` | 25 |
| `createSession` | 29 |
| `getSession` | 35 |
| `deleteSession` | 41 |
| `safeCompare` | 46 |
| `requireAuth` | 59 |
| `logAction` | 77 |
| `tenantMiddleware` | 105 |

### `migrate-anas.js`

104 lines. Dependencies: `mongoose`, `dns`.

| Function | Source line |
|---|---|
| `run` | 22 |
| `copyData` | 74 |

### `migrate-phase1.js`

248 lines. Dependencies: `mongoose`.

| Function | Source line |
|---|---|
| `makeModel` | 76 |
| `run` | 82 |

### `public/js/app.js`

52 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `bootApp` | 5 |

### `public/js/auth.js`

407 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `_rlGet` | 10 |
| `_rlFail` | 23 |
| `_rlClear` | 31 |
| `_rlLocked` | 32 |
| `_rlTimeLeft` | 33 |
| `_rlRemaining` | 34 |
| `_rlLockedMsg` | 35 |
| `_rlErrMsg` | 39 |
| `renderLockStatus` | 48 |
| `resetLock` | 73 |
| `checkClientAndGate` | 84 |
| `verifySuperAdmin` | 128 |
| `showSuperAdmin` | 159 |
| `hideSuperAdmin` | 169 |
| `addShopTag` | 177 |
| `removeShopTag` | 190 |
| `renderShopTags` | 195 |
| `saveClient` | 207 |
| `loadClientsList` | 238 |
| `toggleClientStatus` | 272 |
| `deleteClient` | 296 |
| `renderDynamicShops` | 318 |
| `updateShopBadges` | 392 |

### `public/js/ceo.js`

1009 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `loadWarehouse` | 5 |
| `renderWarehouse` | 6 |
| `openReceiveModal` | 20 |
| `addToReceiveQueue` | 79 |
| `renderRCItems` | 108 |
| `removeReceiveQueueItem` | 130 |
| `clearReceiveQueue` | 131 |
| `saveReceive` | 132 |
| `openDispatchModal` | 168 |
| `saveDispatch` | 180 |
| `openDispatchFromShipments` | 199 |
| `loadShipments` | 210 |
| `renderShipments` | 211 |
| `doBackup` | 224 |
| `doRestore` | 240 |
| `deleteShipmentRecord` | 252 |
| `deleteWarehouseImei` | 268 |
| `renderCEO` | 284 |
| `momTag` | 295 |
| `sign` | 300 |
| `loadContacts` | 397 |
| `searchContacts` | 405 |
| `renderContacts` | 410 |
| `openAddContactModal` | 436 |
| `openEditContactModal` | 450 |
| `saveContact` | 472 |
| `deleteContact` | 482 |
| `renderAnalytics` | 497 |
| `_buildLogDetail` | 567 |
| `_logRowHtml` | 575 |
| `_renderLogsLoadMore` | 592 |
| `loadLogs` | 607 |
| `printSection` | 642 |
| `loadReports` | 688 |
| `renderReports` | 695 |
| `renderReportData` | 734 |
| `printReport` | 792 |
| `toggleReportBody` | 834 |
| `generateReport` | 851 |
| `deleteReport` | 860 |
| `exportReportCSV` | 875 |
| `dlCSV` | 902 |
| `checkGate` | 906 |
| `checkAdmin` | 930 |
| `enterShopMode` | 956 |
| `logout` | 968 |
| `applyShopMode` | 980 |

### `public/js/daily.js`

712 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `makeEmptyDay` | 5 |
| `guessCat` | 8 |
| `autoSelectCat` | 17 |
| `autoBrandFromCat` | 25 |
| `loadDay` | 32 |
| `renderStock` | 113 |
| `onRC` | 162 |
| `updateCatTotals` | 176 |
| `addRow` | 184 |
| `removeRow` | 185 |
| `renderExpenses` | 187 |
| `addExp` | 188 |
| `delExp` | 189 |
| `renderPurchases` | 190 |
| `addPurchase` | 191 |
| `delPurchase` | 192 |
| `renderTransfers` | 193 |
| `addTransfer` | 194 |
| `delTransfer` | 195 |
| `recalc` | 197 |
| `saveDay` | 221 |
| `exportDayCSV` | 236 |
| `printDaySheet` | 250 |
| `printSalesLog` | 273 |
| `printShipments` | 301 |
| `printIMEIStock` | 308 |
| `printExpenses` | 339 |
| `printHistory` | 364 |
| `printWarehouse` | 386 |
| `printMonthly` | 413 |
| `printCEO` | 445 |
| `printContacts` | 482 |
| `printAnalytics` | 500 |
| `printLogs` | 520 |
| `openNewDayModal` | 544 |
| `startNewDay` | 556 |
| `renderShopExpenses` | 565 |
| `deleteShopExp` | 594 |
| `openAddExpenseModal` | 595 |
| `saveShopExp` | 611 |
| `loadAllDays` | 619 |
| `renderHistory` | 624 |
| `toggleHistCard` | 662 |
| `loadHistDay` | 670 |
| `deleteHistDay` | 671 |
| `renderMonthly` | 691 |

### `public/js/globals.js`

76 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `today` | 7 |
| `ym` | 8 |
| `getRole` | 26 |
| `applyPhoneMode` | 38 |

### `public/js/imei.js`

1335 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `setMode` | 5 |
| `addToBatchQueue` | 27 |
| `renderBatchQueue` | 54 |
| `removeBatchEntry` | 81 |
| `clearBatchQueue` | 86 |
| `submitBatch` | 91 |
| `handleImeiSubmit` | 163 |
| `showAddForm` | 201 |
| `showSellForm` | 210 |
| `updateCrossShopWarning` | 231 |
| `cancelForm` | 262 |
| `showPreview` | 272 |
| `hidePreview` | 273 |
| `submitAdd` | 275 |
| `submitSell` | 300 |
| `openCamera` | 347 |
| `openCameraForImei2` | 401 |
| `getBestCameraStream` | 407 |
| `pickBestRearCamera` | 443 |
| `score` | 444 |
| `closeCamera` | 461 |
| `clearScanResult` | 473 |
| `flashField` | 482 |
| `onBarcodeDetected` | 489 |
| `useScanResult` | 565 |
| `toggleTorch` | 587 |
| `triggerFocus` | 596 |
| `startScanning` | 615 |
| `expandAllGroups` | 667 |
| `collapseAllGroups` | 671 |
| `loadIMEIData` | 675 |
| `setIMEIFilter` | 696 |
| `toggleGrouped` | 697 |
| `renderIMEIStock` | 699 |
| `updateBulkActions` | 792 |
| `togglePhoneSelection` | 802 |
| `clearPhoneSelection` | 809 |
| `getSelectedPhones` | 825 |
| `openGroupBatchEdit` | 830 |
| `toggleGroup` | 841 |
| `phoneCardHTML` | 861 |
| `openEditPhone` | 897 |
| `saveEditPhone` | 955 |
| `openBatchEditModal` | 973 |
| `saveBatchEdit` | 1021 |
| `deletePhone` | 1047 |
| `exportIMEICSV` | 1072 |
| `loadSalesLog` | 1081 |
| `renderSalesLog` | 1089 |
| `toggleDateGroup` | 1153 |
| `deleteSale` | 1160 |
| `deleteSaleByIMEI` | 1177 |
| `exportSalesLogCSV` | 1194 |
| `clearAllSales` | 1209 |
| `submitProduct` | 1232 |
| `loadProducts` | 1255 |
| `renderProducts` | 1263 |
| `editProductQty` | 1287 |
| `saveProductQty` | 1296 |
| `deleteProduct` | 1305 |
| `updateSearchClearBtn` | 1319 |
| `clearIMEISearch` | 1326 |

### `public/js/keyboard.js`

71 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `initKeyboardHandler` | 12 |
| `onViewportResize` | 20 |

### `public/js/ui.js`

114 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `nav` | 4 |
| `switchShop` | 35 |
| `loadSidebarStats` | 101 |

### `public/js/utils.js`

129 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `$` | 4 |
| `toggleSidebar` | 5 |
| `closeSidebar` | 13 |
| `showModal` | 17 |
| `confirmModal` | 26 |
| `_resolveConfirm` | 45 |
| `closeModal` | 54 |
| `pkr` | 82 |
| `fmtDate` | 83 |
| `esc` | 84 |
| `titleCase` | 85 |
| `fmtPhoneName` | 86 |
| `showToast` | 87 |
| `_authPost` | 88 |
| `api` | 94 |
| `tickClock` | 127 |

### `routes/analytics.js`

135 lines. Dependencies: `express`, `../middleware/auth`, `../utils/helpers`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/analytics/models` | 9 |
| GET | `/ceo/summary` | 54 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/backup.js`

124 lines. Dependencies: `express`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/backup` | 8 |
| POST | `/restore` | 37 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/clients.js`

179 lines. Dependencies: `express`, `../db`, `../middleware/auth`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/clients/lookup` | 9 |
| POST | `/auth` | 24 |
| PUT | `/auth/password` | 85 |
| POST | `/superadmin/verify` | 112 |
| POST | `/superadmin/clients` | 121 |
| GET | `/superadmin/clients` | 147 |
| DELETE | `/superadmin/clients/:clientId` | 161 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/customers.js`

69 lines. Dependencies: `express`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/customers` | 8 |
| POST | `/customers` | 25 |
| PUT | `/customers/:id` | 38 |
| DELETE | `/customers/:id` | 59 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/days.js`

68 lines. Dependencies: `express`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/days` | 8 |
| GET | `/days/:shop/:date` | 25 |
| PUT | `/days/:shop/:date` | 35 |
| DELETE | `/days/:shop/:date` | 57 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/expenses.js`

53 lines. Dependencies: `express`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/shopexpenses` | 8 |
| POST | `/shopexpenses` | 22 |
| DELETE | `/shopexpenses/:id` | 43 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/logs.js`

46 lines. Dependencies: `express`, `mongoose`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/logs` | 9 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/products.js`

88 lines. Dependencies: `express`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/products` | 8 |
| POST | `/products` | 21 |
| PUT | `/products/:id` | 59 |
| DELETE | `/products/:id` | 77 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/reports.js`

107 lines. Dependencies: `express`, `../middleware/auth`, `../utils/helpers`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/reports` | 9 |
| POST | `/reports/generate` | 23 |
| DELETE | `/reports/:id` | 97 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/sales.js`

76 lines. Dependencies: `express`, `../middleware/auth`, `../utils/helpers`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/sales` | 9 |
| DELETE | `/sales` | 17 |
| DELETE | `/sales/by-imei/:imei` | 40 |
| DELETE | `/sales/:id` | 58 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/stock.js`

284 lines. Dependencies: `express`, `../db`, `../middleware/auth`, `../utils/helpers`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/lookup/:imei` | 10 |
| GET | `/stock` | 22 |
| POST | `/stock/add` | 46 |
| POST | `/stock/sell` | 83 |
| GET | `/stats` | 176 |
| PUT | `/stock/batch` | 196 |
| PUT | `/stock/:id` | 245 |
| DELETE | `/stock/:id` | 259 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `routes/warehouse.js`

282 lines. Dependencies: `express`, `../middleware/auth`.

| Method | Path declared in router | Source line |
|---|---|---|
| GET | `/hqstock` | 9 |
| PUT | `/hqstock` | 19 |
| DELETE | `/hqstock/:imei` | 35 |
| DELETE | `/hqstock/at/:index` | 65 |
| POST | `/shipments` | 85 |
| GET | `/shipments` | 147 |
| DELETE | `/shipments/:id` | 157 |
| POST | `/dispatches` | 167 |
| GET | `/dispatches` | 239 |
| DELETE | `/dispatches/:id` | 272 |
All route paths are mounted under `/api` by `server.js`. See the backend map for access checks and mutation effects.

### `scratch/check_clients.js`

27 lines. Dependencies: `dotenv`, `mongoose`.

| Function | Source line |
|---|---|
| `check` | 12 |

### `scratch/migrate_passwords.js`

66 lines. Dependencies: `mongoose`, `bcrypt`, `dotenv`.

| Function | Source line |
|---|---|
| `migrate` | 16 |

### `server.js`

115 lines. Dependencies: `dotenv`, `express`, `cors`, `express-rate-limit`, `helmet`, `./db`, `./middleware/auth`, `./routes/clients`, `./routes/stock`, `./routes/sales`, `./routes/days`, `./routes/expenses`, `./routes/warehouse`, `./routes/customers`, `./routes/logs`, `./routes/analytics`, `./routes/reports`, `./routes/backup`, `./routes/products`.

### `utils/helpers.js`

20 lines. Dependencies: none via CommonJS `require`.

| Function | Source line |
|---|---|
| `buildSalesByShopQuery` | 8 |

## Every tracked file

| Path | Bytes |
|---|---|
| `.gitignore` | 88 |
| `.idea/.gitignore` | 50 |
| `.idea/caches/deviceStreaming.xml` | 81374 |
| `.idea/deviceManager.xml` | 363 |
| `.idea/imeiapp.iml` | 344 |
| `.idea/markdown.xml` | 314 |
| `.idea/misc.xml` | 149 |
| `.idea/modules.xml` | 273 |
| `.idea/vcs.xml` | 172 |
| `.vs/IMEI-STOCK-APP.slnx/copilot-chat/9c4601ed/sessions/b0752c0a-e075-4601-ad71-a1d86bf54c78` | 169715 |
| `.vs/IMEI-STOCK-APP.slnx/v18/.wsuo` | 27136 |
| `.vs/IMEI-STOCK-APP.slnx/v18/DocumentLayout.backup.json` | 3687 |
| `.vs/IMEI-STOCK-APP.slnx/v18/DocumentLayout.json` | 3687 |
| `.vs/IMEI-STOCK-APP/CopilotIndices/18.0.988.22099/CodeChunks.db` | 69632 |
| `.vs/IMEI-STOCK-APP/CopilotIndices/18.0.988.22099/CodeChunks.db-shm` | 32768 |
| `.vs/IMEI-STOCK-APP/CopilotIndices/18.0.988.22099/CodeChunks.db-wal` | 309032 |
| `.vs/IMEI-STOCK-APP/CopilotIndices/18.0.988.22099/SemanticSymbols.db` | 49152 |
| `.vs/IMEI-STOCK-APP/CopilotIndices/18.0.988.22099/SemanticSymbols.db-shm` | 32768 |
| `.vs/IMEI-STOCK-APP/CopilotIndices/18.0.988.22099/SemanticSymbols.db-wal` | 94792 |
| `.vs/VSWorkspaceState.json` | 78 |
| `.vs/slnx.sqlite` | 90112 |
| `Procfile` | 21 |
| `README.md` | 5370 |
| `STRUCTURE.md` | 13995 |
| `android/.gitignore` | 1925 |
| `android/.idea/.gitignore` | 50 |
| `android/.idea/AndroidProjectSystem.xml` | 217 |
| `android/.idea/compiler.xml` | 174 |
| `android/.idea/deploymentTargetSelector.xml` | 339 |
| `android/.idea/deviceManager.xml` | 363 |
| `android/.idea/migrations.xml` | 263 |
| `android/.idea/misc.xml` | 417 |
| `android/.idea/planningMode.xml` | 391 |
| `android/.idea/runConfigurations.xml` | 980 |
| `android/app/.gitignore` | 28 |
| `android/app/build.gradle` | 2097 |
| `android/app/capacitor.build.gradle` | 389 |
| `android/app/proguard-rules.pro` | 772 |
| `android/app/release/baselineProfiles/0/app-release.dm` | 3073 |
| `android/app/release/baselineProfiles/1/app-release.dm` | 3012 |
| `android/app/release/output-metadata.json` | 743 |
| `android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java` | 783 |
| `android/app/src/main/AndroidManifest.xml` | 1861 |
| `android/app/src/main/java/app/stockly/android/MainActivity.java` | 128 |
| `android/app/src/main/res/drawable-land-hdpi/splash.png` | 7705 |
| `android/app/src/main/res/drawable-land-mdpi/splash.png` | 4040 |
| `android/app/src/main/res/drawable-land-xhdpi/splash.png` | 9251 |
| `android/app/src/main/res/drawable-land-xxhdpi/splash.png` | 13984 |
| `android/app/src/main/res/drawable-land-xxxhdpi/splash.png` | 17683 |
| `android/app/src/main/res/drawable-port-hdpi/splash.png` | 7934 |
| `android/app/src/main/res/drawable-port-mdpi/splash.png` | 4096 |
| `android/app/src/main/res/drawable-port-xhdpi/splash.png` | 9875 |
| `android/app/src/main/res/drawable-port-xxhdpi/splash.png` | 13346 |
| `android/app/src/main/res/drawable-port-xxxhdpi/splash.png` | 17489 |
| `android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml` | 1914 |
| `android/app/src/main/res/drawable/ic_launcher_background.xml` | 5776 |
| `android/app/src/main/res/drawable/splash.png` | 4040 |
| `android/app/src/main/res/layout/activity_main.xml` | 490 |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` | 338 |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml` | 338 |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | 4666881 |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png` | 4666881 |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png` | 4666881 |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | 4666881 |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png` | 4666881 |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png` | 4666881 |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | 4666881 |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png` | 4666881 |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png` | 4666881 |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | 4666881 |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png` | 4666881 |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png` | 4666881 |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | 4666881 |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` | 4666881 |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png` | 4666881 |
| `android/app/src/main/res/values/colors.xml` | 312 |
| `android/app/src/main/res/values/strings.xml` | 301 |
| `android/app/src/main/res/values/styles.xml` | 1339 |
| `android/app/src/main/res/xml/file_paths.xml` | 158 |
| `android/app/src/main/res/xml/network_security_config.xml` | 298 |
| `android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java` | 403 |
| `android/build.gradle` | 685 |
| `android/capacitor.settings.gradle` | 210 |
| `android/gradle.properties` | 1133 |
| `android/gradle/gradle-daemon-jvm.properties` | 92 |
| `android/gradle/wrapper/gradle-wrapper.jar` | 43764 |
| `android/gradle/wrapper/gradle-wrapper.properties` | 259 |
| `android/gradlew` | 8984 |
| `android/gradlew.bat` | 2937 |
| `android/icon.png` | 4666881 |
| `android/settings.gradle` | 301 |
| `android/variables.gradle` | 513 |
| `capacitor.config.json` | 252 |
| `certs/cert.pem` | 1654 |
| `certs/key.pem` | 1732 |
| `create-client.js` | 1106 |
| `db/index.js` | 7092 |
| `middleware/auth.js` | 5409 |
| `migrate-anas.js` | 4631 |
| `migrate-phase1.js` | 11610 |
| `package-lock.json` | 41432 |
| `package.json` | 529 |
| `public/css/app.css` | 58373 |
| `public/icons/icon.svg` | 1622 |
| `public/index.html` | 52338 |
| `public/js/app.js` | 2109 |
| `public/js/auth.js` | 16433 |
| `public/js/ceo.js` | 57222 |
| `public/js/daily.js` | 52831 |
| `public/js/globals.js` | 3837 |
| `public/js/imei.js` | 64231 |
| `public/js/keyboard.js` | 2999 |
| `public/js/ui.js` | 5973 |
| `public/js/utils.js` | 5754 |
| `public/js/zxing.min.js` | 292357 |
| `public/manifest.json` | 480 |
| `routes/analytics.js` | 5800 |
| `routes/backup.js` | 4850 |
| `routes/clients.js` | 8298 |
| `routes/customers.js` | 3159 |
| `routes/days.js` | 2962 |
| `routes/expenses.js` | 2282 |
| `routes/logs.js` | 1806 |
| `routes/products.js` | 4007 |
| `routes/reports.js` | 4747 |
| `routes/sales.js` | 3277 |
| `routes/stock.js` | 12813 |
| `routes/warehouse.js` | 12342 |
| `scratch/check_clients.js` | 743 |
| `scratch/migrate_passwords.js` | 1910 |
| `server.js` | 4580 |
| `utils/helpers.js` | 554 |
