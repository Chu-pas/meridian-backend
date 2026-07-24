// Small file-based store so the app runs out of the box with zero setup.
// IMPORTANT: swap this out for Postgres or MongoDB before you let real users
// touch this thing - a JSON file will not survive concurrent writes or a
// server restart at scale, and it has no transaction safety for money moves.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILES = {
  users: path.join(DATA_DIR, "users.json"),
  transactions: path.join(DATA_DIR, "transactions.json"),
  savings: path.join(DATA_DIR, "savings.json"),
  cards: path.join(DATA_DIR, "cards.json"),
};

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]");
  }
}

Object.values(FILES).forEach(ensureFile);

function readAll(table) {
  return JSON.parse(fs.readFileSync(FILES[table], "utf-8"));
}

function writeAll(table, records) {
  fs.writeFileSync(FILES[table], JSON.stringify(records, null, 2));
}

function insert(table, record) {
  const records = readAll(table);
  records.push(record);
  writeAll(table, records);
  return record;
}

function findOne(table, predicate) {
  return readAll(table).find(predicate);
}

function findMany(table, predicate) {
  return readAll(table).filter(predicate);
}

function update(table, predicate, changes) {
  const records = readAll(table);
  const idx = records.findIndex(predicate);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...changes };
  writeAll(table, records);
  return records[idx];
}

module.exports = { readAll, writeAll, insert, findOne, findMany, update };
