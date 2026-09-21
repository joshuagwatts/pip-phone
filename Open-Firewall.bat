@echo off
:: Run as Administrator — lets your phone reach the Pip desktop server.
::
:: This script does ONE thing: allows inbound TCP on port 7420, but ONLY
:: from devices on your own local network (localsubnet) and ONLY on the
:: Private firewall profile. It does NOT disable your firewall, change
:: any network profile, or open anything to the public internet.
setlocal EnableExtensions
set PORT=7420

echo.
echo === Pip Phone Firewall (scoped) ===
echo.

netsh advfirewall firewall delete rule name="Pip Desktop Phone" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 313" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 313w" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 312" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 312w" >nul 2>&1

netsh advfirewall firewall add rule name="Pip Desktop Phone" dir=in action=allow protocol=TCP localport=%PORT% profile=private remoteip=localsubnet enable=yes
if errorlevel 1 (
  echo FAILED adding port rule.
  goto fail
)

echo.
echo Rule added: TCP %PORT% inbound, Private profile, local subnet only.
echo Your firewall stays ON. Nothing was opened to the internet.
echo.
echo On the phone: join the same Wi-Fi as this PC, then in PIP go to
echo DATA - DESKTOP URL = http://^<this-PCs-LAN-IP^>:%PORT% - CONNECT
echo.
echo Find this PC's LAN IP with:  ipconfig   (look for IPv4 Address)
echo Test from phone Chrome: http://^<LAN-IP^>:%PORT%/api/ready
echo Should show {"ok":true}
echo.
pause
exit /b 0

:fail
echo FAILED — right-click this file - Run as administrator.
pause
exit /b 1
