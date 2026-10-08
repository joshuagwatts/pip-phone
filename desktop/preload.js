/** PIP desktop preload — the ONLY Node bridge the renderer gets.
 *
 * Surface is deliberately minimal: one function, pipShell.exec(command, timeoutMs).
 * It runs the command via the OS shell with a hard timeout, captures
 * stdout/stderr (capped), and returns a plain result object. No filesystem
 * handles, no process control, no env access.
 *
 * Safety rails live one layer up (www/tools.js): the renderer shows the exact
 * command and requires the operator's tap per command-pattern per session, and
 * every invocation is appended to the on-device run log. The preload itself
 * enforces: non-empty string commands only, 4000-char cap, 1s–120s timeout
 * clamp, 64KB output cap per stream.
 */

const { contextBridge } = require("electron");
const { exec } = require("child_process");

const MAX_OUT = 64 * 1024;
const MAX_CMD = 4000;

function runShell(cmd, timeoutMs) {
  return new Promise((resolve) => {
    const finish = (code, stdout, stderr, timedOut) =>
      resolve({
        code: Number(code) || 0,
        stdout: String(stdout || "").slice(0, MAX_OUT),
        stderr: String(stderr || "").slice(0, MAX_OUT),
        timedOut: Boolean(timedOut),
      });
    if (typeof cmd !== "string" || !cmd.trim()) {
      finish(-1, "", "empty command", false);
      return;
    }
    const command = cmd.trim().slice(0, MAX_CMD);
    const t = Number(timeoutMs);
    const timeout = Math.min(Math.max(Number.isFinite(t) ? t : 60000, 1000), 120000);
    exec(command, { timeout, maxBuffer: MAX_OUT * 2, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof err.code === "number" ? err.code : 1;
        finish(code, stdout, stderr || String(err.message || err), Boolean(err.killed));
        return;
      }
      finish(0, stdout, stderr, false);
    });
  });
}

try {
  contextBridge.exposeInMainWorld("pipShell", {
    exec: (cmd, timeoutMs) => runShell(cmd, timeoutMs),
  });
} catch {
  /* not running under Electron — window.pipShell stays undefined and the
     renderer reports shell as unavailable (see www/shell.js) */
}
