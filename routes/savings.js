const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../utils/db");
const requireAuth = require("../utils/authMiddleware");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const goals = db.findMany("savings", (s) => s.userId === req.userId);
  res.json(goals);
});

router.post("/", requireAuth, (req, res) => {
  const { name, targetAmount, targetDate } = req.body;
  if (!name || !targetAmount) {
    return res.status(400).json({ error: "Give the goal a name and a target amount." });
  }

  const goal = {
    id: uuid(),
    userId: req.userId,
    name,
    targetAmount: Number(targetAmount),
    targetDate: targetDate || null,
    savedAmount: 0,
    createdAt: new Date().toISOString(),
  };

  db.insert("savings", goal);
  res.status(201).json(goal);
});

// Move money from the main wallet into a savings goal
router.post("/:id/fund", requireAuth, (req, res) => {
  const { amount } = req.body;
  const numericAmount = Number(amount);

  const user = db.findOne("users", (u) => u.id === req.userId);
  const goal = db.findOne("savings", (s) => s.id === req.params.id && s.userId === req.userId);

  if (!goal) return res.status(404).json({ error: "Savings goal not found." });
  if (!numericAmount || numericAmount <= 0) return res.status(400).json({ error: "Enter a valid amount." });
  if (user.balance < numericAmount) return res.status(400).json({ error: "Insufficient wallet balance." });

  db.update("users", (u) => u.id === user.id, { balance: user.balance - numericAmount });
  const updated = db.update(
    "savings",
    (s) => s.id === goal.id,
    { savedAmount: goal.savedAmount + numericAmount }
  );

  db.insert("transactions", {
    id: uuid(),
    userId: user.id,
    type: "debit",
    category: "savings",
    amount: numericAmount,
    counterparty: `Savings: ${goal.name}`,
    reference: `SAV-${uuid()}`,
    status: "successful",
    createdAt: new Date().toISOString(),
  });

  res.json(updated);
});

// Pull money back out of a goal into the main wallet
router.post("/:id/withdraw", requireAuth, (req, res) => {
  const { amount } = req.body;
  const numericAmount = Number(amount);

  const user = db.findOne("users", (u) => u.id === req.userId);
  const goal = db.findOne("savings", (s) => s.id === req.params.id && s.userId === req.userId);

  if (!goal) return res.status(404).json({ error: "Savings goal not found." });
  if (!numericAmount || numericAmount > goal.savedAmount) {
    return res.status(400).json({ error: "You can't withdraw more than you've saved." });
  }

  db.update("savings", (s) => s.id === goal.id, { savedAmount: goal.savedAmount - numericAmount });
  db.update("users", (u) => u.id === user.id, { balance: user.balance + numericAmount });

  res.json({ ok: true });
});

module.exports = router;
