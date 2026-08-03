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

// Global Middleware - Fixes CORS for all requests
app.use(cors());
app.use(express.json());

// Health Check Route
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

// Server Listening
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
