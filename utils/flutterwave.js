const axios = require("axios");

const flw = axios.create({
  baseURL: "https://api.flutterwave.com/v3",
  headers: {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
});

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

async function resolveAccount({ account_number, account_bank }) {
  const { data } = await flw.post("/accounts/resolve", {
    account_number,
    account_bank,
  });
  return data;
}

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

async function createVirtualCard({ currency, amount, billing_name, debit_currency }) {
  const { data } = await flw.post("/virtual-cards", {
    currency,
    amount,
    billing_name,
    debit_currency,
  });
  return data;
}

async function verifyTransaction(transactionId) {
  const { data } = await flw.get(`/transactions/${transactionId}/verify`);
  return data;
}

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

async function verifyByReference(tx_ref) {
  const { data } = await flw.get(`/transactions/verify_by_reference?tx_ref=${tx_ref}`);
  return data;
}

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