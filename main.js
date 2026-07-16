// 1. IMPORT SEMUA KOMPONEN HALAMAN
import { renderCalibration } from './components/calibration.js';
import { renderConfiguration } from './components/configuration.js';
import { renderZPLStudio } from './components/zpl_studio.js';
import { renderMaintenance } from './components/maintenance.js';
import { renderDiagnostics } from './components/diagnostics.js';

// Global State untuk mencatat log sistem yang disinkronkan ke komponen
let consoleLogs = [];

/**
 * Helper: Menulis log ke console developer dan menembakkannya ke elemen UI jika ada.
 * Fungsi ini diimpor oleh komponen lain agar semua aktivitas termonitor secara real-time.
 */
export function logToConsole(message) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    consoleLogs.push(formattedMessage);
    console.log(formattedMessage);

    // Jika ada viewport log aktif di layar (misal di ZPL Studio atau Diagnostics), update isinya
    const activeViewport = document.getElementById('zpl-viewport-logs') || document.getElementById('test-results-container');
    if (activeViewport) {
        // Khusus untuk diagnostics, biarkan fungsi internal diagnostics yang mengelola append.
        // Untuk viewport umum seperti ZPL Studio, kita bantu sinkronkan otomatis di sini.
        if (activeViewport.id === 'zpl-viewport-logs') {
            const node = document.createElement('div');
            node.textContent = `> ${formattedMessage}`;
            activeViewport.appendChild(node);
            activeViewport.scrollTop = activeViewport.scrollHeight;
        }
    }
}

// 2. MOCK DATA UNTUK DASHBOARD (Jika backend belum siap)
function renderDashboard(parentElement) {
    parentElement.innerHTML = `
        <div id="dashboard-container" class="flex flex-col gap-6">
            <div class="card">
                <h2 class="text-primary font-bold text-sm tracking-wider border-b border-border pb-3 mb-4">SYSTEM DASHBOARD</h2>
                <div class="grid grid-cols-2 gap-4">
                    <div class="p-4 bg-black/30 rounded border border-border">
                        <span class="text-textSecondary text-xs">CONNECTED DEVICE</span>
                        <div id="printer-model-display" class="text-lg font-bold text-white mt-1">Detecting...</div>
                    </div>
                    <div class="p-4 bg-black/30 rounded border border-border">
                        <span class="text-textSecondary text-xs">PORT INTERFACE</span>
                        <div id="printer-port-display" class="text-lg font-bold text-white mt-1">Scanning...</div>
                    </div>
                </div>
                <div class="mt-6">
                    <h3 class="text-xs font-bold text-textSecondary mb-2">QUICK ACTIONS</h3>
                    <button id="btn-quick-test" class="btn btn-primary text-xs">🖨️ PRINT SAMPLE TEST PAGE</button>
                </div>
            </div>
        </div>
    `;

    // Ambil data printer riil ke dashboard
    updateDashboardHardwareInfo();

    // Bind event tombol print sample test
    const btnQuickTest = document.getElementById('btn-quick-test');
    if (btnQuickTest) {
        btnQuickTest.addEventListener('click', async () => {
            logToConsole("Initiating quick test label print command...");
            try {
                if (window.go && window.go.main.App && window.go.main.App.SendRawCommand) {
                    await window.go.main.App.SendRawCommand("^XA^FO50,50^A0N,40,40^FDZDPU OK^FS^XZ\r\n");
                    logToConsole("Test print command dispatched.");
                } else {
                    logToConsole("Mock Print: ^XA^FO50,50^A0N,40,40^FDZDPU OK^FS^XZ (No hardware bound)");
                }
            } catch (err) {
                logToConsole(`Error: ${err}`);
            }
        });
    }
}

// 3. LOGIKA UPDATE STATUS PERANGKAT SECARA DINAMIS (Anti-Dustai ZD420)
async function updateDashboardHardwareInfo() {
    const modelDisplay = document.getElementById('printer-model-display');
    const portDisplay = document.getElementById('printer-port-display');
    
    try {
        if (window.go && window.go.main.App && window.go.main.App.GetActivePrinterStatus) {
            const printer = await window.go.main.App.GetActivePrinterStatus();
            if (printer && printer.id) {
                if (modelDisplay) modelDisplay.innerText = printer.model;
                if (portDisplay) portDisplay.innerText = `${printer.connectionType} (${printer.port || 'USB001'})`;
                return;
            }
        }
    } catch (e) {
        console.error("Gagal mendeteksi hardware:", e);
    }

    // Fallback jika tidak terhubung printer/backend mati
    if (modelDisplay) modelDisplay.innerText = "NO PRINTER DETECTED";
    if (portDisplay) portDisplay.innerText = "OFFLINE";
}

// 4. LOGIKA ROUTING / NAVIGASI VIEW
function navigateView(viewName) {
    const contentArea = document.getElementById('content');
    if (!contentArea) return;

    // Hapus class 'active' dari semua tombol sidebar
    document.querySelectorAll('#sidebar .nav-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-[#2D2D2D]', 'text-primary');
    });

    // Cari tombol aktif berdasarkan atribut data-view dan highlight
    const activeBtn = document.querySelector(`#sidebar [data-view="${viewName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-[#2D2D2D]');
    }

    // Kosongkan container lalu mount komponen secara presisi beserta event handlernya
    contentArea.innerHTML = '';
    logToConsole(`Mapsd to view: [${viewName.toUpperCase()}]`);

    switch (viewName) {
        case 'dashboard':
            renderDashboard(contentArea);
            break;
        case 'calibration':
            renderCalibration(contentArea);
            break;
        case 'configuration':
            renderConfiguration(contentArea);
            break;
        case 'zpl_studio':
            renderZPLStudio(contentArea);
            break;
        case 'maintenance':
            renderMaintenance(contentArea);
            break;
        case 'diagnostics':
            renderDiagnostics(contentArea);
            break;
        default:
            renderDashboard(contentArea);
            break;
    }
}

// 5. POLLING STATUS DARI BACKEND UNTUK STATUS BAR BAWAH
function startStatusPolling() {
    setInterval(async () => {
        const statusText = document.getElementById('printer-status-text');
        const targetText = document.getElementById('connected-target');

        try {
            if (window.go && window.go.main.App && window.go.main.App.GetActivePrinterStatus) {
                const printer = await window.go.main.App.GetActivePrinterStatus();
                if (printer && printer.id) {
                    if (statusText) {
                        statusText.innerText = "READY [🟢]";
                        statusText.className = "text-[#00E676] font-semibold";
                    }
                    if (targetText) {
                        targetText.innerText = `${printer.model} (${printer.connectionType})`;
                    }
                    return;
                }
            }
        } catch (err) {
            // Abaikan error polling konsol agar tidak spamming
        }

        // Tampilan default jika terputus dari printer
        if (statusText) {
            statusText.innerText = "DISCONNECTED [🔴]";
            statusText.className = "text-[#FF5252] font-semibold";
        }
        if (targetText) {
            targetText.innerText = "-";
        }
    }, 4000); // Cek koneksi printer setiap 4 detik
}

// 6. INITIALIZATION ON LOAD
document.addEventListener('DOMContentLoaded', () => {
    // Daftarkan event listener klik ke seluruh tombol sidebar
    document.querySelectorAll('#sidebar .nav-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const targetView = e.currentTarget.getAttribute('data-view');
            if (targetView) {
                navigateView(targetView);
            }
        });
    });

    // Muat halaman default pertama kali (Dashboard)
    navigateView('dashboard');

    // Aktifkan sinkronisasi polling status koneksi printer fisik
    startStatusPolling();
});
