const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function create() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 400,
    minHeight: 640,
    backgroundColor: "#0a0f0a",
    title: "Pip",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Hunt reads public apply pages. file:// has CORS; this is the desktop
      // stand-in for Capacitor's native GET. Nothing is posted to forms.
      webSecurity: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadFile(path.join(__dirname, "..", "www", "index.html"));
}

const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(create);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) create();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
