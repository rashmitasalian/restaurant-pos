import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { isPlaintextSqliteFile } from "./databaseKey";
import { migratePlaintextDatabase } from "./sqlcipher";

function createPlainDatabase(directory: string) {
  const Database = require("better-sqlite3-multiple-ciphers");
  const databasePath = path.join(directory, "restaurant-pos.sqlite");
  const database = new Database(databasePath);
  database.exec("CREATE TABLE dishes (name TEXT)");
  database.prepare("INSERT INTO dishes (name) VALUES (?)").run("Butter Naan");
  database.close();
  return databasePath;
}

describe("sqlcipher migration", () => {
  it("replaces a plaintext database only after the encrypted copy opens", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pos-sqlcipher-"));
    const databasePath = createPlainDatabase(directory);
    const key = randomBytes(32);
    migratePlaintextDatabase(databasePath, key);

    expect(isPlaintextSqliteFile(databasePath)).toBe(false);
    expect(fs.readdirSync(directory).some((name) => name.includes("plaintext"))).toBe(false);

    const Database = require("better-sqlite3-multiple-ciphers");
    const opened = new Database(databasePath);
    opened.pragma("cipher='sqlcipher'");
    opened.pragma("legacy=4");
    opened.pragma(`key="x'${key.toString("hex")}'"`);
    expect(opened.prepare("SELECT name FROM dishes").get()).toEqual({ name: "Butter Naan" });
    expect(opened.pragma("integrity_check", { simple: true })).toBe("ok");
    opened.close();

    const withoutKey = new Database(databasePath);
    expect(() => withoutKey.prepare("SELECT name FROM dishes").get()).toThrow(/not a database/i);
    withoutKey.close();
  });
});
