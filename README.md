# Phone Pip

Same HUD on Android, iPhone, Mac, and Windows. OPP, kit, crew voice. Memory stays on that device. Does not submit forms.

**[Downloads](https://github.com/joshuagwatts/pip-phone/releases/latest)** — `Pip.apk`, `Pip-Windows.exe`, `Pip-Mac.dmg`

## Android

Download **Pip.apk**. Open it on the phone. Allow install from this source.

USB / Android Studio:

```powershell
cd C:\Users\joshu\PiP\phone
npm install
npx cap sync android
npx cap open android
```

## iPhone

On a Mac with Xcode (Apple will not sign an iPhone app from Windows):

```bash
cd phone
npm install
npx cap sync ios
npx cap open ios
```

In Xcode: pick your iPhone, sign with your Apple ID (free, 7-day), Run.

Safari Add to Home Screen works for the HUD chrome. Hunt needs the Xcode app (native GET).

## Windows (this HUD)

Download **Pip-Windows.exe**. Run it. No Python.

Full local crew (Ollama, STUDIO, CODE, HANDS) is still this PiP folder: double-click `Pip.bat`.

## Mac (this HUD)

Download **Pip-Mac.dmg**. Open. First launch: right-click → Open (unsigned).

Full local crew on a Mac: venv + `chmod +x Pip.command` then double-click it.

## Preview in a browser

```powershell
cd C:\Users\joshu\PiP\phone\www
python -m http.server 7422
```

http://127.0.0.1:7422 — same HUD. Hunt may be blocked; paste the URL and questions.

CODE, HANDS, STUDIO, PC audio loopback stay on the Python desktop.
