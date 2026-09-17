// ============================================
// STATE
// ============================================
let currentPayment = null;
let countdownInterval = null;

// ============================================
// DOM ELEMENTS
// ============================================
const views = {
  input: document.getElementById('view-input'),
  loading: document.getElementById('view-loading'),
  payment: document.getElementById('view-payment'),
  success: document.getElementById('view-success')
};

const amountInput = document.getElementById('amountInput');
const payButton = document.getElementById('payButton');
const errorMessage = document.getElementById('errorMessage');

const displayTotal = document.getElementById('displayTotal');
const displayOrderId = document.getElementById('displayOrderId');
const displayStatus = document.getElementById('displayStatus');
const qrisImage = document.getElementById('qrisImage');
const expiryContainer = document.getElementById('expiryContainer');
const countdown = document.getElementById('countdown');

const checkStatusButton = document.getElementById('checkStatusButton');
const saveQrisButton = document.getElementById('saveQrisButton');
const successOrderId = document.getElementById('successOrderId');

// ============================================
// VIEW MANAGEMENT
// ============================================
function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[viewName].classList.remove('hidden');
}

// ============================================
// FORMAT RUPIAH
// ============================================
function formatRupiah(value) {
  const num = value.replace(/\D/g, '');
  if (!num) return '';
  return 'Rp' + parseInt(num, 10).toLocaleString('id-ID');
}

// ============================================
// INPUT HANDLER - Auto format Rupiah
// ============================================
amountInput.addEventListener('input', (e) => {
  const cursorPos = e.target.selectionStart;
  const oldLength = e.target.value.length;
  const formatted = formatRupiah(e.target.value);
  e.target.value = formatted;
  // Adjust cursor
  const newLength = formatted.length;
  e.target.setSelectionRange(
    cursorPos + (newLength - oldLength),
    cursorPos + (newLength - oldLength)
  );
  errorMessage.textContent = '';
});

// ============================================
// GET RAW AMOUNT
// ============================================
function getRawAmount() {
  return parseInt(amountInput.value.replace(/\D/g, ''), 10) || 0;
}

// ============================================
// CREATE PAYMENT
// ============================================
async function createPayment() {
  const amount = getRawAmount();

  // Validasi
  if (amount < 500) {
    errorMessage.textContent = 'Nominal minimal Rp500';
    return;
  }

  // Tampilkan loading
  showView('loading');
  payButton.disabled = true;

  try {
    const response = await fetch('/api/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Gagal membuat transaksi');
    }

    currentPayment = result.data;

    // Update UI
    displayTotal.textContent = formatRupiah(String(currentPayment.total_payment || currentPayment.amount));
    displayOrderId.textContent = currentPayment.order_id;
    displayStatus.textContent = currentPayment.status === 'completed' ? 'Berhasil' : 'Menunggu';

    // Tampilkan QRIS dari payment_number
    if (currentPayment.payment_number) {
      // Gunakan QRCode API publik untuk render string QRIS menjadi gambar
      const qrData = encodeURIComponent(currentPayment.payment_number);
      qrisImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${qrData}`;
      qrisImage.style.display = 'block';
    } else {
      qrisImage.style.display = 'none';
    }

    // Countdown jika ada expired_at
    if (currentPayment.expired_at) {
      startCountdown(new Date(currentPayment.expired_at));
    } else {
      expiryContainer.classList.add('hidden');
    }

    showView('payment');

  } catch (error) {
    errorMessage.textContent = error.message;
    showView('input');
  } finally {
    payButton.disabled = false;
  }
}

// ============================================
// CHECK STATUS
// ============================================
async function checkStatus() {
  if (!currentPayment) return;

  checkStatusButton.disabled = true;
  checkStatusButton.textContent = 'Mengecek...';

  try {
    const params = new URLSearchParams({
      order_id: currentPayment.order_id,
      amount: currentPayment.amount
    });

    const response = await fetch(`/api/check-status?${params}`);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Gagal mengecek status');
    }

    const status = result.data.status;

    if (status === 'completed') {
      // Hentikan countdown
      if (countdownInterval) clearInterval(countdownInterval);
      // Tampilkan sukses
      successOrderId.textContent = currentPayment.order_id;
      showView('success');
    } else {
      displayStatus.textContent = 'Menunggu Pembayaran';
      displayStatus.classList.remove('success');
    }

  } catch (error) {
    alert(error.message);
  } finally {
    checkStatusButton.disabled = false;
    checkStatusButton.textContent = 'Cek Status Pembayaran';
  }
}

// ============================================
// COUNTDOWN TIMER
// ============================================
function startCountdown(expiryDate) {
  if (countdownInterval) clearInterval(countdownInterval);

  expiryContainer.classList.remove('hidden');

  function update() {
    const now = new Date().getTime();
    const distance = expiryDate.getTime() - now;

    if (distance <= 0) {
      clearInterval(countdownInterval);
      countdown.textContent = 'Kedaluwarsa';
      countdown.style.color = '#9ca3af';
      return;
    }

    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    countdown.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

// ============================================
// SAVE QRIS
// ============================================
async function saveQris() {
  if (!qrisImage.src) return;

  try {
    const response = await fetch(qrisImage.src);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `qris-${currentPayment?.order_id || 'payment'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

  } catch (error) {
    alert('Gagal menyimpan QRIS');
  }
}

// ============================================
// EVENT LISTENERS
// ============================================
payButton.addEventListener('click', createPayment);
checkStatusButton.addEventListener('click', checkStatus);
saveQrisButton.addEventListener('click', saveQris);

// Enter key di input
amountInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') createPayment();
});