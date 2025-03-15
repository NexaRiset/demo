const { ipcRenderer } = require("electron");

let stream = null;
let currentKtpData = null;
let selectedPoli = "";

const videoElement = document.getElementById("camera-feed");
const startButton = document.getElementById("start-camera");
const captureButton = document.getElementById("capture");
const previewElement = document.getElementById("preview");
const statusElement = document.getElementById("status");
const queueSection = document.getElementById("queue-section");
const getQueueButton = document.getElementById("get-queue");
const cancelButton = document.getElementById("cancel-selection");
const queueNumber = document.getElementById("queue-number");

// Fungsi untuk menampilkan status
function showStatus(message, type) {
  statusElement.textContent = message;
  statusElement.className = `status-${type}`;
  statusElement.style.display = "block";
}

// Fungsi untuk memulai kamera
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        facingMode: "environment",
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30, min: 15 },
        brightness: { ideal: 100 },
        contrast: { ideal: 95 },
        saturation: { ideal: 100 },
        sharpness: { ideal: 100 },
        focusMode: "continuous",
        whiteBalanceMode: "continuous",
        exposureMode: "continuous",
      },
    });
    videoElement.srcObject = stream;

    // Atur kualitas video setelah stream dimulai
    const videoTrack = stream.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities();
    const settings = videoTrack.getSettings();

    // Terapkan pengaturan terbaik yang tersedia
    if (capabilities.torch) {
      await videoTrack.applyConstraints({ advanced: [{ torch: true }] });
    }

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

  // Atur ukuran maksimum yang optimal untuk OCR (1280x720 cukup untuk KTP)
  const maxWidth = 1280;
  const maxHeight = 720;

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

  const ctx = canvas.getContext("2d", { alpha: false });

  // Optimasi kualitas rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Gambar video ke canvas dengan scaling
  ctx.drawImage(videoElement, 0, 0, finalWidth, finalHeight);

  // Aplikasikan filter untuk meningkatkan keterbacaan teks
  ctx.filter = "contrast(1.2) brightness(1.1)";
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";

  // Konversi ke grayscale untuk mengurangi ukuran
  const imageData = ctx.getImageData(0, 0, finalWidth, finalHeight);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = gray; // R
    data[i + 1] = gray; // G
    data[i + 2] = gray; // B
  }
  ctx.putImageData(imageData, 0, 0);

  // Konversi ke JPEG dengan kompresi yang sesuai
  let quality = 0.7;
  let finalImageData = canvas.toDataURL("image/jpeg", quality);

  // Pastikan ukuran file di bawah 1MB (1024 KB)
  while (finalImageData.length > 1024 * 1024 && quality > 0.1) {
    quality -= 0.1;
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

  // Reset queue section
  // queueSection.style.display = "block";
  // queueNumber.textContent = "";

  // Kirim untuk diproses
  processKTP(finalImageData);
}

// Fungsi untuk memproses KTP
function processKTP(imageData) {
  // Reset hasil sebelumnya
  document.getElementById("nik").textContent = "-";
  document.getElementById("nama").textContent = "-";
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
  getQueueButton.disabled = true;
  cancelButton.disabled = true;
}

// Fungsi untuk mendapatkan nomor antrian
function getQueueNumber() {
  if (!selectedPoli) {
    showStatus("Silakan pilih poli terlebih dahulu", "error");
    return;
  }

  if (!currentKtpData || !currentKtpData.nama) {
    showStatus("Data nama tidak tersedia. Silakan scan ulang KTP.", "error");
    return;
  }

  // Kirim permintaan nomor antrian
  ipcRenderer.send("get-queue-number", {
    poli: selectedPoli,
    ktpData: currentKtpData,
  });

  getQueueButton.disabled = true;
  cancelButton.disabled = true;
  showStatus("Mengambil nomor antrian...", "processing");
}

// Event listeners
startButton.addEventListener("click", startCamera);
captureButton.addEventListener("click", captureImage);
getQueueButton.addEventListener("click", getQueueNumber);
cancelButton.addEventListener("click", resetPoliSelection);

// Tambahkan event listener untuk tombol-tombol poli
document.querySelectorAll(".poli-button").forEach((button) => {
  button.addEventListener("click", () => {
    // Hapus kelas selected dari semua tombol
    document.querySelectorAll(".poli-button").forEach((btn) => {
      btn.classList.remove("selected");
    });

    // Tambahkan kelas selected ke tombol yang diklik
    button.classList.add("selected");

    // Simpan poli yang dipilih
    selectedPoli = button.dataset.poli;

    // Aktifkan tombol-tombol jika nama sudah ada
    if (currentKtpData?.nama) {
      getQueueButton.disabled = false;
      cancelButton.disabled = false;
    }
  });
});

// Terima hasil pemrosesan KTP
ipcRenderer.on("ktp-result", (event, data) => {
  // Aktifkan kembali tombol capture dan reset kamera
  captureButton.disabled = false;
  resetCamera();

  if (data.error) {
    showStatus("Gagal memproses KTP: " + data.error, "error");
    queueSection.style.display = "none";
    return;
  }

  if (data.nik && data.nama && data.alamat) {
    showStatus("KTP berhasil diproses!", "success");

    // Tampilkan hasil
    document.getElementById("nik").textContent = data.nik || "-";
    document.getElementById("nama").textContent = data.nama;
    // document.getElementById("alamat").textContent = data.alamat || "-";

    // Simpan data KTP saat ini
    currentKtpData = data;

    // Tampilkan bagian antrian
    queueSection.style.display = "block";

    // Aktifkan semua tombol poli
    document.querySelectorAll(".poli-button").forEach((btn) => {
      btn.disabled = false;
    });

    // Reset pilihan poli
    resetPoliSelection();
  } else {
    showStatus(
      "Data KTP tidak lengkap. Silakan scan ulang dengan posisi yang lebih jelas.",
      "error"
    );
    queueSection.style.display = "none";

    // Reset tampilan data
    document.getElementById("nik").textContent = "-";
    document.getElementById("nama").textContent = "-";
    currentKtpData = null;
  }
});

// Terima hasil nomor antrian
ipcRenderer.on("queue-result", (event, data) => {
  // Reset kamera untuk KTP berikutnya
  resetCamera();

  if (data.error) {
    showStatus(data.error, "error");
    getQueueButton.disabled = false;
    return;
  }

  // Tampilkan hasil antrian
  document.getElementById("queue-section").style.display = "none";
  document.getElementById("queueResult").style.display = "block";

  // Tampilkan informasi antrian
  document.getElementById("queueNumber").textContent = data.number;
  document.getElementById("patientName").textContent = data.nama;
  document.getElementById(
    "poliInfo"
  ).textContent = `Poli ${data.poli.toUpperCase()}`;
  document.getElementById("visitDate").textContent = new Date(
    data.tanggal
  ).toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Tampilkan QR code
  document.getElementById("qrCode").src = data.qrCode;

  showStatus(`Nomor antrian Anda: ${data.number}`, "success");
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

// Function to handle resetting view
function printAndReset() {
  // Hide queueResult and show queue-section
  document.getElementById("queueResult").style.display = "none";
  document.getElementById("queue-section").style.display = "block";

  // Reset the queue number display
  document.getElementById("queue-number").textContent = "";

  // Reset poli selection
  resetPoliSelection();

  // Reset status
  showStatus("Silakan scan KTP untuk antrian baru", "success");

  // Reset KTP data display
  document.getElementById("nik").textContent = "-";
  document.getElementById("nama").textContent = "-";
  currentKtpData = null;
}
