const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const root = path.resolve(__dirname, "..");
const demoDir = path.join(root, ".screenshot-demo");
const dbPath = path.join(demoDir, "data", "restaurant-pos.sqlite");
const electronPath = require("electron");

function electronEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  env.TS_NODE_PROJECT = path.join(root, "tsconfig.electron.json");
  env.POS_DB_PATH_OVERRIDE = dbPath;
  env.POS_SCREENSHOT_USER_DATA = demoDir;
  return env;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with ${code}`));
    });
  });
}

function portOpen(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      const done = (open) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(open);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  return Promise.all([tryHost("127.0.0.1"), tryHost("::1")]).then((results) => results.some(Boolean));
}

async function main() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  console.log("Building the screenshot demo database…");
  await run(
    electronPath,
    [`--user-data-dir=${demoDir}`, path.join(root, "scripts", "screenshot-demo-main.cjs")],
    electronEnv(),
  );

  let viteUp = false;
  for (let attempt = 0; attempt < 8 && !viteUp; attempt += 1) {
    viteUp = await portOpen(5173);
    if (!viteUp) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!viteUp) {
    const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
    spawn(process.execPath, [viteBin, "--port", "5173", "--strictPort"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: false,
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await portOpen(5173)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  console.log("");
  console.log("Saffron House is opening. Your real restaurant data is unchanged.");
  console.log("Counter login: admin / Demo1234!");
  console.log("Captain login: captain / Captain1!");
  console.log("Floor: All Areas shows Ground Floor G1–G12 and First Floor F1–F8, with Available, Send KOT, and KOT sent on both floors.");
  console.log("GST bill: History, open the latest invoice. It shows GSTIN, CGST, SGST, and UPI.");
  console.log("Captain phone: open the gateway address from the counter, then table G5.");
  console.log("Sales: Reports, Today.");
  console.log("");

  const child = spawn(
    electronPath,
    [`--user-data-dir=${demoDir}`, path.join(root, "electron", "main-dev.cjs")],
    {
      cwd: root,
      env: electronEnv(),
      stdio: "inherit",
      windowsHide: false,
    },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
