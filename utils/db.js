// Now backed by MongoDB Atlas instead of local JSON files.
// IMPORTANT: every function here is now ASYNC (returns a Promise).
// Anywhere you call db.readAll(), db.insert(), db.findOne(), db.findMany(),
// or db.update() in your route files, you now need to add "await" in front
// of it, and the surrounding function needs to be "async".

const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not set. Add it in your Render Environment settings.");
}

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }
  return clientPromise;
}

async function getDb() {
  const client = await getClient();
  return client.db(); // uses the database name from the connection string
}

async function readAll(table) {
  const db = await getDb();
  return db.collection(table).find({}).toArray();
}

async function writeAll(table, records) {
  const db = await getDb();
  const collection = db.collection(table);
  await collection.deleteMany({});
  if (records.length > 0) {
    await collection.insertMany(records);
  }
  return records;
}

async function insert(table, record) {
  const db = await getDb();
  await db.collection(table).insertOne(record);
  return record;
}

async function findOne(table, predicate) {
  const all = await readAll(table);
  return all.find(predicate) || null;
}

async function findMany(table, predicate) {
  const all = await readAll(table);
  return all.filter(predicate);
}

async function update(table, predicate, changes) {
  const all = await readAll(table);
  const found = all.find(predicate);
  if (!found) return null;

  const merged = { ...found, ...changes };
  const db = await getDb();
  await db.collection(table).updateOne({ id: found.id }, { $set: changes });
  return merged;
}

module.exports = { readAll, writeAll, insert, findOne, findMany, update };
