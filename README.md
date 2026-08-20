# Phone Pip

Same HUD on Android, iPhone, Mac, and Windows. OPP, kit, crew voice. Memory stays on that device. Does not submit forms.

**[Downloads](https://github.com/joshuagwatts/pip-phone/releases/latest)** — `Pip.apk`, `Pip-Windows.exe`, `Pip-Mac.dmg`

Open the new file on the device that already has Pip. It installs over the old one. KIT stays. Do not uninstall first.

## Brains (v0.1.6+)

Phone Pip routes COMM in this order:

1. **Desktop GPU** — paired to desktop Pip on the same Wi‑Fi (uses PC Ollama)
2. **Cloud** — when DATA posture is **LEAKY** and a key is saved
3. **On-device Qwen** — always the floor

### Grok on Phone Pip

Desktop Pip keeps chat local. Phone Pip can use Grok for COMM when you opt in:

1. DATA → **LEAKY**
2. PIN → **GROK**
3. Paste your **XAI** key
4. **SAVE** → **PROBE GROK**
5. COMM chip should show **GROK** on the next message

### Desktop GPU pairing

On **desktop Pip** (DATA tab):

1. Set a **Phone LAN password**
2. Turn **Phone LAN** on → restart Pip when asked
3. Note the LAN URL (e.g. `http://192.168.1.42:7420`)

On **Phone Pip** (DATA tab):

1. Paste that URL
2. Enter the same password → **PAIR**
3. **TEST** — should say desktop online with your Ollama model
4. COMM now prefers your PC's GPU

**VPN (v0.1.17+):** Desktop DATA → password + Phone LAN + VPN mode (Tailscale / WireGuard). Copy a URL into Phone Pip DATA → **VPN URL** → **PAIR VPN URL**, or use **FIND + PAIR** (tries VPN URLs before Wi‑Fi scan). WireGuard: desktop DATA → COPY PHONE WG → import in WireGuard app on phone.

## Android

Download **Pip.apk**. Open it. Allow install. Next time: DATA → UPDATE PIP, or download the APK again. Same app, higher version. KIT is still there.

USB / Android Studio:

```powershell
cd C:\Users\joshu\pip-phone
npm install
npx cap sync android
npx cap open android
```

## iPhone

On a Mac with Xcode (Apple will not sign an iPhone app from Windows):

```bash
cd pip-phone
npm install
npx cap sync ios
npx cap open ios
```

In Xcode: pick your iPhone, sign with your Apple ID (free, 7-day), Run.

## Windows (this HUD)

Download **Pip-Windows.exe**. Replace the old file. Run it.

Full local crew (Ollama, STUDIO, CODE, HANDS) is still the desktop PiP repo: double-click `Pip.bat`.

## Mac (this HUD)

Download **Pip-Mac.dmg**. Open. First launch: right-click → Open (unsigned).

Full local crew on a Mac: venv + `chmod +x Pip.command` then double-click it.

## Preview in a browser

```powershell
cd C:\Users\joshu\pip-phone\www
python -m http.server 7422
```

http://127.0.0.1:7422 — same HUD. Hunt may be blocked; paste the URL and questions.

CODE, HANDS, STUDIO, PC audio loopback stay on the Python desktop.
