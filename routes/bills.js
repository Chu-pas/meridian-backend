const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../utils/db");
const requireAuth = require("../utils/authMiddleware");
const { payBill } = require("../utils/flutterwave");

const router = express.Router();

// type examples from Flutterwave: AIRTIME, DSTV, GOTV, PHCN (electricity), etc.
router.post("/pay", requireAuth, async (req, res) => {
  const { type, billerName, customer, amount } = req.body;
  const numericAmount = Number(amount);

  const user = db.findOne("users", (u) => u.id === req.userId);

  if (!type || !customer || !numericAmount) {
    return res.status(400).json({ error: "Missing bill type, customer detail, or amount." });
  }
  if (user.balance < numericAmount) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  const reference = `BILL-${uuid()}`;

  try {
    await payBill({
      country: "NG",
      customer,
      amount: numericAmount,
      type,
      reference,
      biller_name: billerName,
    });

    db.update("users", (u) => u.id === user.id, { balance: user.balance - numericAmount });

    db.insert("transactions", {
      id: uuid(),
      userId: user.id,
      type: "debit",
      category: "bill",
      amount: numericAmount,
      counterparty: `${billerName} (${customer})`,
      reference,
      status: "successful",
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, reference });
  } catch (err) {
    res.status(400).json({ error: "That payment didn't go through. Check the details and try again." });
  }
});

module.exports = router;
