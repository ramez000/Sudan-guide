const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "../../data");
const dbPath = path.join(dataDir, "db.json");
const seedPath = path.join(dataDir, "seed.json");

function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.copyFileSync(seedPath, dbPath);
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  const temp = `${dbPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(temp, dbPath);
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

module.exports = { readDb, writeDb, id, dbPath };
