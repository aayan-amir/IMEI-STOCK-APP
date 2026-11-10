'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const localTools = path.join(root, '.android-tools');
const javaHome = process.env.JAVA_HOME || (fs.existsSync(path.join(localTools, 'jdk', 'bin')) ? path.join(localTools, 'jdk') : null);
const java = javaHome ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const version = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 5000 });
const major = Number(((version.stderr || '') + (version.stdout || '')).match(/version "(\d+)/)?.[1]);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (fs.existsSync(path.join(localTools, 'sdk')) ? path.join(localTools, 'sdk') : path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'));
const issues = [];
if (Number(process.versions.node.split('.')[0]) < 22) issues.push('Android packaging requires Node 22 or newer.');
if (version.error || version.status !== 0 || major !== 21) issues.push('Set JAVA_HOME to an installed JDK 21.');
if (!fs.existsSync(path.join(sdk, 'platforms', 'android-36', 'android.jar'))) issues.push('Set ANDROID_HOME to an Android SDK containing platforms;android-36.');
if (process.argv.slice(2).some(arg => arg !== '--check')) issues.push('Use npm run android:build or npm run android:check.');

if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else if (process.argv.includes('--check')) {
  console.log('Android build inputs available: Node ' + process.versions.node + ', JDK 21, SDK 36.');
} else {
  const cli = path.join(path.dirname(require.resolve('@capacitor/cli/package.json')), 'bin', 'capacitor');
  const sync = spawnSync(process.execPath, [cli, 'sync', 'android'], { cwd: root, stdio: 'inherit', timeout: 60000 });
  if (sync.error || sync.status !== 0) {
    console.error('Android sync failed; no APK was built.'); process.exitCode = 1;
  } else {
    fs.mkdirSync(path.join(localTools, 'android-user'), { recursive: true });
    const windows = process.platform === 'win32';
    const child = spawn(windows ? 'cmd.exe' : './gradlew', windows ? ['/d', '/c', 'gradlew.bat assembleDebug --no-daemon'] : ['assembleDebug', '--no-daemon'],
      { cwd: path.join(root, 'android'), stdio: 'inherit', env: { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}), ANDROID_HOME: sdk, ANDROID_USER_HOME: path.join(localTools, 'android-user'), GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || path.join(localTools, 'gradle-cache') } });
    child.on('error', () => { console.error('Could not start the Android build.'); process.exitCode = 1; });
    child.on('close', code => { process.exitCode = code ?? 1; if (code === 0) console.log('APK: android/app/build/outputs/apk/debug/app-debug.apk'); });
  }
}
