require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuid } = require("uuid");

const db = require("./utils/db");

// Routes
const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const savingsRoutes = require("./routes/savings");
const billsRoutes = require("./routes/bills");
const cardsRoutes = require("./routes/cards");
const transactionsRoutes = require("./routes/transactions");

const app = express();

// Global Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// Health Check
app.get("/", (req, res) => {
  res.json({ status: "Chucks Bank API is running" });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/savings", savingsRoutes);
app.use("/api/bills", billsRoutes);
app.use("/api/cards", cardsRoutes);
app.use("/api/transactions", transactionsRoutes);

/**
 * Flutterwave Webhook Handler
 * Credits a user's wallet when an incoming bank transfer is received.
 */
app.post("/api/webhook/flutterwave", (req, res) => {
  const signature = req.headers["verif-hash"];

  // Verify signature matching environment secret
  if (!signature || signature !== process.env.FLW_WEBHOOK_HASH) {
    return res.status(401).end();
  }

  const event = req.body;
  const data = event.data || {};

  // Filter for incoming successful bank transfers not triggered by manual wallet top-up checkout
  const isIncomingBankTransfer =
    event.event === "charge.completed" &&
    data.status === "successful" &&
    data.payment_type === "bank_transfer" &&
    !String(data.tx_ref || "").startsWith("FUND ");

  if (isIncomingBankTransfer && data.customer?.email) {
    const userEmail = data.customer.email.toLowerCase();
    const user = db.findOne("users", (u) => u.email === userEmail);
    const alreadyProcessed =
      data.flw_ref && db.findOne("transactions", (t) => t.reference === data.flw_ref);

    if (user && !alreadyProcessed) {
      // Update account balance
      db.update("users", (u) => u.id === user.id, {
        balance: user.balance + data.amount,
      });

      // Record successful transaction log
      db.insert("transactions", {
        id: uuid(),
        userId: user.id,
        type: "credit",
        category: "incoming_transfer",
        amount: data.amount,
        counterparty: data.customer.name || "Bank transfer",
        reference: data.flw_ref || `WEBHOOK-${uuid()}`,
        status: "successful",
        createdAt: new Date().toISOString(),
      });
    }
  }

  res.status(200).end();
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "That route doesn't exist." });
});

// Server Initialization
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Chucks Bank API listening on port ${PORT}`);
});
// Thin wrapper around the bits of the Flutterwave API this app actually uses.
// Docs: https://developer.flutterwave.com/docs
const axios = require("axios");

const flw = axios.create({
  baseURL: "https://api.flutterwave.com/v3",
  headers: {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

/**
 * Move money out to a bank account (used for wallet-to-bank transfers)
 */
async function sendTransfer({ bank_code, account_number, amount, narration, reference }) {
  const { data } = await flw.post("/transfers", {
    account_bank: bank_code,
    account_number,
    amount,
    narration,
    currency: "NGN",
    reference,
  });
  return data;
}

/**
 * Confirm the account name behind a bank/account number before a transfer
 */
async function resolveAccount({ account_number, account_bank }) {
  const { data } = await flw.post("/accounts/resolve", {
    account_number,
    account_bank,
  });
  return data;
}

/**
 * Buy airtime or pay a bill (electricity, cable TV, etc.)
 */
async function payBill({ country, customer, amount, type, reference, biller_name }) {
  const { data } = await flw.post("/bills", {
    country,
    customer,
    amount,
    type,
    reference,
    biller_name,
  });
  return data;
}

/**
 * Issue a virtual card for a customer
 */
async function createVirtualCard({ currency, amount, billing_name, debit_currency }) {
  const { data } = await flw.post("/virtual-cards", {
    currency,
    amount,
    billing_name,
    debit_currency,
  });
  return data;
}

/**
 * Verify a payment/transaction by its Flutterwave transaction id (call this
 * from your webhook handler and never trust the frontend's word alone)
 */
async function verifyTransaction(transactionId) {
  const { data } = await flw.get(`/transactions/${transactionId}/verify`);
  return data;
}

/**
 * Start a Standard Flutterwave Checkout session - this is how a user actually
 * pays money INTO their wallet (card, bank transfer, USSD, etc, all handled
 * by Flutterwave's hosted payment page)
 */
async function initiatePayment({ amount, email, name, reference, redirect_url }) {
  const { data } = await flw.post("/payments", {
    tx_ref: reference,
    amount,
    currency: "NGN",
    redirect_url,
    customer: { email, name },
    customizations: {
      title: "Fund Wallet",
      description: "Add money to your Ledger wallet",
    },
  });
  return data;
}

/**
 * Verify a payment by the tx_ref WE generated (more reliable after a redirect
 * than trusting the transaction_id query param, which can be spoofed)
 */
async function verifyByReference(tx_ref) {
  const { data } = await flw.get(`/transactions/verify_by_reference?tx_ref=${tx_ref}`);
  return data;
}

/**
 * Issue a real, permanent bank account number for a user - money sent to this
 * by anyone from any Nigerian bank actually lands here. Requires BVN by law
 * (CBN/NIBSS KYC rule) for a permanent account; without it Flutterwave will
 * only issue a one-time-use account, which isn't what we want here.
 */
async function createVirtualAccount({
  email,
  bvn,
  phonenumber,
  firstname,
  lastname,
  narration,
  tx_ref,
}) {
  const { data } = await flw.post("/virtual-account-numbers", {
    email,
    bvn,
    phonenumber,
    firstname,
    lastname,
    narration,
    tx_ref,
    is_permanent: true,
  });
  return data;
}

module.exports = {
  sendTransfer,
  resolveAccount,
  payBill,
  createVirtualCard,
  verifyTransaction,
  initiatePayment,
  verifyByReference,
  createVirtualAccount,
};
const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");

const db = require("../utils/db");
const requireAuth = require("../utils/authMiddleware");
const {
  resolveAccount,
  sendTransfer,
  initiatePayment,
  verifyByReference,
  createVirtualAccount,
} = require("../utils/flutterwave");

const router = express.Router();

/**
 * Start a real deposit - returns a Flutterwave checkout link the user pays on
 */
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

/**
 * Called when the user lands back on the app after paying - confirms with
 * Flutterwave directly rather than trusting the redirect params alone
 */
router.get("/fund/verify", requireAuth, async (req, res) => {
  const { reference } = req.query;
  const txn = db.findOne(
    "transactions",
    (t) => t.reference === reference && t.userId === req.userId
  );

  if (!txn) return res.status(404).json({ error: "No matching deposit found." });

  if (txn.status === "successful") {
    return res.json({
      ok: true,
      alreadyProcessed: true,
      newBalance: db.findOne("users", (u) => u.id === req.userId).balance,
    });
  }

  try {
    const flwRes = await verifyByReference(reference);
    const data = flwRes.data;

    if (
      data.status === "successful" &&
      data.tx_ref === reference &&
      Number(data.amount) >= txn.amount
    ) {
      const user = db.findOne("users", (u) => u.id === req.userId);
      db.update("users", (u) => u.id === user.id, {
        balance: user.balance + txn.amount,
      });
      db.update("transactions", (t) => t.id === txn.id, { status: "successful" });

      return res.json({ ok: true, newBalance: user.balance + txn.amount });
    }

    db.update("transactions", (t) => t.id === txn.id, { status: "failed" });
    res.status(400).json({ error: "Payment wasn't successful." });
  } catch (err) {
    res
      .status(400)
      .json({ error: "Couldn't verify that payment yet. Try again in a moment." });
  }
});

/**
 * Get user balance and internal account number
 */
router.get("/balance", requireAuth, (req, res) => {
  const user = db.findOne("users", (u) => u.id === req.userId);
  res.json({ balance: user.balance, accountNumber: user.accountNumber });
});

/**
 * Check whose account you're about to send money to before sending
 */
router.post("/resolve-account", requireAuth, async (req, res) => {
  const { accountNumber, bankCode } = req.body;
  try {
    const result = await resolveAccount({
      account_number: accountNumber,
      account_bank: bankCode,
    });
    res.json({ accountName: result.data.account_name });
  } catch (err) {
    res
      .status(400)
      .json({ error: "Couldn't verify that account. Check the details and try again." });
  }
});

/**
 * Internal transfer between app users (no external gateway needed)
 */
router.post("/transfer/internal", requireAuth, async (req, res) => {
  const { toAccountNumber, amount, pin, note } = req.body;
  const numericAmount = Number(amount);

  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({ error: "Enter a valid amount." });
  }

  const sender = db.findOne("users", (u) => u.id === req.userId);
  const recipient = db.findOne("users", (u) => u.accountNumber === toAccountNumber);

  if (!recipient) {
    return res.status(404).json({ error: "No account found with that number." });
  }
  if (recipient.id === sender.id) {
    return res.status(400).json({ error: "You can't send money to yourself." });
  }
  if (!sender.pin) {
    return res.status(400).json({ error: "Set a transaction PIN first." });
  }

  const pinMatches = await bcrypt.compare(pin || "", sender.pin);
  if (!pinMatches) {
    return res.status(401).json({ error: "Wrong PIN." });
  }
  if (sender.balance < numericAmount) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  // Perform transfer updates
  db.update("users", (u) => u.id === sender.id, {
    balance: sender.balance - numericAmount,
  });
  db.update("users", (u) => u.id === recipient.id, {
    balance: recipient.balance + numericAmount,
  });

  const reference = `TXN-${uuid()}`;

  // Log debit for sender
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

  // Log credit for recipient
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

/**
 * External transfer to a real bank account via Flutterwave
 */
router.post("/transfer/external", requireAuth, async (req, res) => {
  const { accountNumber, bankCode, amount, pin, note } = req.body;
  const numericAmount = Number(amount);
  const sender = db.findOne("users", (u) => u.id === req.userId);

  if (!sender.pin) {
    return res.status(400).json({ error: "Set a transaction PIN first." });
  }

  const pinMatches = await bcrypt.compare(pin || "", sender.pin);
  if (!pinMatches) {
    return res.status(401).json({ error: "Wrong PIN." });
  }

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

    // Debit user immediately & set transaction to pending pending gateway completion
    db.update("users", (u) => u.id === sender.id, {
      balance: sender.balance - numericAmount,
    });

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
    res.status(400).json({
      error: "Transfer failed. Double check the account details and try again.",
    });
  }
});

/**
 * Activate a permanent bank account number (Virtual Account) via Flutterwave
 */
router.post("/virtual-account/create", requireAuth, async (req, res) => {
  const { bvn } = req.body;
  const user = db.findOne("users", (u) => u.id === req.userId);

  if (!bvn || bvn.length !== 11) {
    return res.status(400).json({ error: "Enter a valid 11-digit BVN." });
  }
  if (user.virtualAccountNumber) {
    return res
      .status(400)
      .json({ error: "You already have an active account number." });
  }

  const [firstname, ...rest] = user.fullName.split(" ");
  const lastname = rest.join(" ") || firstname;

  try {
    const result = await createVirtualAccount({
      email: user.email,
      bvn,
      phonenumber: user.phone,
      firstname,
      lastname,
      narration: `${user.fullName} - Meridian`,
      tx_ref: `VA-${uuid()}`,
    });

    const accountNumber = result.data.account_number;
    const bankName = result.data.bank_name;

    db.update("users", (u) => u.id === user.id, {
      virtualAccountNumber: accountNumber,
      virtualAccountBank: bankName,
    });

    res.json({ accountNumber, bankName });
  } catch (err) {
    const message =
      err.response?.data?.message ||
      "Couldn't activate your account number. Double check your BVN and try again.";
    res.status(400).json({ error: message });
  }
});

/**
 * Retrieve Virtual Account information
 */
router.get("/virtual-account", requireAuth, (req, res) => {
  const user = db.findOne("users", (u) => u.id === req.userId);

  if (!user.virtualAccountNumber) {
    return res.json({ active: false });
  }

  res.json({
    active: true,
    accountNumber: user.virtualAccountNumber,
    bankName: user.virtualAccountBank,
  });
});

module.exports = router;
