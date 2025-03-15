const { ipcRenderer } = require("electron");

let html5QrcodeScanner = null;
let currentKtpData = null;
let selectedPoli = "";
let ocrTimeout = null;
let stream = null;

const videoElement = document.getElementById("camera-feed");
const startButton = document.getElementById("start-camera");
const captureButton = document.getElementById("capture");
const previewElement = document.getElementById("preview");
const statusElement = document.getElementById("status");
const queueSection = document.getElementById("queue-section");
const getQueueButton = document.getElementById("get-queue");
const cancelButton = document.getElementById("cancel-selection");
const queueNumber = document.getElementById("queue-number");
const qrReader = document.getElementById("qr-reader");
const nikElement = document.getElementById("nik");
const namaElement = document.getElementById("nama");

// Konfigurasi QR Scanner
const qrConfig = {
  fps: 30, // Meningkatkan FPS
  qrbox: { width: 300, height: 300 }, // Memperbesar area scan
  aspectRatio: 4 / 3,
  formatsToSupport: [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.DATA_MATRIX,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.CODE_128,
  ],
};

let isProcessing = false;
let scanTimeout = null;

// Fungsi untuk menampilkan status
function showStatus(message, type = "info") {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    statusElement.style.display = "block";
  }
  console.log(`Status: ${message} (${type})`); // Debug log
}

// Fungsi untuk memulai kamera
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 2048, min: 1280 },
        height: { ideal: 1536, min: 720 },
        facingMode: "environment",
        aspectRatio: { ideal: 4 / 3 }, // Rasio yang lebih baik untuk KTP
        frameRate: { ideal: 30, min: 15 },
        brightness: { ideal: 100 },
        contrast: { ideal: 100 },
        saturation: { ideal: 100 },
        sharpness: { ideal: 100 },
        focusMode: "continuous",
        whiteBalanceMode: "continuous",
        exposureMode: "continuous",
        exposureCompensation: 0.5, // Sedikit lebih terang
      },
    });

    videoElement.srcObject = stream;

    // Atur kualitas video setelah stream dimulai
    const videoTrack = stream.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities();

    // Terapkan pengaturan terbaik yang tersedia
    const idealConstraints = {
      advanced: [
        { brightness: 100 },
        { contrast: 100 },
        { sharpness: 100 },
        { focusDistance: 100 },
        { focusMode: "continuous" },
        { whiteBalanceMode: "continuous" },
      ],
    };

    if (capabilities.torch) {
      idealConstraints.advanced.push({ torch: true });
    }

    await videoTrack.applyConstraints(idealConstraints);

    captureButton.disabled = false;
    startButton.disabled = true;
    showStatus("Kamera siap. Silakan ambil foto KTP.", "success");
  } catch (err) {
    console.error("Error:", err);
    showStatus(
      "Tidak dapat mengakses kamera. Pastikan kamera terhubung dan izin diberikan.",
      "error"
    );
  }
}

// Fungsi untuk menghentikan kamera
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    videoElement.srcObject = null;
  }
}

// Fungsi untuk mereset kamera
function resetCamera() {
  stopCamera();
  startButton.disabled = false;
  captureButton.disabled = true;
  previewElement.style.display = "none";
  videoElement.style.display = "block";
}

// Fungsi untuk mengambil gambar
function captureImage() {
  const canvas = document.createElement("canvas");

  // Tingkatkan resolusi untuk OCR
  const maxWidth = 2048; // Tingkatkan resolusi
  const maxHeight = 1536; // Tingkatkan resolusi

  // Hitung scaling factor untuk mempertahankan aspect ratio
  const scaleWidth = maxWidth / videoElement.videoWidth;
  const scaleHeight = maxHeight / videoElement.videoHeight;
  const scale = Math.min(scaleWidth, scaleHeight);

  // Hitung dimensi final
  const finalWidth = Math.floor(videoElement.videoWidth * scale);
  const finalHeight = Math.floor(videoElement.videoHeight * scale);

  // Atur ukuran canvas
  canvas.width = finalWidth;
  canvas.height = finalHeight;

  const ctx = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true, // Optimize untuk manipulasi pixel
  });

  // Optimasi kualitas rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Gambar video ke canvas dengan scaling
  ctx.drawImage(videoElement, 0, 0, finalWidth, finalHeight);

  // Tingkatkan kontras dan ketajaman
  ctx.filter = "contrast(1.3) brightness(1.1) saturate(1.2)";
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";

  // Konversi ke grayscale dengan pembobotan yang lebih baik untuk teks
  const imageData = ctx.getImageData(0, 0, finalWidth, finalHeight);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Gunakan pembobotan yang lebih baik untuk teks hitam
    const gray = Math.round(
      0.299 * data[i] + // Red
        0.587 * data[i + 1] + // Green
        0.114 * data[i + 2] // Blue
    );

    // Tingkatkan kontras lokal
    const contrast = 1.2;
    const brightnessFactor = 10;
    const adjustedGray = Math.min(
      255,
      Math.max(0, (gray - 128) * contrast + 128 + brightnessFactor)
    );

    data[i] = adjustedGray; // R
    data[i + 1] = adjustedGray; // G
    data[i + 2] = adjustedGray; // B
  }
  ctx.putImageData(imageData, 0, 0);

  // Konversi ke JPEG dengan kualitas tinggi
  let quality = 0.95; // Mulai dengan kualitas sangat tinggi
  let finalImageData = canvas.toDataURL("image/jpeg", quality);

  // Kurangi kualitas jika ukuran terlalu besar, tapi jaga minimum
  while (finalImageData.length > 2 * 1024 * 1024 && quality > 0.7) {
    quality -= 0.05;
    finalImageData = canvas.toDataURL("image/jpeg", quality);
  }

  // Tampilkan preview
  previewElement.src = finalImageData;
  previewElement.style.display = "block";
  previewElement.style.width = "100%";
  previewElement.style.objectFit = "contain";

  // Sembunyikan video feed dan hentikan kamera
  videoElement.style.display = "none";
  stopCamera();

  // Update UI
  captureButton.disabled = true;
  startButton.disabled = false;
  showStatus("Sedang memproses KTP...", "processing");

  // Kirim untuk diproses
  processKTP(finalImageData);
}

// Fungsi untuk memproses KTP
function processKTP(imageData) {
  // Reset hasil sebelumnya
  if (nikElement) {
    nikElement.textContent = "-";
  }
  if (namaElement) {
    namaElement.textContent = "-";
  }
  currentKtpData = null;

  // Kirim data gambar ke main process untuk diproses
  ipcRenderer.send("process-ktp", imageData);
}

// Fungsi untuk reset pilihan poli
function resetPoliSelection() {
  selectedPoli = "";
  document.querySelectorAll(".poli-button").forEach((btn) => {
    btn.classList.remove("selected");
  });
  if (getQueueButton) getQueueButton.disabled = true;
  if (cancelButton) cancelButton.disabled = true;
}

// Fungsi untuk mendapatkan nomor antrian
function getQueueNumber() {
  if (!selectedPoli) {
    showStatus("Silakan pilih poli terlebih dahulu", "error");
    return;
  }

  if (!currentKtpData || !currentKtpData.nik) {
    showStatus("Data pasien tidak tersedia. Silakan scan ulang.", "error");
    return;
  }

  // Tampilkan status loading
  showStatus("Sedang mengambil nomor antrian...", "processing");

  // Nonaktifkan tombol sementara
  if (getQueueButton) getQueueButton.disabled = true;
  if (cancelButton) cancelButton.disabled = true;

  // Nonaktifkan semua tombol poli
  document.querySelectorAll(".poli-button").forEach((btn) => {
    btn.disabled = true;
  });

  // Format tanggal YYYY-MM-DD
  const today = new Date();
  const tanggal =
    today.getFullYear() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");

  // Tentukan tipe data berdasarkan asuransi
  const isBPJS = currentKtpData.asuransi === "BPJS Kesehatan";

  // Siapkan data untuk dikirim dengan format yang sesuai
  const queueData = {
    qr_data: currentKtpData.qr_data,
    poli: selectedPoli,
    date: tanggal,
    patient_data: {
      nik: currentKtpData.nik,
      nama: currentKtpData.nama,
      alamat: currentKtpData.alamat || "",
      jenis_kelamin: currentKtpData.jenisKelamin || "",
      tanggal_lahir: currentKtpData.tanggalLahir || "",
      no_hp: currentKtpData.noHp || "",
      asuransi: currentKtpData.asuransi || "Umum",
      nomor_asuransi: currentKtpData.nomorAsuransi || "",
      status: "waiting",
    },
    tipe_identitas: isBPJS ? "BPJS" : "KTP",
    from_qr: true,
  };

  console.log("Mengirim data antrian:", queueData);

  // Kirim permintaan nomor antrian
  ipcRenderer.send("get-queue-number", queueData);
}

// Fungsi untuk memulai QR Scanner
async function startQRScanner() {
  try {
    console.log("Memulai inisialisasi scanner...");
    showStatus("Memulai kamera...", "info");

    // Reset state
    if (html5QrcodeScanner) {
      await html5QrcodeScanner.clear();
      html5QrcodeScanner = null;
    }

    // Buat instance scanner
    const html5Qrcode = new Html5Qrcode("qr-reader");

    // Konfigurasi kamera
    const cameraConfig = {
      facingMode: "environment",
      frameRate: { ideal: 30, min: 15 },
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      focusMode: "continuous",
      exposureMode: "continuous",
    };

    // Mulai scanner dengan callback yang dioptimalkan
    await html5Qrcode.start(
      cameraConfig,
      {
        fps: 30,
        qrbox: { width: 300, height: 300 },
        aspectRatio: 4 / 3,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
      },
      async (decodedText, decodedResult) => {
        console.log("QR Code terdeteksi!", { decodedText, decodedResult });

        if (!isProcessing) {
          isProcessing = true;
          showStatus("QR Code terdeteksi! Memproses...", "success");

          try {
            // Tambahkan suara beep ketika QR terdeteksi
            const beep = new Audio(
              "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"
            );
            beep.play();

            // Kirim data untuk verifikasi
            console.log("Mengirim data untuk verifikasi:", decodedText);
            ipcRenderer.send("verify-qrcode", decodedText);
            showStatus("Memverifikasi QR Code...", "processing");

            // Pause scanner
            await html5Qrcode.pause();

            // Set timeout untuk auto-resume jika tidak ada respons
            if (scanTimeout) clearTimeout(scanTimeout);
            scanTimeout = setTimeout(() => {
              if (isProcessing) {
                isProcessing = false;
                html5Qrcode.resume();
                showStatus("Scanner aktif kembali", "info");
              }
            }, 10000); // Meningkatkan timeout menjadi 10 detik
          } catch (error) {
            console.error("Error memproses QR:", error);
            showStatus("Error: " + error.message, "error");
            isProcessing = false;
            html5Qrcode.resume();
          }
        }
      },
      (errorMessage) => {
        // Hanya log error yang penting
        if (
          !errorMessage.includes("No MultiFormat Readers") &&
          !errorMessage.includes("No barcode detected")
        ) {
          console.error("Scanner error:", errorMessage);
        }
      }
    );

    // Simpan instance
    html5QrcodeScanner = html5Qrcode;

    // Update UI
    const startButton = document.getElementById("start-camera");
    const stopButton = document.getElementById("stop-camera");
    if (startButton) startButton.disabled = true;
    if (stopButton) stopButton.disabled = false;

    showStatus("Kamera aktif, arahkan QR Code ke area scan", "success");
  } catch (err) {
    console.error("Error starting camera:", err);
    showStatus("Error: " + err.message, "error");
  }
}

// Fungsi untuk menghentikan QR Scanner
async function stopQRScanner() {
  try {
    if (html5QrcodeScanner) {
      await html5QrcodeScanner.stop();
      html5QrcodeScanner = null;
    }

    // Update UI
    const startButton = document.getElementById("start-camera");
    const stopButton = document.getElementById("stop-camera");
    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;

    showStatus("Kamera dimatikan", "info");
  } catch (err) {
    console.error("Error stopping camera:", err);
    showStatus("Error: " + err.message, "error");
  }
}

// Handle hasil verifikasi QR Code
ipcRenderer.on("qrcode-verification-result", (event, result) => {
  console.log("Hasil verifikasi diterima:", result);

  // Clear timeout jika ada
  if (scanTimeout) {
    clearTimeout(scanTimeout);
    scanTimeout = null;
  }

  try {
    if (result.success) {
      const data = result.data;
      console.log("Data terverifikasi:", data);

      // Update UI dengan data yang sudah diverifikasi
      if (nikElement) nikElement.textContent = data.nik || data.nomor_identitas;
      if (namaElement) namaElement.textContent = data.nama;

      // Update data pasien
      currentKtpData = {
        nik: data.nik || data.nomor_identitas,
        nama: data.nama,
        alamat: data.alamat,
        jenisKelamin: data.jenis_kelamin,
        tanggalLahir: data.tanggal_lahir,
        noHp: data.no_hp,
        asuransi: data.asuransi || "Umum",
        nomorAsuransi: data.nomor_asuransi,
        status: "verified",
        qr_data: data.nik || data.nomor_identitas,
      };

      // Tampilkan informasi tambahan
      showDetailInfo(`
        <div class="field-group">
          <span class="field-label">No. HP</span>
          <span class="field-value">${data.no_hp || "-"}</span>
        </div>
        <div class="field-group">
          <span class="field-label">Asuransi</span>
          <span class="field-value">${data.asuransi || "Umum"}</span>
        </div>
        ${
          data.nomor_asuransi
            ? `<div class="field-group">
                <span class="field-label">No. Asuransi</span>
                <span class="field-value">${data.nomor_asuransi}</span>
               </div>`
            : ""
        }
        <div class="field-group">
          <span class="field-label">Tanggal Lahir</span>
          <span class="field-value">${data.tanggal_lahir || "-"}</span>
        </div>
      `);

      showStatus("QR Code berhasil diverifikasi", "success");

      // Stop scanner setelah berhasil
      if (html5QrcodeScanner) {
        html5QrcodeScanner.stop();
        html5QrcodeScanner = null;
      }

      // Tampilkan section pemilihan poli
      if (queueSection) {
        queueSection.style.display = "block";
      }

      // Enable tombol poli
      updatePoliButtons(true);
      showStatus("Silakan pilih poli tujuan", "info");
    } else {
      console.error("Verifikasi gagal:", result.error);
      showStatus("Verifikasi gagal: " + result.error, "error");
      updatePoliButtons(false);

      // Resume scanner untuk mencoba lagi
      if (html5QrcodeScanner) {
        html5QrcodeScanner.resume();
      }
    }
  } catch (error) {
    console.error("Error handling verification:", error);
    showStatus("Error: " + error.message, "error");
  } finally {
    isProcessing = false;
  }
});

// Fungsi untuk update status tombol poli
function updatePoliButtons(enable) {
  console.log("Updating poli buttons:", enable);
  const buttons = document.querySelectorAll(".poli-button");
  buttons.forEach((button) => {
    button.disabled = !enable;
    if (enable) {
      button.classList.remove("disabled");
      // Tambahkan event listener
      button.addEventListener("click", () =>
        handlePoliSelection(button.dataset.poli)
      );
    } else {
      button.classList.add("disabled");
    }
  });

  // Update tombol ambil antrian
  if (getQueueButton) {
    getQueueButton.disabled = !enable || !selectedPoli;
  }
}

/**
 * Tampilkan informasi detail
 */
function showDetailInfo(info) {
  const resultDiv = document.getElementById("result");
  if (resultDiv && info) {
    // Add any additional information to the result div
    const additionalInfo = document.createElement("div");
    additionalInfo.className = "field-group";
    additionalInfo.innerHTML = info;
    resultDiv.appendChild(additionalInfo);
  }
}

// Terima hasil nomor antrian
ipcRenderer.on("queue-result", (event, result) => {
  console.log("Menerima hasil antrian:", result);

  try {
    if (!result.error) {
      // Tampilkan hasil antrian
      const queueResult = document.getElementById("queueResult");
      const queueNumberElement = document.getElementById("queueNumber");
      const patientNameElement = document.getElementById("patientName");
      const poliInfoElement = document.getElementById("poliInfo");
      const visitDateElement = document.getElementById("visitDate");
      const qrCodeElement = document.getElementById("qrCode");

      if (queueResult) queueResult.style.display = "block";
      if (queueNumberElement) queueNumberElement.textContent = result.number;
      if (patientNameElement) patientNameElement.textContent = result.nama;
      if (poliInfoElement) poliInfoElement.textContent = `Poli: ${result.poli}`;
      if (visitDateElement)
        visitDateElement.textContent = `Tanggal: ${result.tanggal}`;
      if (qrCodeElement && result.qrCode) qrCodeElement.src = result.qrCode;

      // Sembunyikan section pemilihan poli
      if (queueSection) queueSection.style.display = "none";

      showStatus("Nomor antrian berhasil didapatkan", "success");

      // Mainkan suara notifikasi
      if (window.responsiveVoice) {
        const text = `Nomor antrian anda adalah ${result.number} di Poli ${result.poli}`;
        window.responsiveVoice.speak(text, "Indonesian Female");
      }
    } else {
      showStatus(result.error, "error");
      console.error("Error mendapatkan antrian:", result.error);

      // Aktifkan kembali tombol-tombol
      if (getQueueButton) getQueueButton.disabled = false;
      if (cancelButton) cancelButton.disabled = false;
      document.querySelectorAll(".poli-button").forEach((btn) => {
        btn.disabled = false;
      });
    }
  } catch (error) {
    console.error("Error saat memproses hasil antrian:", error);
    showStatus("Terjadi kesalahan saat memproses nomor antrian", "error");

    // Aktifkan kembali tombol-tombol
    if (getQueueButton) getQueueButton.disabled = false;
    if (cancelButton) cancelButton.disabled = false;
    document.querySelectorAll(".poli-button").forEach((btn) => {
      btn.disabled = false;
    });
  }
});

// Tambahkan tombol untuk reset kamera (dengan pengecekan)
const resetCameraButton = document.getElementById("reset-camera");
if (resetCameraButton) {
  resetCameraButton.addEventListener("click", () => {
    resetCamera();
    showStatus("Kamera direset. Silakan mulai scan ulang.", "info");
  });
}

// Tambahkan CSS untuk print
const style = document.createElement("style");
style.textContent = `
  @media print {
    body * {
      visibility: hidden;
    }
    #queueResult, #queueResult * {
      visibility: visible;
    }
    #queueResult {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
    }
    button {
      display: none !important;
    }
  }
`;
document.head.appendChild(style);

// Event listeners untuk tombol kamera
document.addEventListener("DOMContentLoaded", () => {
  const startButton = document.getElementById("start-camera");
  const stopButton = document.getElementById("stop-camera");
  const resetButton = document.getElementById("reset-camera");

  if (startButton) {
    startButton.addEventListener("click", startQRScanner);
  }

  if (stopButton) {
    stopButton.addEventListener("click", stopQRScanner);
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      stopQRScanner();
      setTimeout(() => {
        startQRScanner();
      }, 1000);
    });
  }

  // Reset status
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.innerHTML = "";
  }

  // Disable poli buttons initially
  updatePoliButtons(false);

  // Tambahkan event listener untuk tombol ambil antrian
  if (getQueueButton) {
    getQueueButton.addEventListener("click", getQueueNumber);
  }

  // Tambahkan event listener untuk tombol cancel
  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      resetPoliSelection();
      showStatus("Pemilihan poli dibatalkan", "info");
    });
  }
});

// Event handler untuk pemilihan poli
function handlePoliSelection(poliCode) {
  console.log("Poli dipilih:", poliCode);
  selectedPoli = poliCode;

  // Update UI untuk menunjukkan poli yang dipilih
  document.querySelectorAll(".poli-button").forEach((btn) => {
    if (btn.dataset.poli === poliCode) {
      btn.classList.add("selected");
    } else {
      btn.classList.remove("selected");
    }
  });

  // Enable tombol ambil antrian
  if (getQueueButton) {
    getQueueButton.disabled = false;
  }

  showStatus(`Poli ${poliCode} dipilih`, "success");
}
