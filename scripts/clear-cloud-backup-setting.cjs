/**
 * Clears cloud backup identity so Enable Cloud Backup can run again.
 * Run only when Electron/POS is fully stopped.
 */
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", ".user-data", "data", "restaurant-pos.sqlite");
const db = new Database(dbPath);
const result = db.prepare("DELETE FROM settings WHERE key = ?").run("config:cloud-backup");
db.close();

console.log(`Removed config:cloud-backup rows: ${result.changes}`);
console.log("Done. Next: npm run rebuild:electron (if needed), then npm start.");
