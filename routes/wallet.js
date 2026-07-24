const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const db = require("../utils/db");
const requireAuth = require("../utils/authMiddleware");
const { resolveAccount, sendTransfer, initiatePayment, verifyByReference } = require("../utils/flutterwave");

const router = express.Router();

// Start a real deposit - returns a Flutterwave checkout link the user pays on
router.post("/fund/initiate", requireAuth, async (req, res) => {
  const { amount, redirectBase } = req.body;
  const numericAmount = Number(amount);

  if (!numericAmount || numericAmount < 100) {
    return res.status(400).json({ error: "Enter at least ₦100 to fund your wallet." });
  }

  const user = db.findOne("users", (u) => u.id === req.userId);
  const reference = `FUND-${uuid()}`;
  const base = redirectBase || process.env.FRONTEND_URL;

  try {
    const result = await initiatePayment({
      amount: numericAmount,
      email: user.email,
      name: user.fullName,
      reference,
      redirect_url: `${base}?fund_ref=${reference}`,
    });

    db.insert("transactions", {
      id: uuid(),
      userId: user.id,
      type: "credit",
      category: "deposit",
      amount: numericAmount,
      counterparty: "Wallet funding",
      reference,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({ link: result.data.link, reference });
  } catch (err) {
    res.status(400).json({ error: "Couldn't start that payment. Try again shortly." });
  }
});

// Called when the user lands back on the app after paying - confirms with
// Flutterwave directly rather than trusting the redirect params alone
router.get("/fund/verify", requireAuth, async (req, res) => {
  const { reference } = req.query;

  const txn = db.findOne("transactions", (t) => t.reference === reference && t.userId === req.userId);
  if (!txn) return res.status(404).json({ error: "No matching deposit found." });

  if (txn.status === "successful") {
    return res.json({ ok: true, alreadyProcessed: true, newBalance: db.findOne("users", (u) => u.id === req.userId).balance });
  }

  try {
    // Flutterwave's verify-by-reference isn't in our thin wrapper yet, so we
    // call the search-by-tx_ref style verify through the same helper's flw client indirectly
    const flwRes = await verifyByReference(reference);
    const data = flwRes.data;

    if (data.status === "successful" && data.tx_ref === reference && Number(data.amount) >= txn.amount) {
      const user = db.findOne("users", (u) => u.id === req.userId);
      db.update("users", (u) => u.id === user.id, { balance: user.balance + txn.amount });
      db.update("transactions", (t) => t.id === txn.id, { status: "successful" });
      return res.json({ ok: true, newBalance: user.balance + txn.amount });
    }

    db.update("transactions", (t) => t.id === txn.id, { status: "failed" });
    res.status(400).json({ error: "Payment wasn't successful." });
  } catch (err) {
    res.status(400).json({ error: "Couldn't verify that payment yet. Try again in a moment." });
  }
});

router.get("/balance", requireAuth, (req, res) => {
  const user = db.findOne("users", (u) => u.id === req.userId);
  res.json({ balance: user.balance, accountNumber: user.accountNumber });
});

// Check whose account you're about to send money to, before you send it
router.post("/resolve-account", requireAuth, async (req, res) => {
  const { accountNumber, bankCode } = req.body;
  try {
    const result = await resolveAccount({ account_number: accountNumber, account_bank: bankCode });
    res.json({ accountName: result.data.account_name });
  } catch (err) {
    res.status(400).json({ error: "Couldn't verify that account. Check the details and try again." });
  }
});

// Money between two users of this app - stays internal, no Flutterwave call needed
router.post("/transfer/internal", requireAuth, async (req, res) => {
  const { toAccountNumber, amount, pin, note } = req.body;
  const numericAmount = Number(amount);

  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({ error: "Enter a valid amount." });
  }

  const sender = db.findOne("users", (u) => u.id === req.userId);
  const recipient = db.findOne("users", (u) => u.accountNumber === toAccountNumber);

  if (!recipient) return res.status(404).json({ error: "No account found with that number." });
  if (recipient.id === sender.id) return res.status(400).json({ error: "You can't send money to yourself." });
  if (!sender.pin) return res.status(400).json({ error: "Set a transaction PIN first." });

  const pinMatches = await bcrypt.compare(pin || "", sender.pin);
  if (!pinMatches) return res.status(401).json({ error: "Wrong PIN." });

  if (sender.balance < numericAmount) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  db.update("users", (u) => u.id === sender.id, { balance: sender.balance - numericAmount });
  db.update("users", (u) => u.id === recipient.id, { balance: recipient.balance + numericAmount });

  const reference = `TXN-${uuid()}`;

  db.insert("transactions", {
    id: uuid(),
    userId: sender.id,
    type: "debit",
    category: "transfer",
    amount: numericAmount,
    counterparty: recipient.fullName,
    note: note || "",
    reference,
    status: "successful",
    createdAt: new Date().toISOString(),
  });

  db.insert("transactions", {
    id: uuid(),
    userId: recipient.id,
    type: "credit",
    category: "transfer",
    amount: numericAmount,
    counterparty: sender.fullName,
    note: note || "",
    reference,
    status: "successful",
    createdAt: new Date().toISOString(),
  });

  res.json({ ok: true, newBalance: sender.balance - numericAmount, reference });
});

// Money out to an external bank account - this one goes through Flutterwave
router.post("/transfer/external", requireAuth, async (req, res) => {
  const { accountNumber, bankCode, amount, pin, note } = req.body;
  const numericAmount = Number(amount);

  const sender = db.findOne("users", (u) => u.id === req.userId);

  if (!sender.pin) return res.status(400).json({ error: "Set a transaction PIN first." });
  const pinMatches = await bcrypt.compare(pin || "", sender.pin);
  if (!pinMatches) return res.status(401).json({ error: "Wrong PIN." });

  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({ error: "Enter a valid amount." });
  }
  if (sender.balance < numericAmount) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  const reference = `EXT-${uuid()}`;

  try {
    const flwResponse = await sendTransfer({
      bank_code: bankCode,
      account_number: accountNumber,
      amount: numericAmount,
      narration: note || "Transfer from Chucks Bank",
      reference,
    });

    // Flutterwave transfers are usually processed async - mark it pending
    // and let your webhook flip it to successful/failed when it hears back
    db.update("users", (u) => u.id === sender.id, { balance: sender.balance - numericAmount });

    db.insert("transactions", {
      id: uuid(),
      userId: sender.id,
      type: "debit",
      category: "bank_transfer",
      amount: numericAmount,
      counterparty: accountNumber,
      note: note || "",
      reference,
      status: "pending",
      flwId: flwResponse.data?.id || null,
      createdAt: new Date().toISOString(),
    });

    res.json({ ok: true, status: "pending", reference });
  } catch (err) {
    res.status(400).json({ error: "Transfer failed. Double check the account details and try again." });
  }
});

module.exports = router;
