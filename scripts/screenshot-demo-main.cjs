require("ts-node/register/transpile-only");

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const dbPath = process.env.POS_DB_PATH_OVERRIDE;
if (!dbPath) {
  console.error("POS_DB_PATH_OVERRIDE is required");
  app.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${dbPath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
  }
}
const dataDir = path.dirname(dbPath);
for (const name of ["operations-live.json", "operations-restore.json"]) {
  fs.rmSync(path.join(dataDir, name), { force: true });
}

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.whenReady().then(async () => {
  try {
    const { initializeDatabase, closeDb } = require("../electron/db/sqlite.ts");
    const { seed } = require("./screenshot-demo-data.cjs");
    const db = await initializeDatabase();
    const summary = db.transaction(() => seed(db))();
    closeDb();
    console.log(JSON.stringify(summary));
    app.exit(0);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  }
});
