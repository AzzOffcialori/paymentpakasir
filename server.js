require('dotenv').config();
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== KONFIGURASI PAKASIR ====================
const PAKASIR_CONFIG = {
  apiKey: process.env.PAKASIR_API_KEY,
  projectSlug: process.env.PAKASIR_PROJECT_SLUG,
  baseUrl: 'https://pakasir.com',
  // Endpoint sesuai dokumentasi resmi Pakasir API
  endpoints: {
    createTransaction: '/api/transactioncreate',
    transactionDetail: '/api/transactiondetail',
  },
};

// Validasi credentials saat startup
if (!PAKASIR_CONFIG.apiKey || !PAKASIR_CONFIG.projectSlug) {
  console.error('❌ ERROR: PAKASIR_API_KEY dan PAKASIR_PROJECT_SLUG harus diisi di file .env');
  process.exit(1);
}

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting untuk endpoint payment
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 10, // max 10 request per menit per IP
  message: { error: 'Terlalu banyak permintaan. Silakan coba lagi nanti.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate Order ID unik
 * Format: PAY-{timestamp}-{random}
 */
function generateOrderId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PAY-${timestamp}-${random}`;
}

/**
 * Validasi nominal pembayaran
 */
function validateAmount(amount) {
  const minPayment = parseInt(process.env.MIN_PAYMENT) || 500;
  const maxPayment = parseInt(process.env.MAX_PAYMENT) || 10000000;

  if (!amount || typeof amount !== 'number' || isNaN(amount)) {
    return { valid: false, error: 'Nominal tidak valid.' };
  }

  if (amount < minPayment) {
    return { valid: false, error: `Nominal pembayaran terlalu kecil. Minimal Rp${minPayment.toLocaleString('id-ID')}.` };
  }

  if (amount > maxPayment) {
    return { valid: false, error: `Nominal pembayaran terlalu besar. Maksimal Rp${maxPayment.toLocaleString('id-ID')}.` };
  }

  if (!Number.isInteger(amount)) {
    return { valid: false, error: 'Nominal harus berupa angka bulat.' };
  }

  return { valid: true };
}

/**
 * Map status Pakasir ke status internal
 * Status sesuai dokumentasi: pending, completed, cancelled, expired
 */
function mapStatus(pakasirStatus) {
  const statusMap = {
    'pending': 'pending',
    'completed': 'completed',
    'cancelled': 'cancelled',
    'canceled': 'cancelled',
    'expired': 'expired',
  };
  return statusMap[pakasirStatus?.toLowerCase()] || 'unknown';
}

// ==================== API ROUTES ====================

/**
 * POST /api/payment/create
 * Membuat transaksi baru dan mendapatkan QRIS dari Pakasir
 */
app.post('/api/payment/create', paymentLimiter, async (req, res) => {
  try {
    const { amount } = req.body;

    // Validasi nominal di backend (jangan percaya frontend saja)
    const validation = validateAmount(amount);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const orderId = generateOrderId();

    // Request ke Pakasir API untuk membuat transaksi QRIS
    // Endpoint: POST /api/transactioncreate/qris
    const response = await axios.post(
      `${PAKASIR_CONFIG.baseUrl}${PAKASIR_CONFIG.endpoints.createTransaction}/qris`,
      {
        project: PAKASIR_CONFIG.projectSlug,
        order_id: orderId,
        amount: amount,
        api_key: PAKASIR_CONFIG.apiKey,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 detik timeout
      }
    );

    const data = response.data;

    // Cek apakah response sukses
    if (!data || !data.payment) {
      console.error('Pakasir response tidak valid:', data);
      return res.status(500).json({ error: 'Gagal membuat pembayaran. Silakan coba lagi.' });
    }

    // Return data yang diperlukan ke frontend
    // Jangan expose API key atau data sensitif lainnya
    res.json({
      success: true,
      order_id: data.order_id || orderId,
      amount: data.amount || amount,
      payment: {
        // QRIS string untuk di-render menjadi QR code
        qris_string: data.payment.payment_number || data.payment.qr_string || null,
        // Payment URL jika tersedia (untuk redirect)
        payment_url: data.payment.payment_url || null,
        // Fee dan total
        fee: data.payment.fee || 0,
        total_payment: data.payment.total_payment || amount,
        // Waktu expired
        expired_at: data.payment.expired_at || null,
      },
    });
  } catch (error) {
    console.error('Error creating payment:', error.message);

    // Handle error dari Pakasir API
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.response.data?.error;

      if (status === 400) {
        return res.status(400).json({ error: message || 'Nominal tidak valid.' });
      }
      if (status === 401 || status === 403) {
        console.error('API Key atau Project Slug tidak valid');
        return res.status(500).json({ error: 'Gagal membuat pembayaran. Silakan coba lagi.' });
      }
      if (status === 429) {
        return res.status(429).json({ error: 'Terlalu banyak permintaan. Silakan coba lagi nanti.' });
      }
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'Koneksi sedang bermasalah. Silakan coba lagi.' });
    }

    res.status(500).json({ error: 'Gagal membuat pembayaran. Silakan coba lagi.' });
  }
});

/**
 * GET /api/payment/status/:orderId
 * Cek status pembayaran dari Pakasir
 * Query params: amount (diperlukan oleh Pakasir API)
 */
app.get('/api/payment/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount } = req.query;

    if (!orderId || !amount) {
      return res.status(400).json({ error: 'Order ID dan amount diperlukan.' });
    }

    // Validasi amount
    const amountNum = parseInt(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Nominal tidak valid.' });
    }

    // Request ke Pakasir API untuk cek status
    // Endpoint: GET /api/transactiondetail
    // Note: Pakasir mengirim api_key sebagai query parameter untuk endpoint ini
    const response = await axios.get(
      `${PAKASIR_CONFIG.baseUrl}${PAKASIR_CONFIG.endpoints.transactionDetail}`,
      {
        params: {
          project: PAKASIR_CONFIG.projectSlug,
          order_id: orderId,
          amount: amountNum,
          api_key: PAKASIR_CONFIG.apiKey,
        },
        timeout: 15000,
      }
    );

    const data = response.data;

    if (!data) {
      return res.status(500).json({ error: 'Gagal mengecek status pembayaran.' });
    }

    // Map status ke format internal
    const status = mapStatus(data.status);

    res.json({
      success: true,
      order_id: data.order_id || orderId,
      amount: data.amount || amountNum,
      status: status,
      // Waktu completed jika sudah dibayar
      completed_at: data.completed_at || null,
    });
  } catch (error) {
    console.error('Error checking status:', error.message);

    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.response.data?.error;

      if (status === 404) {
        return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
      }
      if (status === 400) {
        return res.status(400).json({ error: message || 'Transaksi sudah kedaluwarsa.' });
      }
    }

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'Koneksi sedang bermasalah.' });
    }

    res.status(500).json({ error: 'Gagal mengecek status pembayaran.' });
  }
});

/**
 * GET /api/config
 * Return konfigurasi publik (min/max payment)
 */
app.get('/api/config', (req, res) => {
  res.json({
    minPayment: parseInt(process.env.MIN_PAYMENT) || 500,
    maxPayment: parseInt(process.env.MAX_PAYMENT) || 10000000,
  });
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`✅ Server berjalan di http://localhost:${PORT}`);
  console.log(`📦 Project: ${PAKASIR_CONFIG.projectSlug}`);
  console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
});