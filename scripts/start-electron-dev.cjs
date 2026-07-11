const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const electronPath = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.TS_NODE_PROJECT = path.join(root, "tsconfig.electron.json");

const child = spawn(electronPath, [path.join(root, "electron", "main-dev.cjs")], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
