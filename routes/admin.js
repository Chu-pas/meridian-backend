// Simple admin route to see who has signed up.
// Protect it with a password stored in your .env as ADMIN_PASSWORD.

const express = require("express");
const router = express.Router();
const db = require("../utils/db");

function requireAdmin(req, res, next) {
  const provided = req.query.key || req.headers["x-admin-key"];
  if (!process.env.ADMIN_PASSWORD || provided !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Not authorized." });
  }
  next();
}

// GET /api/admin/users?key=YOUR_ADMIN_PASSWORD
router.get("/users", requireAdmin, async (req, res) => {
  const users = await db.readAll("users");

  const safeUsers = users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    accountNumber: u.accountNumber,
    balance: u.balance,
    city: u.city,
    state: u.state,
    country: u.country,
    createdAt: u.createdAt,
    // password and PIN are deliberately left out
  }));

  // newest first
  safeUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ count: safeUsers.length, users: safeUsers });
});

module.exports = router;
