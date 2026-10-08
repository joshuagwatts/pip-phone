/** Renderer side of the desktop shell bridge.
 *
 * window.pipShell is exposed by desktop/preload.js (contextBridge) — it only
 * exists in the PIP desktop Electron app. Everywhere else (phone, web) this
 * module reports unavailable with an honest message instead of failing weird.
 */

export function shellAvailable() {
  try {
    return typeof window !== "undefined" && typeof window.pipShell?.exec === "function";
  } catch {
    return false;
  }
}

export function shellWhyNot() {
  return "shell is desktop-only — run /agent in the PIP desktop app to use it";
}

/**
 * Run a command on the desktop. Resolves { code, stdout, stderr, timedOut }.
 * Every invocation is logged by the caller (tools.js run log).
 */
export async function shellExec(command, { timeoutMs = 60000 } = {}) {
  if (!shellAvailable()) throw new Error(shellWhyNot());
  const out = await window.pipShell.exec(String(command || ""), timeoutMs);
  return {
    code: Number(out && out.code) || 0,
    stdout: String((out && out.stdout) || ""),
    stderr: String((out && out.stderr) || ""),
    timedOut: Boolean(out && out.timedOut),
  };
}
