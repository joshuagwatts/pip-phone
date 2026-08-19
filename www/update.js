import { httpGet, openUrl } from "./net.js";

const REPO = "joshuagwatts/pip-phone";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

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

export async function fetchLatestRelease() {
  const res = await httpGet(API, 14000, {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const data = JSON.parse(res.body || "{}");
  const version = String(data.tag_name || "").replace(/^v/i, "");
  const assets = data.assets || [];
  const apk =
    assets.find((a) => /^pip\.apk$/i.test(a.name || "")) ||
    assets.find((a) => /\.apk$/i.test(a.name || ""));
  return {
    version,
    name: data.name || (version ? `Pip v${version}` : "Pip"),
    notes: String(data.body || "")
      .trim()
      .replace(/\r\n/g, "\n")
      .slice(0, 500),
    apkUrl: apk?.browser_download_url || "",
    pageUrl: data.html_url || `https://github.com/${REPO}/releases/latest`,
  };
}

export async function checkUpdate() {
  const current = await currentVersion();
  try {
    const latest = await fetchLatestRelease();
    if (!latest.version) throw new Error("release has no version tag");
    const available = current ? compareVer(latest.version, current) > 0 : false;
    return { current, latest, available, error: "" };
  } catch (e) {
    return {
      current,
      latest: null,
      available: false,
      error: String(e.message || e),
    };
  }
}

export async function installUpdate(latest, onProgress) {
  const rel = latest || (await fetchLatestRelease());
  const url = rel.apkUrl || rel.pageUrl;
  if (!url) throw new Error("no update download found");

  const cap = window.Capacitor;
  const native = cap?.Plugins?.PipUpdate;
  if (native?.installApk && rel.apkUrl && isAndroidNative()) {
    if (onProgress) onProgress("DOWNLOADING APK…");
    await native.installApk({ url: rel.apkUrl });
    if (onProgress) onProgress("TAP INSTALL · KIT STAYS");
    return { mode: "install", url: rel.apkUrl };
  }

  if (onProgress) onProgress(rel.apkUrl ? "OPENING APK DOWNLOAD…" : "OPENING GITHUB…");
  await openUrl(rel.apkUrl || rel.pageUrl, { system: true });
  if (onProgress) onProgress("DOWNLOAD PIP.APK · INSTALL OVER THIS APP");
  return { mode: "browser", url };
}
