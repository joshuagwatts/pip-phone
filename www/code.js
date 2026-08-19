/** CODE tab orchestration — local overlay agent + desktop phone/www upgrade when paired. */
import { desktopConfigured } from "./desktop.js";
import { httpLanSSE } from "./net.js";
import { streamPhoneCode } from "./codeagent.js";
import { readFile, writeFile, clearOverlays, clearCodeChat, loadCodeChat } from "./codefs.js";

export async function loadFile(name) {
  return readFile(name);
}

export async function saveFile(name, body) {
  return writeFile(name, body);
}

export function getCodeChat() {
  return loadCodeChat();
}

export function resetCodeChat() {
  clearCodeChat();
}

export function resetOverlays() {
  clearOverlays();
}

/** Stream code apply — local overlay agent, or desktop phone/www when upgrade flag set. */
export async function* streamCodeApply(settings, { prompt, openPath, phoneUpgrade = false }) {
  if (desktopConfigured(settings) && phoneUpgrade) {
    yield* streamDesktopPhoneUpgrade(settings, prompt, openPath);
    return;
  }
  yield* streamPhoneCode(settings, prompt, openPath);
}

async function* streamDesktopPhoneUpgrade(settings, prompt, openPath) {
  const tok = String(settings.desktop_token || "").trim();
  const base = String(settings.desktop_url || "").replace(/\/+$/, "");
  const headers = tok ? { Cookie: `pip_gate=${tok}` } : {};
  for await (const ev of httpLanSSE(
    `${base}/api/code/apply`,
    headers,
    {
      prompt,
      open_path: openPath || null,
      phone_upgrade: true,
      self_upgrade: false,
    },
  )) {
    yield ev;
  }
}

export async function consumeCodeStream(gen, handlers) {
  const h = handlers || {};
  for await (const ev of gen) {
    if (ev.type === "status" && h.onStatus) h.onStatus(ev);
    else if (ev.type === "delta" && h.onDelta) h.onDelta(ev.text || "");
    else if (ev.type === "tool" && h.onTool) h.onTool(ev);
    else if (ev.type === "written" && h.onWritten) await h.onWritten(ev.path);
    else if (ev.type === "error" && h.onError) h.onError(ev.text || "");
    else if (ev.type === "done" && h.onDone) await h.onDone(ev);
  }
}
