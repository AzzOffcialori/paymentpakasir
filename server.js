require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pakasir API Configuration
const PAKASIR_BASE_URL = 'https://app.pakasir.com';
const PAKASIR_PROJECT = process.env.PAKASIR_PROJECT;
const PAKASIR_API_KEY = process.env.PAKASIR_API_KEY;

// ============================================
// CREATE PAYMENT - POST /api/create-payment
// ============================================
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount } = req.body;

    // Validasi input
    if (!amount || isNaN(amount) || amount < 500) {
      return res.status(400).json({
        success: false,
        message: 'Nominal minimal Rp500'
      });
    }

    const orderId = `INV-${Date.now()}`;
    const amountNum = parseInt(amount, 10);

    // Request ke Pakasir API (server-side, API key aman)
    const response = await fetch(
      `${PAKASIR_BASE_URL}/api/transactioncreate/qris`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          project: PAKASIR_PROJECT,
          order_id: orderId,
          amount: amountNum,
          api_key: PAKASIR_API_KEY
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Pakasir API Error:', data);
      return res.status(response.status).json({
        success: false,
        message: data.message || 'Gagal membuat transaksi'
      });
    }

    // Response dari Pakasir: { payment: { ... } }
    const payment = data.payment || data;

    return res.json({
      success: true,
      data: {
        order_id: payment.order_id,
        amount: payment.amount,
        fee: payment.fee,
        total_payment: payment.total_payment,
        payment_method: payment.payment_method,
        payment_number: payment.payment_number,
        expired_at: payment.expired_at,
        status: payment.status || 'pending'
      }
    });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

// ============================================
// CHECK STATUS - GET /api/check-status
// ============================================
app.get('/api/check-status', async (req, res) => {
  try {
    const { order_id, amount } = req.query;

    if (!order_id || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Parameter order_id dan amount wajib diisi'
      });
    }

    // Request ke Pakasir API (server-side)
    const response = await fetch(
      `${PAKASIR_BASE_URL}/api/transactiondetail?` +
      `project=${encodeURIComponent(PAKASIR_PROJECT)}` +
      `&order_id=${encodeURIComponent(order_id)}` +
      `&amount=${encodeURIComponent(amount)}` +
      `&api_key=${encodeURIComponent(PAKASIR_API_KEY)}`
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Pakasir Detail Error:', data);
      return res.status(response.status).json({
        success: false,
        message: data.message || 'Gagal mengecek status'
      });
    }

    const transaction = data.transaction || data;

    return res.json({
      success: true,
      data: {
        order_id: transaction.order_id,
        status: transaction.status,
        amount: transaction.amount,
        completed_at: transaction.completed_at
      }
    });

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
});

// ============================================
// SERVE FRONTEND
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server berjalan di http://localhost:${PORT}`);
  console.log(`📦 Project: ${PAKASIR_PROJECT || 'BELUM DIKONFIGURASI'}`);
});