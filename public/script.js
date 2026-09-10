// ==================== STATE ====================
const state = {
  orderId: null,
  amount: 0,
  qrisString: null,
  pollingInterval: null,
  isProcessing: false,
};

// ==================== DOM ELEMENTS ====================
const elements = {
  sections: {
    input: document.getElementById('section-input'),
    qris: document.getElementById('section-qris'),
    success: document.getElementById('section-success'),
  },
  amountInput: document.getElementById('amountInput'),
  payButton: document.getElementById('payButton'),
  qrisCanvas: document.getElementById('qrisCanvas'),
  qrisAmount: document.getElementById('qrisAmount'),
  qrisStatus: document.getElementById('qrisStatus'),
  downloadButton: document.getElementById('downloadButton'),
  shareButton: document.getElementById('shareButton'),
  cancelButton: document.getElementById('cancelButton'),
  successAmount: document.getElementById('successAmount'),
  successOrderId: document.getElementById('successOrderId'),
  successTime: document.getElementById('successTime'),
  payAgainButton: document.getElementById('payAgainButton'),
  toast: document.getElementById('toast'),
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Format angka ke Rupiah
 */
function formatRupiah(amount) {
  return 'Rp' + amount.toLocaleString('id-ID');
}

/**
 * Parse Rupiah string ke number
 */
function parseRupiah(str) {
  const cleaned = str.replace(/[^\d]/g, '');
  return parseInt(cleaned) || 0;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = 'toast show';
  if (type !== 'info') {
    elements.toast.classList.add(type);
  }

  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3000);
}

/**
 * Switch section
 */
function switchSection(sectionName) {
  Object.values(elements.sections).forEach(section => {
    section.classList.remove('active');
  });
  elements.sections[sectionName].classList.add('active');
}

/**
 * Set loading state pada tombol
 */
function setButtonLoading(button, loading) {
  const text = button.querySelector('.btn-text');
  const loader = button.querySelector('.btn-loader');
  
  if (loading) {
    button.disabled = true;
    text.classList.add('hidden');
    loader.classList.remove('hidden');
  } else {
    button.disabled = false;
    text.classList.remove('hidden');
    loader.classList.add('hidden');
  }
}

/**
 * Format waktu
 */
function formatTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ==================== AMOUNT INPUT HANDLING ====================

/**
 * Format input amount saat user mengetik
 */
elements.amountInput.addEventListener('input', (e) => {
  const rawValue = e.target.value;
  const number = parseRupiah(rawValue);
  
  if (number === 0) {
    e.target.value = '';
  } else {
    e.target.value = number.toLocaleString('id-ID');
  }
});

// Quick amount buttons
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const amount = parseInt(btn.dataset.amount);
    elements.amountInput.value = amount.toLocaleString('id-ID');
  });
});

// ==================== PAYMENT HANDLING ====================

/**
 * Buat pembayaran baru
 */
async function createPayment() {
  const amount = parseRupiah(elements.amountInput.value);

  // Validasi frontend
  if (amount < 500) {
    showToast('Nominal pembayaran terlalu kecil. Minimal Rp500.', 'error');
    return;
  }

  if (amount > 10000000) {
    showToast('Nominal pembayaran terlalu besar. Maksimal Rp10.000.000.', 'error');
    return;
  }

  if (state.isProcessing) return;
  state.isProcessing = true;

  setButtonLoading(elements.payButton, true);

  // Delay sedikit untuk UX yang lebih smooth
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    const response = await fetch('/api/payment/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Gagal membuat pembayaran.');
    }

    // Simpan state
    state.orderId = data.order_id;
    state.amount = data.amount;
    state.qrisString = data.payment.qris_string;

    // Render QRIS
    await renderQRIS(data.payment.qris_string);

    // Update UI
    elements.qrisAmount.textContent = formatRupiah(data.amount);
    updateStatusUI('pending');

    // Switch ke section QRIS
    switchSection('qris');

    // Mulai polling status
    startPolling();

  } catch (error) {
    console.error('Error:', error);
    showToast(error.message || 'Gagal membuat pembayaran. Silakan coba lagi.', 'error');
  } finally {
    setButtonLoading(elements.payButton, false);
    state.isProcessing = false;
  }
}

/**
 * Render QRIS ke canvas
 * QRIS string dari Pakasir di-render menggunakan QRCode.js
 */
async function renderQRIS(qrisString) {
  if (!qrisString) {
    throw new Error('Data QRIS tidak valid.');
  }

  // Clear canvas
  const canvas = elements.qrisCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Render QR code dengan resolusi tinggi untuk download
  await QRCode.toCanvas(canvas, qrisString, {
    width: 600,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

// ==================== STATUS POLLING ====================

/**
 * Mulai polling status pembayaran
 */
function startPolling() {
  // Clear existing interval
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
  }

  // Poll setiap 3 detik
  state.pollingInterval = setInterval(checkPaymentStatus, 3000);

  // Cek pertama kali setelah 2 detik
  setTimeout(checkPaymentStatus, 2000);
}

/**
 * Stop polling
 */
function stopPolling() {
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
    state.pollingInterval = null;
  }
}

/**
 * Cek status pembayaran
 */
async function checkPaymentStatus() {
  if (!state.orderId || !state.amount) return;

  try {
    const response = await fetch(
      `/api/payment/status/${state.orderId}?amount=${state.amount}`
    );

    const data = await response.json();

    if (!response.ok) {
      // Jika 404, mungkin transaksi belum ada, lanjut polling
      if (response.status === 404) return;
      throw new Error(data.error);
    }

    const status = data.status;

    // Update UI berdasarkan status
    updateStatusUI(status);

    // Handle terminal states
    if (status === 'completed') {
      stopPolling();
      showSuccess(data);
    } else if (status === 'cancelled' || status === 'expired') {
      stopPolling();
      showToast(
        status === 'expired' 
          ? 'Transaksi sudah kedaluwarsa.' 
          : 'Pembayaran dibatalkan.',
        'error'
      );
    }

  } catch (error) {
    console.error('Error checking status:', error);
    // Jangan stop polling jika hanya error network sementara
  }
}

/**
 * Update UI status
 */
function updateStatusUI(status) {
  const statusElement = elements.qrisStatus;
  
  const statusMap = {
    pending: {
      text: 'Menunggu Pembayaran...',
      class: 'status-pending',
    },
    completed: {
      text: 'Pembayaran Berhasil',
      class: 'status-success',
    },
    cancelled: {
      text: 'Pembayaran Dibatalkan',
      class: 'status-cancelled',
    },
    expired: {
      text: 'Pembayaran Kedaluwarsa',
      class: 'status-expired',
    },
  };

  const statusInfo = statusMap[status] || statusMap.pending;
  
  statusElement.innerHTML = `
    <span class="status-indicator"></span>
    ${statusInfo.text}
  `;
  statusElement.className = `info-value ${statusInfo.class}`;
}

// ==================== SUCCESS HANDLING ====================

/**
 * Tampilkan halaman sukses
 */
function showSuccess(data) {
  elements.successAmount.textContent = formatRupiah(data.amount || state.amount);
  elements.successOrderId.textContent = data.order_id || state.orderId;
  elements.successTime.textContent = formatTime(data.completed_at);

  switchSection('success');
  showToast('Pembayaran berhasil! 🎉', 'success');
}

/**
 * Reset ke form input
 */
function resetToInput() {
  stopPolling();
  
  state.orderId = null;
  state.amount = 0;
  state.qrisString = null;

  elements.amountInput.value = '';
  elements.qrisCanvas.getContext('2d').clearRect(0, 0, 600, 600);

  switchSection('input');
}

// ==================== DOWNLOAD & SHARE ====================

/**
 * Download QRIS sebagai PNG
 */
async function downloadQRIS() {
  if (!elements.qrisCanvas) {
    showToast('QRIS tidak tersedia.', 'error');
    return;
  }

  try {
    // Convert canvas ke blob PNG
    const blob = await new Promise((resolve, reject) => {
      elements.qrisCanvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Gagal membuat gambar')),
        'image/png',
        1.0
      );
    });

    // Generate filename
    const fileName = `QRIS-Payment-${state.amount}.png`;

    // Download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast('QRIS berhasil di-download!', 'success');
  } catch (error) {
    console.error('Download error:', error);
    showToast('Gagal mengunduh QRIS. Silakan coba lagi.', 'error');
  }
}

/**
 * Simpan / Bagikan QRIS
 * Menggunakan Web Share API jika tersedia, fallback ke download
 */
async function shareQRIS() {
  if (!elements.qrisCanvas) {
    showToast('QRIS tidak tersedia.', 'error');
    return;
  }

  try {
    // Convert canvas ke blob
    const blob = await new Promise((resolve, reject) => {
      elements.qrisCanvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Gagal membuat gambar')),
        'image/png',
        1.0
      );
    });

    const fileName = `QRIS-Payment-${state.amount}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    // Cek Web Share API dengan file support
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'QRIS Payment',
        text: `Scan QRIS untuk membayar ${formatRupiah(state.amount)}`,
      });
      showToast('QRIS berhasil dibagikan!', 'success');
    } else {
      // Fallback ke download
      await downloadQRIS();
    }
  } catch (error) {
    // User cancel share - bukan error
    if (error.name === 'AbortError') return;
    
    console.error('Share error:', error);
    
    // Fallback ke download jika share gagal
    await downloadQRIS();
  }
}

// ==================== EVENT LISTENERS ====================

elements.payButton.addEventListener('click', createPayment);

elements.amountInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    createPayment();
  }
});

elements.downloadButton.addEventListener('click', downloadQRIS);
elements.shareButton.addEventListener('click', shareQRIS);

elements.cancelButton.addEventListener('click', () => {
  if (confirm('Yakin ingin membatalkan pembayaran?')) {
    resetToInput();
  }
});

elements.payAgainButton.addEventListener('click', resetToInput);

// ==================== INITIALIZATION ====================

// Focus ke input saat halaman dimuat
window.addEventListener('load', () => {
  elements.amountInput.focus();
});

// Cleanup saat halaman ditutup
window.addEventListener('beforeunload', () => {
  stopPolling();
});