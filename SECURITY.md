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

## Reporting

Found a security issue in PIP? Open a GitHub issue or contact the repo owner
directly. Please do not post exploit details publicly before a fix is in.
