$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.android-tools'))
if (!$toolsRoot.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid local toolchain path' }
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$log = Join-Path $toolsRoot 'setup.log'
$jdk = Join-Path $toolsRoot 'jdk'
$sdk = Join-Path $toolsRoot 'sdk'

if (!(Test-Path (Join-Path $jdk 'bin/java.exe'))) {
    Write-Output 'Downloading verified Temurin JDK 21 into the project cache...'
    $assets = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&heap_size=normal&image_type=jdk&jvm_impl=hotspot&os=windows&vendor=eclipse'
    $package = $assets[0].binary.package
    $archive = Join-Path $toolsRoot 'jdk.zip'
    Invoke-WebRequest $package.link -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $package.checksum) { throw 'JDK checksum mismatch' }
    $extract = Join-Path $toolsRoot 'jdk-extract'
    Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
    $folder = @(Get-ChildItem -LiteralPath $extract -Directory)
    if ($folder.Count -ne 1) { throw 'Unexpected JDK archive layout' }
    $source = [IO.Path]::GetFullPath($folder[0].FullName)
    if (!$source.StartsWith($toolsRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid extracted JDK path' }
    Move-Item -LiteralPath $source -Destination $jdk
}

$manager = Join-Path $sdk 'cmdline-tools/latest/bin/sdkmanager.bat'
if (!(Test-Path $manager)) {
    Write-Output 'Downloading verified official Android command-line tools...'
    [xml]$repository = (Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-3.xml').Content
    $package = $repository.SelectSingleNode("//*[local-name()='remotePackage' and @path='cmdline-tools;latest']")
    if (!$package) { throw 'Official command-line package metadata unavailable' }
    $archive = @($package.SelectNodes("./*[local-name()='archives']/*[local-name()='archive']")) | Where-Object { $_.SelectSingleNode("./*[local-name()='host-os']").InnerText -eq 'windows' } | Select-Object -First 1
    $complete = $archive.SelectSingleNode("./*[local-name()='complete']")
    $url = $complete.SelectSingleNode("./*[local-name()='url']").InnerText
    $checksum = $complete.SelectSingleNode("./*[local-name()='checksum']")
    if (!$url.StartsWith('commandlinetools-win-')) { throw 'Unexpected official SDK package URL' }
    $zip = Join-Path $toolsRoot 'sdk-tools.zip'
    Invoke-WebRequest ('https://dl.google.com/android/repository/' + $url) -OutFile $zip
    $algorithm = if ($checksum.GetAttribute('type') -eq 'sha256') { 'SHA256' } else { 'SHA1' }
    if ((Get-FileHash -LiteralPath $zip -Algorithm $algorithm).Hash -ne $checksum.InnerText) { throw 'Android tools checksum mismatch' }
    $extract = Join-Path $toolsRoot 'sdk-extract'
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
    $source = [IO.Path]::GetFullPath((Join-Path $extract 'cmdline-tools'))
    $destination = [IO.Path]::GetFullPath((Join-Path $sdk 'cmdline-tools/latest'))
    if (!$source.StartsWith($toolsRoot + [IO.Path]::DirectorySeparatorChar) -or !$destination.StartsWith($toolsRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid SDK extraction paths' }
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Move-Item -LiteralPath $source -Destination $destination
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_USER_HOME = Join-Path $toolsRoot 'android-user'
New-Item -ItemType Directory -Path $env:ANDROID_USER_HOME -Force | Out-Null
Write-Output 'Configuring the project-local SDK packages...'
$nativeManager = Join-Path $sdk 'cmdline-tools/latest/bin/android.exe'
if (Test-Path $nativeManager) {
    & $nativeManager "--sdk=$sdk" --no-metrics sdk install 'platforms/android-36' 'build-tools/35.0.0' 'platform-tools' *> $log
} else {
    ('y' + "`n") * 100 | & $manager "--sdk_root=$sdk" --licenses *> $log
    if ($LASTEXITCODE -ne 0) { throw "SDK license setup failed; see $log" }
    & $manager "--sdk_root=$sdk" 'platforms;android-36' 'build-tools;35.0.0' 'platform-tools' *>> $log
}
if ($LASTEXITCODE -ne 0) { throw "SDK installation failed; see $log" }
if (!(Test-Path (Join-Path $sdk 'platforms/android-36/android.jar')) -or !(Test-Path (Join-Path $sdk 'build-tools/35.0.0/aapt2.exe'))) { throw "Required SDK packages were not installed; see $log" }
Write-Output 'Project-local JDK 21 and Android SDK 36 are installed. No global settings changed.'
