# Stock-ly: runtime, Android, operations, and repository boundaries

Source snapshot: 2026-11-08; baseline commit `38e4110`. This is a static source map, not a deployment certification. Paths and line references below identify the owning source. No database, migration, application server, or Android build was executed to produce it.

## 1. Runtime and package contract

| Concern | Source | Actual contract |
|---|---|---|
| Package | `package.json:2` | `phone-stock`, version `1.0.0`, ISC license. Product labels elsewhere say Stock-ly. |
| Entry point | `package.json:5` | `server.js`; CommonJS `require`, not ES modules. |
| Launch | `package.json:7`, `Procfile:1` | `npm start` / `node server.js`; Procfile runs the same Node process as `web`. |
| Declared engine | `package.json:11` | Node `>=18.x`. |
| Effective locked dependency minimum | `package-lock.json`, entries `node_modules/mongoose` and `node_modules/mongodb` | Both require Node `>=20.19.0`; use at least that version for the current lock. The package's Node 18 declaration is less restrictive than its actual dependency graph. |
| Frontend build | `package.json:6` | None declared. Express serves the authored `public/` files directly. |
| Test command | `package.json:8` | Placeholder prints `Error: no test specified` and exits 1. |
| Lint, formatting, types, bundling | `package.json` and repository inventory | No scripts/configuration for these were present in the mapped checkout. |

Direct production dependencies, all locked to the versions shown at this snapshot:

| Dependency | Declared range | Locked version | Role |
|---|---|---|---|
| bcrypt | `^6.0.0` | `6.0.0` | Client password hashing/comparison. |
| cors | `^2.8.6` | `2.8.6` | Express CORS middleware. |
| dotenv | `^17.4.2` | `17.4.2` | Loads server/tool environment. |
| express | `^5.2.1` | `5.2.1` | HTTP routing and static frontend hosting. |
| express-rate-limit | `^8.3.1` | `8.3.1` | API/auth/superadmin throttles. |
| helmet | `^8.1.0` | `8.1.0` | Response headers and explicit CSP. |
| mongoose | `^9.3.2` | `9.3.2` | Shared schemas and database-per-tenant model factories. |

There are no npm `devDependencies` in the manifest. The lock contains no `@capacitor/*` packages.

## 2. Environment map

Values are intentionally omitted. `.env` was not opened.

| Variable | Owner | Meaning |
|---|---|---|
| `MONGO_URI` | `db/index.js:25` | Master/default MongoDB connection. Tenant databases share this connection via `useDb`. |
| `PORT` | `server.js:15` | Listener port; default 3000. |
| `NODE_ENV` | `server.js:31`, `server.js:38` | Enables production default proxy trust and forwarded-protocol HTTPS redirect. |
| `TRUST_PROXY` | `server.js:18` | Boolean or nonnegative integer proxy trust; invalid explicit value falls back to 1. |
| `SUPER_ADMIN_PASSWORD` | `middleware/auth.js:21` | Superadmin header comparison; source supplies a fallback if unset. |
| `ALLOWED_ORIGINS` | `server.js:47` | Parsed into a variable, but that variable is not passed to `cors()`; the active middleware remains unrestricted CORS. |
| `DEFAULT_CLIENT_ID`, `DEFAULT_CLIENT_NAME`, `DEFAULT_CLIENT_SLUG` | `migrate-phase1.js:29` | Legacy migration target identity only; not live server tenant selection. |
| `VALID_SHOPS` | `migrate-phase1.js:32`, `migrate-anas.js:43` | Historical migration shop configuration; current shops come from master Client documents. |
| `ADMIN_PASSWORD`, `GATE_PASSWORD` | `migrate-anas.js:41` | Historical client creation/migration credentials; not live auth environment switches. |

The presence of a variable in an old script does not make it a supported live-server configuration option.

## 3. Android application shape

`capacitor.config.json:2` identifies the package as `app.stockly.android`, app name Stock-ly, with `public` as `webDir`. There is no configured `server.url`: the intended wrapper uses packaged web assets. The frontend chooses its API origin separately; see the frontend map.

`android/app/src/main/java/app/stockly/android/MainActivity.java:5` is an empty subclass of `BridgeActivity`. It adds no independent Java business logic, native data store, or custom scanner implementation. Most product behavior remains JavaScript + the remote Express API.

| File / area | Responsibility |
|---|---|
| `android/settings.gradle` | Includes `:app`, generated Cordova adapter project, and Capacitor settings. Adds Foojay toolchain resolver 1.0.0. |
| `android/capacitor.settings.gradle:3` | Resolves `:capacitor-android` from `../node_modules/@capacitor/android/capacitor`. |
| `android/build.gradle:10` | Android Gradle plugin 9.2.0; Google services plugin 4.4.4; Google/Maven Central repositories. |
| `android/variables.gradle:2` | min SDK 24, compile/target SDK 36; shared AndroidX/test/Cordova version declarations. |
| `android/gradle/wrapper/gradle-wrapper.properties:3` | Gradle distribution 9.5.0. |
| `android/gradle/gradle-daemon-jvm.properties:2` | JetBrains JDK vendor, Java 21 toolchain. |
| `android/gradle.properties:12` | Gradle daemon heap 1536 MB, AndroidX enabled, dependency constraint flag. |
| `android/app/build.gradle:4` | Namespace/application ID, versionCode 1 / versionName 1.0, dependencies and release options. |
| `android/app/capacitor.build.gradle:5` | Generated Capacitor settings select Java 21 source/target compatibility. |
| `android/app/proguard-rules.pro` | ProGuard rule template; release `minifyEnabled false` currently disables shrinking. |
| `android/gradlew`, `android/gradlew.bat`, wrapper JAR | Platform-specific Gradle launchers and wrapper implementation. |

`android/app/build.gradle:41` only applies Google services when a readable `google-services.json` exists. This conditional block is not evidence that push notifications are implemented.

### Permissions, WebView, and keyboard

- `android/app/src/main/AndroidManifest.xml:5`: Internet + camera permissions; camera hardware is optional.
- The main exported launcher activity uses `singleTask`, extensive `configChanges`, and `adjustPan` for the software keyboard (`AndroidManifest.xml:21`).
- `capacitor.config.json:6` configures Keyboard resize as `none`, `resizeOnFullScreen: true`; no Keyboard npm dependency is declared, so configuration alone does not prove that plugin is installed.
- `android/app/src/main/res/xml/network_security_config.xml:3` allows cleartext traffic for `www.stock-ly.app` and `localhost`, including subdomains. It does not globally permit all destinations.
- `AndroidManifest.xml:13` sets `allowBackup=true`.
- FileProvider is unexported with URI grants; `res/xml/file_paths.xml` exposes named external/cache path roots for provider use. No custom native file-sharing code is present in MainActivity.
- Theme files remove the action bar and transition from the splash theme to the main app theme. The layout contains a full-size WebView (`res/layout/activity_main.xml:8`).

### What is missing from this checkout's native build inputs

At mapping time these paths did not exist: `node_modules/@capacitor/android`, `android/capacitor-cordova-android-plugins`, `android/app/src/main/assets/public`, `android/local.properties`. The npm manifest/lock do not declare Capacitor CLI/core/Android dependencies.

Therefore this is an incomplete native build setup as checked out: an ordinary `npm ci` cannot supply the referenced Capacitor project, and there is no declared sync/build npm script. Restoring the appropriate Capacitor package versions and syncing web assets requires a separate implementation/setup task. No package versions or Android files were changed during mapping.

`android/app/release/output-metadata.json:16` names a release APK and baseline profiles; the tracked `.dm` files are build artifacts, not authored application code. Metadata alone does not establish that the current source builds, that an APK is present, or that it was published.

## 4. Scripts and migration lineage

These are direct database tools, outside Express middleware, permissions, rate limits, and audit routing. They were inspected statically and were not run.

| Script | Actual purpose / effects | Important boundary |
|---|---|---|
| `create-client.js:13` | Connects to `MONGO_URI`; uses CLI args for client ID/admin/gate passwords; upserts master Client with two example shop records. | Defines its own minimal schema and writes passwords directly. It does not use the live Client schema hashing hook. Logs the returned client document. Existing client credentials/shops can be overwritten. |
| `migrate-phase1.js:82` | Legacy shared-collection migration. Ensures a default Client and HQStock record, stamps documents missing `clientId`, then creates legacy tenant-key compound indexes. | `--dry-run` skips the explicit migration writes but still connects to MongoDB and registers Mongoose models. This belongs to the older shared-database design, not current tenant DB routing. |
| `migrate-anas.js:22` | Sets IPv4-first DNS; upserts a fixed `ANAS` master Client, opens `tenant_ANAS`, copies ten legacy collections. | For each nonempty source collection it clears the destination before insert. Does not filter source by client. Local schemas bypass live hashing hooks. No transaction or dry-run mode. Products and sessions are not copied. |
| `scratch/migrate_passwords.js:16` | Loads `.env` relative to the script's parent; iterates all master clients; hashes admin/gate values without a `$2b$` prefix using bcrypt cost 12. | Direct one-off credential migration. Prefix heuristic differs from validation of arbitrary bcrypt variants; do not assume safe universal re-runnability. |
| `scratch/check_clients.js:12` | Reads master clients and prints identity plus gate/admin password fields. | Diagnostic output can contain credential material. Do not run as a casual app health check. |

The coexistence of `clientId`-stamping scripts and current `tenant_<clientId>` databases reflects historical architecture. Their schemas/index plans are not interchangeable with the current server's models.

## 5. Browser assets and native asset footprint

- `public/manifest.json` describes standalone display, portrait-primary orientation, root start URL, theme/background colors, and a scalable SVG icon.
- Manifest metadata is distinct from offline support. Service-worker/storage behavior is covered in the frontend report.
- `public/js/zxing.min.js` is a third-party barcode decoding bundle; map its integration points rather than manually editing its internals.
- Android splash PNGs vary by density/orientation; adaptive launcher XML points at foreground/background resources.
- There are 28 tracked PNG/SVG files totaling **74,781,161 bytes**. Fifteen density-specific launcher PNGs plus `android/icon.png` are each **4,666,881 bytes**. This is a source/asset footprint observation, not an APK-size or runtime-memory measurement. Image optimization could be a separate task.

## 6. Ancillary and generated repository content

| Area | Meaning / mapping treatment |
|---|---|
| `README.md` | Existing project overview and endpoint list; useful orientation, verified against current source. |
| `STRUCTURE.md` | Existing architecture map; preserved. New reports add source-verified detail and current caveats. |
| `.gitignore` | Ignores node_modules, `.env`, certs, `.vs`, one legacy stock JSON file, two GitNexus DB paths. An ignore rule does not remove files already tracked. |
| `.idea/`, `android/.idea/` | Editor/device/run configuration and caches. Not product runtime. |
| `.vs/` | Twelve tracked local IDE state/chat/index files despite the ignore rule. Their contents were not mined for app behavior. |
| `certs/cert.pem`, `certs/key.pem` | Both tracked despite `certs/` being ignored. Contents were not opened. The mapped `server.js` runs HTTP and does not load these files; do not treat them as an active TLS configuration. |
| `android/.gitignore`, `android/app/.gitignore` | Native generated/build ignore rules. |
| `.serena/project.yml` | Project mapping configuration installed in the preceding task; uses the TypeScript language server for JavaScript. Excludes secrets, dependencies, native builds and minified ZXing. |
| `.serena/.gitignore` | Keeps caches and local project overrides out of version control. |
| `.serena/memories/` | Durable project navigation notes; exact API inventories remain in docs, rather than filling every agent session. |

## 7. Verification and limits

Performed: all **30 authored JavaScript files** passed `node --check`. This parses source without executing it or connecting to the database. The inventory excludes minified third-party code from this check.

Not established by this map: browser behavior on physical devices, authorization correctness under live traffic, database contents/index state, migration safety on actual data, concurrent write behavior, measured server/browser performance, Android compilation/signing/release validity, or production infrastructure.

The Java tests are templates: `ExampleUnitTest.java:16` checks `2 + 2 == 4`; `ExampleInstrumentedTest.java:24` expects `com.getcapacitor.app`, which differs from the configured `app.stockly.android`. No application-level JavaScript tests or CI workflows were found. Do not report a passing app test suite from the syntax checks.

## 8. Commands by intent

| Intent | Command | Scope |
|---|---|---|
| Install exact Node dependencies | `npm ci` | Dependency installation; not performed during mapping. Requires compatible Node. |
| Start server | `npm start` | Connects to MongoDB; `.env`/environment required. Not performed during mapping. |
| Parse one authored file | `node --check routes/stock.js` | Syntax only; safe without database access. |
| See current changes | `git status --short` | Repository inspection. |
| Check memory references | `C:\Users\AAYAN\.local\bin\serena.exe memories check` | Serena memory integrity, from repo root. |
| Native build entry point | `android\gradlew.bat` | Windows Gradle launcher; current missing native inputs must be resolved before expecting a build. |

No migration command is part of normal start, syntax validation, or routine task completion.
