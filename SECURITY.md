# PIP Security Policy

## Signing keys

- **No keystores, keys, or passwords are ever committed to this repo.** `*.keystore` / `*.jks`
  are git-ignored at both the repo root and `android/`.
- **Debug builds** use each developer machine's own auto-generated debug key
  (`~/.android/debug.keystore`). Nothing shared, nothing in git.
- **Release builds** are unsigned from CI. If a signed release is ever needed
  (e.g. Play Store), generate a real release key and store it in CI secrets or
  a local-only keystore — never in the repo.

## Incident note (2026-09-20)

A debug keystore (`android/app/pip-debug.keystore`, passwords in `build.gradle`)
was previously committed to this public repo. **Treat that key as compromised:**
anyone who cloned the repo holds the private key and passwords, and could sign
an APK that Android accepts as an "update" to `com.pip.phone`. If you ever
installed a build signed with that key, uninstall it and reinstall from a fresh
build. The keystore has been removed from the repo; it lives on in git history,
which is why it must never be trusted again.

## Firewall / desktop pairing

`Open-Firewall.bat` opens exactly one inbound rule — TCP 7420, Private profile,
local subnet only — so the phone can reach the desktop server on LAN. It does
not disable any firewall profile or reclassify networks. Pairing still requires
the desktop password; empty-password auth is rejected.

## Secrets handling (phone app, round 2 — 2026-09-21)

- **API keys and the desktop pairing token live in the secrets vault**
  (`www/secrets.js`), never in the persisted settings blob. Native builds use
  `@aparajita/capacitor-secure-storage` (Android Keystore / iOS Keychain);
  web builds use WebCrypto AES-GCM with a PBKDF2 passphrase (never plaintext).
- **First run migrates** any legacy plaintext keys out of localStorage, then
  wipes them. After migration, `pip.phone.v1` contains no key material.
- **`desktop_password` is never persisted anywhere.** If the desktop session
  expires, re-pair and re-enter the password — there is no silent re-mint.
- **Boot gate:** `www/boot.js` runs `requireBootAuth()` (real OS biometric via
  `@capgo/capacitor-native-biometric`, vault-passphrase fallback on web)
  before the vault loads. The old press-and-hold "lock" was theater and is gone.
- **Privacy default is SECURE** for new installs. SECURE chat runs
  desktop → on-device → Pip Lite; cloud APIs answer only when explicitly picked
  (per-turn consent, LEAKED marker persists). Compare asks for explicit consent
  every turn. OPP/CODE/vision/web/geo stay local in SECURE. Existing installs
  get a one-time SECURE-vs-LEAKY chooser — never silently flipped.
- **Desktop side:** the desktop server keeps its own keys in env vars or
  `data/keys.env` (git-ignored, never committed). It serves them to a paired
  phone over `/api/phone/cloud-keys` (LAN only, token-authenticated); the phone
  writes them straight into its vault.

## Reporting

Found a security issue in PIP? Open a GitHub issue or contact the repo owner
directly. Please do not post exploit details publicly before a fix is in.
