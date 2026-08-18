@echo off
setlocal
cd /d "%~dp0"

where git >nul 2>&1
where node >nul 2>&1
if errorlevel 1 (
  echo Need Node.js: https://nodejs.org
  exit /b 1
)

if not exist node_modules call npm ci
if errorlevel 1 call npm install
call npx cap sync android

where adb >nul 2>&1
if errorlevel 1 (
  echo App synced. Download the APK from GitHub Actions, or open Android Studio:
  echo   npx cap open android
  exit /b 0
)

if not exist android\gradlew.bat (
  echo Android project missing. Run: npx cap add android
  exit /b 1
)

pushd android
call gradlew.bat assembleDebug
if errorlevel 1 (
  echo Gradle could not build. Use the APK from GitHub Actions instead.
  popd
  exit /b 1
)
popd

adb install -r "android\app\build\outputs\apk\debug\app-debug.apk"
if errorlevel 1 (
  echo Plug in the S23, enable USB debugging, then run this again.
  echo Or copy android\app\build\outputs\apk\debug\app-debug.apk to the phone and tap it.
  exit /b 1
)
echo Installed. Open Pip on the phone.
