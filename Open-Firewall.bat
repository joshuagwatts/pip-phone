@echo off
:: Opens Windows Firewall for Pip desktop phone pairing (TCP 7420).
:: Right-click → Run as administrator if it fails.
netsh advfirewall firewall delete rule name="Pip Desktop Phone" >nul 2>&1
netsh advfirewall firewall add rule name="Pip Desktop Phone" dir=in action=allow protocol=TCP localport=7420 profile=any enable=yes
if errorlevel 1 (
  echo FAILED — right-click this file and Run as administrator.
  pause
  exit /b 1
)
echo OK — Phone Pip can reach this PC on port 7420.
pause
