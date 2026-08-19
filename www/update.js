import { httpGet, openUrl } from "./net.js";

const REPO = "joshuagwatts/pip-phone";
const APK_LATEST = `https://github.com/${REPO}/releases/latest/download/Pip.apk`;
const VERSION_RAW = `https://raw.githubusercontent.com/${REPO}/main/package.json`;
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;

function parseVer(v) {
  return String(v || "0")
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

export function compareVer(a, b) {
  const av = parseVer(a);
  const bv = parseVer(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const x = av[i] || 0;
    const y = bv[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export async function currentVersion() {
  const cap = window.Capacitor;
  if (cap?.Plugins?.App?.getInfo) {
    try {
      const info = await cap.Plugins.App.getInfo();
      return String(info.version || "").trim();
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function isAndroidNative() {
  const cap = window.Capacitor;
  return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === "android");
}

function pipUpdatePlugin() {
  const cap = window.Capacitor;
  if (!cap) return null;
  if (cap.Plugins?.PipUpdate) return cap.Plugins.PipUpdate;
  if (typeof cap.registerPlugin === "function") {
    try {
      return cap.registerPlugin("PipUpdate");
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function fetchLatestRelease() {
  let version = "";
  try {
    const res = await httpGet(VERSION_RAW, 14000);
    const pkg = JSON.parse(res.body || "{}");
    version = String(pkg.version || "").trim();
  } catch {
    /* raw package.json failed — still offer direct APK download */
  }
  return {
    version,
    name: version ? `Pip v${version}` : "Pip",
    notes: "",
    apkUrl: APK_LATEST,
    pageUrl: RELEASE_PAGE,
  };
}

export async function checkUpdate() {
  const current = await currentVersion();
  try {
    const latest = await fetchLatestRelease();
    const available = latest.version && current ? compareVer(latest.version, current) > 0 : false;
    return { current, latest, available, error: latest.version ? "" : "could not read remote version" };
  } catch (e) {
    return {
      current,
      latest: { version: "", name: "Pip", notes: "", apkUrl: APK_LATEST, pageUrl: RELEASE_PAGE },
      available: false,
      error: String(e.message || e),
    };
  }
}

export async function installUpdate(latest, onProgress) {
  const rel = latest || (await fetchLatestRelease());
  const url = rel.apkUrl || APK_LATEST;
  const native = pipUpdatePlugin();

  if (native?.installApk && isAndroidNative()) {
    if (onProgress) onProgress("DOWNLOADING APK…");
    try {
      await native.installApk({ url });
      if (onProgress) onProgress("TAP INSTALL · KIT STAYS");
      return { mode: "install", url };
    } catch (e) {
      const msg = String(e.message || e);
      if (!/settings/i.test(msg)) throw e;
      if (onProgress) onProgress(msg.toUpperCase());
      throw e;
    }
  }

  if (onProgress) onProgress("OPENING APK DOWNLOAD…");
  await openUrl(url, { system: true });
  if (onProgress) onProgress("DOWNLOAD PIP.APK · INSTALL OVER THIS APP");
  return { mode: "browser", url };
}
