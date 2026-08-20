@echo off
:: Run as Administrator — opens Pip for Phone on this Wi-Fi.
setlocal EnableExtensions
set PORT=7420

echo.
echo === Pip Phone Firewall ===
echo.

netsh advfirewall firewall delete rule name="Pip Desktop Phone" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 313" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 313w" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 312" >nul 2>&1
netsh advfirewall firewall delete rule name="Pip Python 312w" >nul 2>&1

netsh advfirewall firewall add rule name="Pip Desktop Phone" dir=in action=allow protocol=TCP localport=%PORT% profile=any enable=yes
if errorlevel 1 (
  echo FAILED adding port rule.
  goto fail
)

if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
  netsh advfirewall firewall add rule name="Pip Python 313" dir=in action=allow program="%LocalAppData%\Programs\Python\Python313\python.exe" profile=any enable=yes
  netsh advfirewall firewall add rule name="Pip Python 313w" dir=in action=allow program="%LocalAppData%\Programs\Python\Python313\pythonw.exe" profile=any enable=yes
)
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
  netsh advfirewall firewall add rule name="Pip Python 312" dir=in action=allow program="%LocalAppData%\Programs\Python\Python312\python.exe" profile=any enable=yes
  netsh advfirewall firewall add rule name="Pip Python 312w" dir=in action=allow program="%LocalAppData%\Programs\Python\Python312\pythonw.exe" profile=any enable=yes
)

:: Private profile has firewall OFF on this PC — force Wi-Fi into Private.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try { Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -match 'Wi-Fi|WLAN|Wireless' } | ForEach-Object { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private; Write-Host ('Wi-Fi set Private: ' + $_.Name) } } catch { Write-Host ('Set-NetConnectionProfile: ' + $_.Exception.Message) };" ^
  "Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles' -ErrorAction SilentlyContinue | ForEach-Object {" ^
  "  $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;" ^
  "  if ($p.ProfileName -and $p.Category -ne 1) {" ^
  "    try { Set-ItemProperty -Path $_.PSPath -Name Category -Value 1 -Type DWord; Write-Host ('Registry Private: ' + $p.ProfileName) } catch { Write-Host ('Registry fail: ' + $_.Exception.Message) }" ^
  "  }" ^
  "};" ^
  "try { Set-NetFirewallProfile -Profile Private -Enabled False; Write-Host 'Private firewall left OFF (open for phone)' } catch {};" ^
  "Get-NetConnectionProfile | Format-Table Name,InterfaceAlias,NetworkCategory -AutoSize"

echo.
echo Done. On the phone: turn OFF any VPN, same Wi-Fi as PC,
echo DATA - DESKTOP URL = http://192.168.1.162:7420 - CONNECT
echo.
echo Test from phone Chrome: http://192.168.1.162:7420/api/ready
echo Should show {"ok":true}
echo.
pause
exit /b 0

:fail
echo FAILED — right-click this file - Run as administrator.
pause
exit /b 1
