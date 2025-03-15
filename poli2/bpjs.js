const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

// Fungsi untuk logging
function logToFile(message, type = "INFO") {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${type}] ${message}\n`;
    const logsDir = path.join(__dirname, "..", "logs");
    const logPath = path.join(logsDir, "bpjs_ocr.log");

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Write log synchronously to ensure it's written immediately
    fs.appendFileSync(logPath, logMessage);

    // Also log to console for debugging
    console.log(`${type}: ${message}`);
  } catch (err) {
    console.error("Error writing to log file:", err);
  }
}

let stream = null;
let currentBPJSData = null;
let selectedPoli = "";
let ocrTimeout = null;

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
    logToFile("Attempting to start camera");
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
    showStatus("Kamera siap. Silakan ambil foto kartu BPJS.", "success");
    logToFile("Camera started successfully");
  } catch (err) {
    logToFile(`Camera error: ${err.message}`, "ERROR");
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
    logToFile("Stopping camera");
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
  logToFile("Capturing BPJS card image");
  const canvas = document.createElement("canvas");
  const maxWidth = 1280;
  const maxHeight = 720;

  const scaleWidth = maxWidth / videoElement.videoWidth;
  const scaleHeight = maxHeight / videoElement.videoHeight;
  const scale = Math.min(scaleWidth, scaleHeight);

  const finalWidth = Math.floor(videoElement.videoWidth * scale);
  const finalHeight = Math.floor(videoElement.videoHeight * scale);

  canvas.width = finalWidth;
  canvas.height = finalHeight;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Draw video ke canvas dengan scaling
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
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);

  // Konversi ke JPEG dengan kompresi yang sesuai
  let quality = 0.7;
  let finalImageData = canvas.toDataURL("image/jpeg", quality);

  // Pastikan ukuran file di bawah 1MB
  while (finalImageData.length > 1024 * 1024 && quality > 0.1) {
    quality -= 0.1;
    finalImageData = canvas.toDataURL("image/jpeg", quality);
  }

  previewElement.src = finalImageData;
  previewElement.style.display = "block";
  previewElement.style.width = "100%";
  previewElement.style.objectFit = "contain";
  videoElement.style.display = "none";
  stopCamera();

  captureButton.disabled = true;
  startButton.disabled = false;
  showStatus("Sedang memproses kartu BPJS...", "processing");

  processBPJS(finalImageData);
  logToFile("Image captured and sent for processing");
}

// Fungsi untuk memproses BPJS
function processBPJS(imageData) {
  logToFile("Starting BPJS card processing");
  // Reset hasil sebelumnya
  document.getElementById("noBPJS").textContent = "-";
  document.getElementById("nik").textContent = "-";
  document.getElementById("nama").textContent = "-";
  document.getElementById("faskes").textContent = "-";
  currentBPJSData = null;

  // Kirim data gambar ke main process untuk diproses
  ipcRenderer.send("process-bpjs", imageData);
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
    logToFile("Queue number request failed: No poli selected", "WARNING");
    showStatus("Silakan pilih poli terlebih dahulu", "error");
    return;
  }

  if (!currentBPJSData || !currentBPJSData.nama) {
    logToFile("Queue number request failed: No BPJS data available", "WARNING");
    showStatus(
      "Data nama tidak tersedia. Silakan scan ulang kartu BPJS.",
      "error"
    );
    return;
  }

  const keluhan = document.getElementById("keluhan").value.trim();
  if (!keluhan) {
    logToFile("Queue number request failed: No complaint entered", "WARNING");
    showStatus("Silakan masukkan keluhan terlebih dahulu", "error");
    return;
  }

  logToFile(
    `Requesting queue number for poli: ${selectedPoli}, patient: ${currentBPJSData.nama}`
  );
  // Kirim permintaan nomor antrian
  ipcRenderer.send("get-queue-number", {
    poli: selectedPoli,
    bpjsData: currentBPJSData,
    keluhan: keluhan,
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

// Event listener untuk tombol-tombol poli
document.querySelectorAll(".poli-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".poli-button").forEach((btn) => {
      btn.classList.remove("selected");
    });

    button.classList.add("selected");
    selectedPoli = button.dataset.poli;

    if (currentBPJSData?.nama) {
      getQueueButton.disabled = false;
      cancelButton.disabled = false;
    }
  });
});

// Terima hasil pemrosesan BPJS
ipcRenderer.on("bpjs-result", (event, data) => {
  captureButton.disabled = false;
  resetCamera();

  if (data.error) {
    logToFile(`BPJS processing failed: ${data.error}`, "ERROR");
    showStatus("Gagal memproses BPJS: " + data.error, "error");
    queueSection.style.display = "none";
    return;
  }

  if (data.nomorBPJS && data.nama && data.faskes) {
    logToFile(
      `BPJS processed successfully for: ${data.nama} (${data.nomorBPJS})`
    );
    showStatus("BPJS berhasil diproses!", "success");

    // Tampilkan hasil
    document.getElementById("noBPJS").textContent = data.nomorBPJS || "-";
    document.getElementById("nik").textContent = data.nik || "-";
    document.getElementById("nama").textContent = data.nama;
    document.getElementById("faskes").textContent = data.faskes || "-";

    // Update validation indicators
    if (data.validationResults) {
      updateValidationIndicators(data.validationResults);
    }

    // Simpan data BPJS saat ini
    currentBPJSData = data;

    // Tampilkan bagian antrian
    queueSection.style.display = "block";

    // Aktifkan semua tombol poli
    document.querySelectorAll(".poli-button").forEach((btn) => {
      btn.disabled = false;
    });

    // Reset pilihan poli
    resetPoliSelection();
  } else {
    logToFile("BPJS processing failed: Incomplete data", "ERROR");
    showStatus(
      "Data BPJS tidak lengkap. Silakan scan ulang dengan posisi yang lebih jelas.",
      "error"
    );
    queueSection.style.display = "none";

    // Reset tampilan data
    document.getElementById("noBPJS").textContent = "-";
    document.getElementById("nik").textContent = "-";
    document.getElementById("nama").textContent = "-";
    document.getElementById("faskes").textContent = "-";
    currentBPJSData = null;
  }
});

// Terima hasil nomor antrian
ipcRenderer.on("queue-result", (event, data) => {
  resetCamera();

  if (data.error) {
    logToFile(`Queue number generation failed: ${data.error}`, "ERROR");
    showStatus(data.error, "error");
    getQueueButton.disabled = false;
    return;
  }

  logToFile(
    `Queue number generated successfully: ${data.number} for ${data.nama} at poli ${data.poli}`
  );
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

// Function untuk reset
function resetAll() {
  // Reset tampilan
  document.getElementById("queueResult").style.display = "none";
  document.getElementById("queue-section").style.display = "block";
  document.getElementById("queue-number").textContent = "";

  // Reset pilihan poli
  resetPoliSelection();

  // Reset status
  showStatus("Silakan scan kartu BPJS untuk antrian baru", "success");

  // Reset data BPJS
  document.getElementById("noBPJS").textContent = "-";
  document.getElementById("nik").textContent = "-";
  document.getElementById("nama").textContent = "-";
  document.getElementById("faskes").textContent = "-";
  currentBPJSData = null;

  // Kembali ke halaman index.html menggunakan IPC
  ipcRenderer.send("navigate", "index.html");
}

// Tambahkan event listener untuk tombol reset
document.getElementById("resetButton").addEventListener("click", resetAll);

// Fungsi untuk update indikator validasi
function updateValidationIndicators(validationResults) {
  if (!validationResults) return;

  const fields = ["nomorBPJS", "nik", "nama", "faskes"];

  fields.forEach((field) => {
    const validation = validationResults[field];
    if (validation) {
      const indicator = document.querySelector(
        `#${field} .validation-indicator`
      );
      const confidenceMeter = document.querySelector(
        `#${field} .confidence-value`
      );

      if (indicator) {
        indicator.className = `validation-indicator ${
          validation.isValid ? "validation-valid" : "validation-invalid"
        }`;
      }

      if (confidenceMeter) {
        confidenceMeter.style.width = `${validation.confidence * 100}%`;
      }
    }
  });
}
