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

// Move money out to a bank account (used for wallet-to-bank transfers)
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

// Confirm the account name behind a bank/account number before a transfer
async function resolveAccount({ account_number, account_bank }) {
  const { data } = await flw.post("/accounts/resolve", {
    account_number,
    account_bank,
  });
  return data;
}

// Buy airtime or pay a bill (electricity, cable TV, etc.)
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

// Issue a virtual card for a customer
async function createVirtualCard({ currency, amount, billing_name, debit_currency }) {
  const { data } = await flw.post("/virtual-cards", {
    currency,
    amount,
    billing_name,
    debit_currency,
  });
  return data;
}

// Verify a payment/transaction by its Flutterwave transaction id (call this
// from your webhook handler and never trust the frontend's word alone)
async function verifyTransaction(transactionId) {
  const { data } = await flw.get(`/transactions/${transactionId}/verify`);
  return data;
}

// Start a Standard Flutterwave Checkout session - this is how a user actually
// pays money INTO their wallet (card, bank transfer, USSD, etc, all handled
// by Flutterwave's hosted payment page)
async function initiatePayment({ amount, email, name, reference, redirect_url }) {
  const { data } = await flw.post("/payments", {
    tx_ref: reference,
    amount,
    currency: "NGN",
    redirect_url,
    customer: { email, name },
    customizations: { title: "Fund Wallet", description: "Add money to your Ledger wallet" },
  });
  return data;
}

// Verify a payment by the tx_ref WE generated (more reliable after a redirect
// than trusting the transaction_id query param, which can be spoofed)
async function verifyByReference(tx_ref) {
  const { data } = await flw.get(`/transactions/verify_by_reference?tx_ref=${tx_ref}`);
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
};
