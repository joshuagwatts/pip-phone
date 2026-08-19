const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function nativeHttp() {
  const cap = window.Capacitor;
  return cap && cap.Plugins && cap.Plugins.CapacitorHttp;
}

export function hasNativeHttp() {
  return Boolean(nativeHttp());
}

function assertPublic(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("bad url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("need http(s)");
  const host = (u.hostname || "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "::1") {
    throw new Error("public web only");
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) {
    throw new Error("public web only");
  }
  return u.toString();
}

export async function httpGet(url, timeoutMs = 14000, extraHeaders = {}) {
  const target = assertPublic(url);
  const headers = { "User-Agent": UA, Accept: "text/html,application/json,*/*", ...extraHeaders };
  const http = nativeHttp();
  if (http) {
    const res = await http.get({
      url: target,
      headers,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      disableRedirects: false,
    });
    const status = res.status || 0;
    if (status >= 400) throw new Error(`fetch ${status}`);
    return { url: res.url || target, status, body: typeof res.data === "string" ? res.data : JSON.stringify(res.data || "") };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, { signal: ctrl.signal, redirect: "follow", headers });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return { url: res.url, status: res.status, body: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

export async function httpPostJson(url, headers, payload, timeoutMs = 60000) {
  const http = nativeHttp();
  if (http) {
    const res = await http.post({
      url,
      headers: { "Content-Type": "application/json", ...headers },
      data: payload,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    const status = res.status || 0;
    const data = typeof res.data === "string" ? JSON.parse(res.data || "{}") : res.data || {};
    if (status >= 400) {
      const err = new Error((data && (data.error && data.error.message)) || `http ${status}`);
      err.status = status;
      throw err;
    }
    return data;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `http ${res.status}`);
    return data;
  } finally {
    clearTimeout(t);
  }
}

export async function openUrl(url) {
  const cap = window.Capacitor;
  if (cap && cap.Plugins && cap.Plugins.Browser) {
    await cap.Plugins.Browser.open({ url });
    return;
  }
  window.open(url, "_blank");
}
