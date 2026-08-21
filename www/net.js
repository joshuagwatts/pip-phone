import { withLanBypass } from "./proton.js";

const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function nativeHttp() {
  const cap = window.Capacitor;
  return cap && cap.Plugins && cap.Plugins.CapacitorHttp;
}

export function hasNativeHttp() {
  return Boolean(nativeHttp());
}

function parseCookie(setCookie) {
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const part of parts) {
    const raw = String(part || "");
    const hit = raw.match(/pip_gate=([^;,\s]+)/i);
    if (hit) return hit[1];
  }
  return "";
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

function assertLan(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("bad url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("need http(s)");
  const host = (u.hostname || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    throw new Error("use your PC LAN IP, not localhost");
  }
  return u.toString();
}

async function request(method, url, headers, body, timeoutMs, assertFn) {
  const target = assertFn(url);
  const http = nativeHttp();
  const publicCall = assertFn === assertPublic;
  if (http) {
    const req = {
      url: target,
      headers: { "User-Agent": UA, Accept: "application/json,text/html,*/*", ...headers },
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
      disableRedirects: false,
    };
    if (body !== undefined) {
      // CapacitorHttp on Android is happiest with a JSON string body.
      req.data = typeof body === "string" ? body : JSON.stringify(body);
      req.headers["Content-Type"] = "application/json";
    }
    let res;
    try {
      res = method === "POST" ? await http.post(req) : await http.get(req);
    } catch (e) {
      const err = new Error(String(e?.message || e || "native http failed"));
      err.status = 0;
      throw err;
    }
    const status = Number(res.status) || 0;
    const data =
      typeof res.data === "string"
        ? (() => {
            try {
              return JSON.parse(res.data || "{}");
            } catch {
              return { raw: res.data };
            }
          })()
        : res.data && typeof res.data === "object"
          ? res.data
          : {};
    let cookie = "";
    const hdrs = res.headers || {};
    for (const [k, v] of Object.entries(hdrs)) {
      if (/^set-cookie$/i.test(k)) {
        cookie = parseCookie(v);
        if (cookie) break;
      }
    }
    if (cookie) data._cookie = cookie;
    if (!status) {
      const err = new Error(
        publicCall
          ? "network failed — check data/Wi‑Fi · Proton may be blocking this API"
          : "network failed — Proton: Allow LAN connections · or same Wi‑Fi · Open-Firewall.bat as Admin",
      );
      err.status = 0;
      throw err;
    }
    if (status >= 400) {
      const detail =
        (data && (data.detail || (typeof data.error === "string" ? data.error : data.error?.message))) ||
        `http ${status}`;
      const err = new Error(String(detail).slice(0, 180));
      err.status = status;
      throw err;
    }
    return data;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = {
      method,
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "application/json,text/html,*/*", ...headers },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(target, init);
    const data = await res.json().catch(() => ({}));
    const cookie = parseCookie(res.headers.get("set-cookie"));
    if (cookie) data._cookie = cookie;
    if (!res.ok) {
      const detail =
        (typeof data.error === "string" ? data.error : data.error?.message) || data.detail || `http ${res.status}`;
      throw new Error(String(detail).slice(0, 180));
    }
    return data;
  } finally {
    clearTimeout(t);
  }
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

export async function httpLanGet(url, timeoutMs = 10000, extraHeaders = {}) {
  return withLanBypass(() => request("GET", url, extraHeaders, undefined, timeoutMs, assertLan));
}

export async function httpPostJson(url, headers, payload, timeoutMs = 60000) {
  return request("POST", url, headers, payload, timeoutMs, assertPublic);
}

export async function httpLanPostJson(url, headers, payload, timeoutMs = 60000) {
  return withLanBypass(() => request("POST", url, headers, payload, timeoutMs, assertLan));
}

/** SSE stream from desktop Pip (CODE apply). Uses fetch ReadableStream — works in Capacitor WebView. */
export async function* httpLanSSE(url, headers, payload, timeoutMs = 300000) {
  const target = assertLan(url);
  // Hold Wi‑Fi bind for the whole stream so Proton doesn't steal the route mid-apply.
  let bound = false;
  try {
    const { vpnSystemActive, bindLanWifi, unbindLanNetwork } = await import("./proton.js");
    if (await vpnSystemActive()) bound = await bindLanWifi();
  } catch {
    /* browser preview */
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.detail || JSON.stringify(j);
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const ev of parts) {
        if (!ev.startsWith("data: ")) continue;
        try {
          yield JSON.parse(ev.slice(6));
        } catch {
          /* skip bad chunk */
        }
      }
    }
  } finally {
    clearTimeout(t);
    if (bound) {
      try {
        const { unbindLanNetwork } = await import("./proton.js");
        await unbindLanNetwork();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function openUrl(url, opts = {}) {
  const cap = window.Capacitor;
  const system = Boolean(opts.system);
  if (system && cap && cap.Plugins && cap.Plugins.App && cap.Plugins.App.openUrl) {
    await cap.Plugins.App.openUrl({ url });
    return;
  }
  if (cap && cap.Plugins && cap.Plugins.Browser) {
    await cap.Plugins.Browser.open({ url });
    return;
  }
  window.open(url, "_blank");
}
