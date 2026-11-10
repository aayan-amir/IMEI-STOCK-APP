# Android build and acceptance

Current source uses pinned official Capacitor core/android/CLI8.6.0 and App8.1.2. Web assets and App registration synchronized successfully. The native project now matches AGP8.13.0/Gradle8.14.3, Java21 and SDK36, consistent with the [Capacitor8 guide](https://capacitorjs.com/docs/updating/8-0) and installed library build files. Min SDK24 and application identity app.stockly.android are unchanged.

Use npm run android:check, android:sync and android:build; the latter emits a debug APK only. A manual GitHub Actions Android debug build workflow sets Node24/JDK21/SDK36 and uploads its artifact. It was not dispatched. The local preflight reports missing JAVA_HOME/JDK21 and ANDROID_HOME/SDK36, so no local APK compilation is claimed.

Removed the template arithmetic test and corrected the instrumentation identity/package to the actual app. Removed the unnecessary JetBrains-only daemon constraint/resolver and unused keyboard plugin configuration. The web visual-viewport handler remains the keyboard strategy. The App plugin handles physical Back; core Android inset variables feed CSS safe areas. Device backup/transfer and production cleartext are disabled. These source changes are not physical-device acceptance.

Before release, assemble on a configured toolchain, then check camera permission/cancel/background/resume, keyboard focus, system insets, hardware back, offline/expired sessions, file/export/print and the old/new client matrix against an isolated HTTPS API. Record actual device/WebView versions and artifacts. No minimum-client cutoff, signing identity or store release was invented. See READY-TO-RUN.md for commands and verification limits.
