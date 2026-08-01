require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuid } = require("uuid");
const axios = require("axios");

const db = require("./utils/db");

// Routes
const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const savingsRoutes = require("./routes/savings");
const billsRoutes = require("./routes/bills");
const cardsRoutes = require("./routes/cards");
const transactionsRoutes = require("./routes/transactions");
const adminRoutes = require("./routes/admin");
const app = express();

// Global Middleware
app.use(cors({
  origin: ['https://chu-pas.github.io', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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
app.use("/api/admin", adminRoutes);
/**
 * Flutterwave Webhook Handler
 * Credits a user's wallet when an incoming bank transfer is received.
 */
app.post("/api/webhook/flutterwave", async (req, res) => {
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
    !String(data.tx_ref || "").startsWith("FUND_");

  if (isIncomingBankTransfer && data.customer?.email) {
    const userEmail = data.customer.email.toLowerCase();
    const user = await db.findOne("users", (u) => u.email === userEmail);
    const alreadyProcessed =
      data.flw_ref && (await db.findOne("transactions", (t) => t.reference === data.flw_ref));

    if (user && !alreadyProcessed) {
      // Update account balance
      await db.update("users", (u) => u.id === user.id, {
        balance: user.balance + data.amount,
      });

      // Record successful transaction log
      await db.insert("transactions", {
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
