import { withLanBypass, decideLanBind, unbindLanNetwork } from "./proton.js";

const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

/** CapacitorHttp — core plugin (Bridge always registers it). Prefer request() then get/post. */
function nativeHttp() {
  const cap = window.Capacitor;
  const plugins = cap && (cap.Plugins || cap.plugins);
  return (plugins && plugins.CapacitorHttp) || null;
}

export function hasNativeHttp() {
  return Boolean(nativeHttp());
}

export function httpDiag() {
  const cap = window.Capacitor;
  const http = nativeHttp();
  return {
    platform: cap?.getPlatform?.() || (cap ? "native?" : "web"),
    nativeHttp: Boolean(http),
    methods: http ? Object.keys(http).filter((k) => typeof http[k] === "function").slice(0, 12) : [],
  };
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

/* ------------------------------------------------------------------ SSRF guard
 * Blocks non-public targets by IP literal in BOTH v4 and v6, every form the
 * WHATWG URL parser can produce. Redirects are followed MANUALLY with this
 * guard re-asserted on every hop (see followPublicRedirects).
 *
 * Residual: DNS names are checked as strings only — a WebView has no DNS API
 * to resolve-and-check, and even resolve-then-check races the connect
 * (TOCTOU). Known-dangerous literals are all blocked below.
 */

function stripBrackets(h) {
  // URL.hostname keeps IPv6 brackets ("[::1]") — strip for byte parsing.
  return h.length > 2 && h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

function ipv4Bytes(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const b = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (b.some((n) => n > 255)) return null;
  return b;
}

function ipv6Bytes(host) {
  // host: no brackets, lowercase. Handles :: compression and embedded IPv4
  // (::ffff:127.0.0.1). Returns 16 bytes or null when unparseable (deny).
  if (!host.includes(":")) return null;
  let h = host;
  let tailWords = [];
  const v4 = h.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const b = ipv4Bytes(v4[1]);
    if (!b) return null;
    tailWords = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    h = h.slice(0, h.length - v4[0].length);
  }
  if (!/^[0-9a-f:]*$/.test(h)) return null;
  const dbl = h.split("::");
  if (dbl.length > 2) return null;
  const parseSide = (s) => (s ? s.split(":") : []);
  const head = parseSide(dbl[0]);
  const tailp = dbl.length === 2 ? parseSide(dbl[1]) : [];
  const hexOk = (g) => /^[0-9a-f]{1,4}$/.test(g);
  if (head.some((g) => !hexOk(g)) || tailp.some((g) => !hexOk(g))) return null;
  const total = head.length + tailp.length + tailWords.length;
  const fill = 8 - total;
  if (fill < 0) return null;
  if (dbl.length === 1) {
    if (total !== 8) return null; // no "::" — must be exactly 8 groups
  } else if (h !== "::" && fill < 1) {
    return null; // "::" must actually compress at least one group
  }
  const words = [
    ...head.map((g) => parseInt(g, 16)),
    ...new Array(fill).fill(0),
    ...tailp.map((g) => parseInt(g, 16)),
    ...tailWords,
  ];
  if (words.length !== 8) return null;
  const out = new Uint8Array(16);
  words.forEach((w, i) => {
    out[i * 2] = (w >> 8) & 0xff;
    out[i * 2 + 1] = w & 0xff;
  });
  return out;
}

function v4Blocked(b) {
  if (b[0] === 0) return true; // 0.0.0.0/8 — "this network" / unspecified
  if (b[0] === 10) return true; // 10/8
  if (b[0] === 127) return true; // 127/8 loopback
  if (b[0] === 169 && b[1] === 254) return true; // 169.254/16 link-local
  if (b[0] === 172 && b[1] >= 16 && b[1] <= 31) return true; // 172.16/12
  if (b[0] === 192 && b[1] === 168) return true; // 192.168/16
  return false;
}

function v4FromW(w, i) {
  return [(w[i] >> 8) & 0xff, w[i] & 0xff, (w[i + 1] >> 8) & 0xff, w[i + 1] & 0xff];
}

function v6Blocked(bytes) {
  const w = [];
  for (let i = 0; i < 8; i++) w.push((bytes[i * 2] << 8) | bytes[i * 2 + 1]);
  if (w.every((x) => x === 0)) return true; // ::/128 unspecified
  if (w[7] === 1 && w.slice(0, 7).every((x) => x === 0)) return true; // ::1 loopback
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
    return v4Blocked(v4FromW(w, 6)); // ::ffff:0:0/96 — ipv4-mapped, check embedded v4
  }
  if (w[0] === 0x2002) return v4Blocked(v4FromW(w, 1)); // 2002::/16 — 6to4, check embedded v4
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((w[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Parse + SSRF-assert a public URL. Throws "public web only" before any socket. */
export function parsePublicUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("bad url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("need http(s)");
  let host = (u.hostname || "").toLowerCase();
  if (host.length > 1 && host.endsWith(".")) host = host.slice(0, -1); // trailing-dot evasion
  if (!host) throw new Error("bad url");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("public web only");
  }
  const bare = stripBrackets(host);
  const b4 = ipv4Bytes(bare);
  if (b4) {
    if (v4Blocked(b4)) throw new Error("public web only");
    return u;
  }
  if (bare.includes(":")) {
    const b6 = ipv6Bytes(bare);
    if (!b6 || v6Blocked(b6)) throw new Error("public web only");
    return u;
  }
  return u;
}

function assertPublic(url) {
  return parsePublicUrl(url).toString();
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

function bodyToObject(data) {
  if (data == null) return {};
  if (typeof data === "object") return data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data || "{}");
    } catch {
      return { raw: data };
    }
  }
  return {};
}

function bodyToText(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function headerGet(headers, name) {
  if (!headers) return "";
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === want) {
      const v = headers[k];
      return Array.isArray(v) ? String(v[0] || "") : String(v || "");
    }
  }
  return "";
}

async function nativeRequest(method, url, headers, body, timeoutMs, manualRedirects = false) {
  const http = nativeHttp();
  if (!http) return null;
  const req = {
    url,
    method: method.toUpperCase(),
    headers: { "User-Agent": UA, Accept: "application/json,text/html,*/*", ...headers },
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
    disableRedirects: Boolean(manualRedirects),
  };
  if (body !== undefined) {
    req.data = typeof body === "string" ? body : JSON.stringify(body);
    req.headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    if (typeof http.request === "function") {
      res = await http.request(req);
    } else if (method === "POST" && typeof http.post === "function") {
      res = await http.post(req);
    } else if (method === "GET" && typeof http.get === "function") {
      res = await http.get(req);
    } else {
      return null;
    }
  } catch (e) {
    const err = new Error(String(e?.message || e || "native http failed"));
    err.status = 0;
    throw err;
  }
  return {
    status: Number(res?.status) || 0,
    data: res?.data,
    headers: res?.headers || {},
    url: res?.url || url,
  };
}

/** One fetch attempt, no redirect following. Normalized step for the manual loop. */
async function attemptOnce(method, target, headers, body, timeoutMs) {
  const native = await nativeRequest(method, target, headers, body, timeoutMs, true);
  if (native) {
    return {
      status: native.status,
      headers: native.headers || {},
      url: native.url || target,
      bodyText: async () => bodyToText(native.data),
      bodyJson: async () => bodyToObject(native.data),
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = {
      method,
      signal: ctrl.signal,
      redirect: "manual",
      headers: { "User-Agent": UA, ...headers },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(target, init);
    const outHeaders = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    return {
      status: res.status,
      headers: outHeaders,
      url: target,
      bodyText: async () => {
        try {
          return await res.text();
        } catch {
          return "";
        }
      },
      bodyJson: async () => {
        try {
          return await res.json();
        } catch {
          return {};
        }
      },
    };
  } catch (e) {
    const msg = String(e?.message || e || "fetch failed");
    if (/abort/i.test(msg)) throw new Error("timeout");
    throw new Error(`fetch failed — ${msg.slice(0, 100)}`);
  } finally {
    clearTimeout(t);
  }
}

const MAX_REDIRECTS = 5;

/**
 * Public fetch with MANUAL redirect following — the SSRF guard
 * (parsePublicUrl) is re-asserted on every hop, so a public URL that
 * 302s to 192.168.x.x / 169.254.x.x / [::1] / :7420 is refused before
 * any socket opens to the target. Throws "public web only" on violation.
 */
async function followPublicRedirects(method, url, headers, body, timeoutMs) {
  let current = parsePublicUrl(url);
  let m = String(method || "GET").toUpperCase();
  let b = body;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const step = await attemptOnce(m, current.toString(), headers, b, timeoutMs);
    const status = step.status;
    if (status >= 300 && status < 400 && status !== 304) {
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      const loc = headerGet(step.headers, "location");
      try {
        await step.bodyText();
      } catch {
        /* drain, don't leak sockets */
      }
      if (!loc) {
        const err = new Error(`redirect ${status} without location`);
        err.status = status;
        throw err;
      }
      let next;
      try {
        next = new URL(loc, current.toString());
      } catch {
        throw new Error("bad redirect target");
      }
      current = parsePublicUrl(next.toString()); // re-assert EVERY hop
      if (status === 301 || status === 302 || status === 303) {
        m = "GET";
        b = undefined; // classic redirect semantics: POST becomes GET
      }
      continue;
    }
    return { ...step, url: current.toString() };
  }
  throw new Error("too many redirects");
}

async function request(method, url, headers, body, timeoutMs, assertFn) {
  const publicCall = assertFn === assertPublic;

  if (publicCall) {
    // Public path — manual redirects with per-hop SSRF re-assertion.
    const step = await followPublicRedirects(method, url, headers, body, timeoutMs);
    const status = step.status;
    const data = await step.bodyJson();
    const cookie = parseCookie(headerGet(step.headers, "set-cookie"));
    if (cookie) data._cookie = cookie;
    if (!status) {
      const err = new Error("network failed — check mobile data/Wi‑Fi · Proton may be blocking this API");
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

  const target = assertFn(url);

  const native = await nativeRequest(method, target, headers, body, timeoutMs);
  if (native) {
    const status = native.status;
    const data = bodyToObject(native.data);
    let cookie = "";
    for (const [k, v] of Object.entries(native.headers || {})) {
      if (/^set-cookie$/i.test(k)) {
        cookie = parseCookie(v);
        if (cookie) break;
      }
    }
    if (cookie) data._cookie = cookie;
    if (!status) {
      const err = new Error("network failed — Proton: Allow LAN connections · or same Wi‑Fi · Open-Firewall.bat as Admin");
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

  // Web / browser preview — CORS may block cloud APIs.
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
      const err = new Error(String(detail).slice(0, 180));
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e && e.status != null) throw e;
    const msg = String(e?.message || e || "fetch failed");
    if (/abort/i.test(msg)) throw new Error("timeout");
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }
}

export async function httpGet(url, timeoutMs = 14000, extraHeaders = {}) {
  const headers = { Accept: "text/html,application/json,*/*", ...extraHeaders };
  const step = await followPublicRedirects("GET", url, headers, undefined, timeoutMs);
  const status = step.status;
  if (!status) throw new Error("network failed — check data/Wi‑Fi · Proton may block this API");
  if (status >= 400) throw new Error(`fetch ${status}`);
  return { url: step.url, status, body: await step.bodyText() };
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
  // The bind decision is the user's (M1): prompt/allow/never — never silent.
  let bound = false;
  try {
    bound = await decideLanBind();
  } catch {
    bound = false;
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
