const express = require("express");
const db = require("../utils/db");
const requireAuth = require("../utils/authMiddleware");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const { from, to, category } = req.query;

  let txns = db.findMany("transactions", (t) => t.userId === req.userId);

  if (from) txns = txns.filter((t) => new Date(t.createdAt) >= new Date(from));
  if (to) txns = txns.filter((t) => new Date(t.createdAt) <= new Date(to));
  if (category) txns = txns.filter((t) => t.category === category);

  txns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(txns);
});

// Simple statement summary - swap this for a generated PDF once you're
// past the demo stage (the pdf skill/pdfkit works well for that)
router.get("/statement", requireAuth, (req, res) => {
  const { from, to } = req.query;
  let txns = db.findMany("transactions", (t) => t.userId === req.userId);

  if (from) txns = txns.filter((t) => new Date(t.createdAt) >= new Date(from));
  if (to) txns = txns.filter((t) => new Date(t.createdAt) <= new Date(to));

  const totalIn = txns.filter((t) => t.type === "credit").reduce((sum, t) => sum + t.amount, 0);
  const totalOut = txns.filter((t) => t.type === "debit").reduce((sum, t) => sum + t.amount, 0);

  res.json({
    period: { from: from || "all-time", to: to || "now" },
    totalIn,
    totalOut,
    netChange: totalIn - totalOut,
    transactionCount: txns.length,
    transactions: txns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  });
});

module.exports = router;
