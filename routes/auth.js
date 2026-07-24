const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const db = require("../utils/db");
const requireAuth = require("../utils/authMiddleware");

const router = express.Router();

// Nigerian bank account numbers are 10 digits - reuse this as a fake
// wallet/account number generator for the demo so it feels real
function generateAccountNumber() {
  let num = "";
  for (let i = 0; i < 10; i++) num += Math.floor(Math.random() * 10);
  return num;
}

router.post("/signup", async (req, res) => {
  const {
    fullName, dob, email, phone, occupation, address, city, state, postalCode,
    nokName, nokRelationship, nokPhone, password,
  } = req.body;

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({ error: "Fill in your name, email, phone and password." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password needs to be at least 6 characters." });
  }

  const existing = db.findOne("users", (u) => u.email === email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    id: uuid(),
    fullName,
    dob: dob || null,
    email: email.toLowerCase(),
    phone,
    occupation: occupation || null,
    address: address || null,
    city: city || null,
    state: state || null,
    postalCode: postalCode || null,
    nextOfKin: {
      name: nokName || null,
      relationship: nokRelationship || null,
      phone: nokPhone || null,
    },
    passwordHash,
    accountNumber: generateAccountNumber(),
    balance: 0,
    pin: null, // set later via /set-pin, used to authorize transfers
    createdAt: new Date().toISOString(),
  };

  db.insert("users", user);

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

  res.status(201).json({
    token,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      accountNumber: user.accountNumber,
      balance: user.balance,
    },
  });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = db.findOne("users", (u) => u.email === (email || "").toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "Wrong email or password." });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: "Wrong email or password." });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

  res.json({
    token,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      accountNumber: user.accountNumber,
      balance: user.balance,
    },
  });
});

router.post("/set-pin", requireAuth, async (req, res) => {
  const { pin } = req.body;
  if (!/^\d{4}$/.test(pin || "")) {
    return res.status(400).json({ error: "PIN needs to be exactly 4 digits." });
  }
  const pinHash = await bcrypt.hash(pin, 10);
  db.update("users", (u) => u.id === req.userId, { pin: pinHash });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.findOne("users", (u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    accountNumber: user.accountNumber,
    balance: user.balance,
  });
});

module.exports = router;
