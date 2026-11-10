# Ready-to-run handoff

## Web application

Use Node24 for one toolchain covering both web/backend and Android packaging. Install the lockfile with npm ci. Keep the existing .env; do not overwrite a configured database or platform secret. A new environment can start from .env.example, with an explicit MongoDB replica-set URI. Run npm start. /health/live reports process availability and /health/ready reports database readiness. Native API configuration remains an explicit HTTPS origin in public/js/config.js; browsers use their own origin.

New business writers stay off until the release operator deliberately enables STOCKTAKES_ENABLED, FULLY_PAID_SALES_ENABLED, CUSTOMER_RETURNS_ENABLED and VERIFIED_CASH_ENABLED. Verified cash requires the paid-sale and return flags. Set those values to true only for the intended environment and updated clients, then perform the explicit counted opening; never infer opening cash from inventory or profit. No live flags, credentials, data or deployment were changed by this work.

## Android

Official packages are locked: Capacitor core/android/CLI8.6.0 and App8.1.2. Native build inputs follow the installed Capacitor library and its [official Android upgrade guide](https://capacitorjs.com/docs/updating/8-0): JDK21, SDK36, AGP8.13.0 and Gradle8.14.3. Set JAVA_HOME and ANDROID_HOME to installed toolchains.

- npm run android:check reports missing prerequisites without a build.
- npm run android:sync copies current web assets and updates native plugin registration.
- npm run android:build checks prerequisites, syncs and assembles a debug APK at android/app/build/outputs/apk/debug/app-debug.apk.
- The manual Android debug build workflow provides an Ubuntu/JDK/SDK build path and uploads the APK artifact. It has not been dispatched from this checkout.

Back closes camera/dialog/sidebar/forms before leaving the current page or exiting. Android inset variables feed the existing safe-area CSS. Native cleartext traffic and automatic app-data backup/transfer are disabled; committed business records use the reviewed snapshot/restore flow. Pending browser jobs stay on their original device. Release signing and store publication require the owner's signing/distribution setup; debug assembly does not perform either.

## Actual verification status

Capacitor sync succeeded and registered the official App plugin. Changed JavaScript files passed parsing; no unit/integration tests were rerun after the user's stop instruction. The last broad run was590/591 before subsequent source changes, with a preflight subprocess failing to return an exit status. Its invocations were made asynchronous with the same20-second bound, but the case has not been rerun.

This machine has neither JDK21 nor SDK36 configured. No APK build or physical-device acceptance is claimed. Camera permission/lifecycle, keyboard/back/resume, real printer/PDF behavior, installed-client compatibility and rollout still need their actual target environment. These are external verification limits, not completed checks. See FEATURE-EXECUTION.md for historical evidence and DIALOG-SAFETY.md/BULK-INTAKE.md for current contracts.
