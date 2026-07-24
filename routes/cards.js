const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../utils/db");
const requireAuth = require("../utils/authMiddleware");
const { createVirtualCard } = require("../utils/flutterwave");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const cards = db.findMany("cards", (c) => c.userId === req.userId);
  // never send full card numbers back to the client - mask everything except last 4
  const masked = cards.map((c) => ({
    ...c,
    cardNumber: c.cardNumber ? `**** **** **** ${c.cardNumber.slice(-4)}` : null,
    cvv: undefined,
  }));
  res.json(masked);
});

router.post("/request", requireAuth, async (req, res) => {
  const { fundingAmount } = req.body;
  const numericAmount = Number(fundingAmount);

  const user = db.findOne("users", (u) => u.id === req.userId);

  if (!numericAmount || numericAmount < 500) {
    return res.status(400).json({ error: "Fund the card with at least ₦500 to create it." });
  }
  if (user.balance < numericAmount) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  try {
    const flwResponse = await createVirtualCard({
      currency: "NGN",
      amount: numericAmount,
      billing_name: user.fullName,
      debit_currency: "NGN",
    });

    const card = flwResponse.data;

    db.update("users", (u) => u.id === user.id, { balance: user.balance - numericAmount });

    const record = db.insert("cards", {
      id: uuid(),
      userId: user.id,
      flwCardId: card.id,
      cardNumber: card.card_pan || card.masked_pan,
      expiry: `${card.expiration}`,
      cardHolder: user.fullName,
      balance: numericAmount,
      status: "active",
      createdAt: new Date().toISOString(),
    });

    db.insert("transactions", {
      id: uuid(),
      userId: user.id,
      type: "debit",
      category: "card",
      amount: numericAmount,
      counterparty: "Virtual card funding",
      reference: `CARD-${uuid()}`,
      status: "successful",
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ ...record, cardNumber: `**** **** **** ${record.cardNumber.slice(-4)}` });
  } catch (err) {
    res.status(400).json({ error: "Couldn't create the card right now. Try again shortly." });
  }
});

module.exports = router;
