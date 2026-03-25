@echo off
echo ============================================
echo  PhoneStock - HTTPS Certificate Setup
echo ============================================
echo.

:: Check if mkcert is installed
where mkcert >nul 2>&1
if %errorlevel% neq 0 (
  echo mkcert not found. Installing via winget...
  winget install FiloSottile.mkcert
  echo.
  echo Please RESTART this script after install completes.
  pause
  exit /b
)

:: Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
  set LOCAL_IP=%%a
  goto :found
)
:found
set LOCAL_IP=%LOCAL_IP: =%

echo Detected local IP: %LOCAL_IP%
echo.

:: Create certs directory
if not exist certs mkdir certs
cd certs

:: Install root CA (one time)
mkcert -install

:: Generate cert for localhost + local IP
mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 %LOCAL_IP%

cd ..

echo.
echo ============================================
echo  Done! Certificates created in /certs
echo  Now run:  node server.js
echo  Then open: https://%LOCAL_IP%:3443 on your phone
echo  (Click Advanced - Proceed on first visit)
echo ============================================
pause
