// Konfigurasi ID Spreadsheet dan Nama Sheet target (SUDAH DIPERBAIKI)
const SPREADSHEET_ID = "1diDoncpjBk1qbDt4XVJZbOMEraHHIweHTjYAuKo_4gw";
const SHEET_NAME = "Ruah 2025"; 
const STORAGE_SHEETS = [
    { month: "September", gid: "342043881" },
    { month: "October", gid: "1101355929" },
    { month: "November", gid: "407360103" },
    { month: "December", gid: "2125903335" }
];
const STORAGE_ASSETS = {
    SILVERSON: {
        1: "2BTNK02004", 2: "2BTNK02005", 3: "2BTNK02006", 4: "2BTNK02007",
        5: "2BTNK02008", 6: "2BTNK02009", 7: "2BTNK02010", 8: "2BTNK02011",
        9: "2BTNK02012", 10: "2BTNK02013", 11: "2BTNK02014", 12: "2BTNK02015",
        13: "2BTNK02016", 14: "2BTNK02017", 15: "2BTNK02018"
    },
    "TETRA 1": {
        1: "2BTNK02004", 2: "2BTNK02005", 3: "2BTNK02006", 4: "2BTNK02007",
        5: "2BTNK02008", 6: "2BTNK02009", 7: "2BTNK02010", 8: "2BTNK02011",
        9: "2BTNK02012", 10: "2BTNK02013", 11: "2BTNK02014", 12: "2BTNK02015",
        13: "2BTNK02016", 14: "2BTNK02017", 15: "2BTNK02018"
    },
    "TETRA 2": {
        3: "2BTNK02021", 4: "2BTNK02022", 5: "2BTNK02023", 6: "2BTNK02024",
        7: "2BTNK02025", 8: "2BTNK02026", 9: "2BTNK02027", 10: "2BTNK02028",
        11: "2BTNK02029", 12: "2BTNK02030", 13: "2BTNK02031", 14: "2BTNK02032",
        15: "2BTNK02033", 16: "2BTNK02034", 17: "2BTNK02035"
    },
    "TETRA 3": {
        3: "2BTNK02021", 4: "2BTNK02022", 5: "2BTNK02023", 6: "2BTNK02024",
        7: "2BTNK02025", 8: "2BTNK02026", 9: "2BTNK02027", 10: "2BTNK02028",
        11: "2BTNK02029", 12: "2BTNK02030", 13: "2BTNK02031", 14: "2BTNK02032",
        15: "2BTNK02033", 16: "2BTNK02034", 17: "2BTNK02035"
    }
};
const TETRA_REAL_STORAGE_LABELS = {
    3: "3",
    4: "4",
    5: "5",
    6: "6",
    7: "7",
    8: "8",
    9: "9",
    10: "10",
    11: "11",
    12: "1/12",
    13: "2/13",
    14: "3/14",
    15: "4/15",
    16: "5/16",
    17: "6/17"
};

/**
 * SOLUSI TERBAIK & INSTAN (MENGGUNAKAN JALUR CSV EKSPOR):
 * Menggunakan format ekspor CSV resmi dari Google agar loading super cepat (kurang dari 1 detik).
 * Pemotongan 15 data terbaru dilakukan langsung di browser secara ringan.
 */
const GOOGLE_SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// Global State Data Storage (Hanya menyimpan 15 data yang ditampilkan di dashboard)
let productsData = [];
let storageData = new Map();
let isFirstLoad = true; // Penanda untuk menghindari animasi kedip saat auto-refresh

// Registrasi DOM Elements
const searchInput = document.getElementById("search-input");
const autocompleteBox = document.getElementById("autocomplete-box");
const latestDataGrid = document.getElementById("latest-data-grid");
const loadingSpinner = document.getElementById("loading-spinner");
const searchResultContainer = document.getElementById("search-result-container");
const searchResultCard = document.getElementById("search-result-card");
const closeResultBtn = document.getElementById("close-result");
const clearSearchBtn = document.getElementById("clear-search");

// Inisialisasi awal aplikasi saat DOM siap
document.addEventListener("DOMContentLoaded", () => {
    fetchData();
    
    // Fitur Auto Refresh otomatis berjalan setiap 30 detik untuk membaca data terbaru
    setInterval(fetchData, 30000);

    // Event Listeners Interaksi
    searchInput.addEventListener("input", handleSearchInput);
    closeResultBtn.addEventListener("click", hideSearchResult);
    clearSearchBtn.addEventListener("click", clearSearch);

    // Sembunyikan box autocomplete jika pengguna klik di luar area input pencarian
    document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !autocompleteBox.contains(e.target)) {
            autocompleteBox.classList.add("hidden");
        }
    });
});

// Mengambil data real-time dari Google Sheets (Format CSV)
async function fetchData() {
    // Hanya tampilkan alert loading penuh di tengah halaman pada muatan pertama kali
    if (isFirstLoad) {
        showBodyStatus("loading", "Sedang memproses data spreadsheet...");
    }
    showLoading(true);
    
    try {
        const response = await fetch(GOOGLE_SHEETS_URL);
        if (!response.ok) throw new Error("Koneksi ke Google Sheets terputus atau nama sheet salah.");
        
        const csvText = await response.text();
        if (!csvText || csvText.trim() === "") throw new Error("Spreadsheet kosong atau tidak mengembalikan data.");
        
        storageData = await fetchStorageData();
        processCSVData(csvText);
        isFirstLoad = false; // Setel ke false setelah berhasil memuat pertama kali
    } catch (error) {
        console.error("Gagal mengambil data dari Google Sheets QC Inspector:", error);
        if (isFirstLoad || productsData.length === 0) {
            showBodyStatus("error", `Gagal memuat data: ${error.message}. Pastikan Sheet sudah di-publish/share ke publik.`);
        }
    } finally {
        showLoading(false);
    }
}

async function fetchStorageData() {
    const sheetResults = await Promise.all(STORAGE_SHEETS.map(async ({ month, gid }) => {
        const url = `https://docs.google.com/spreadsheets/d/10bKsfF0ozFcJSTWX5AhUJLAofJgB1o9QEL0KPRR1XIM/export?format=csv&gid=${gid}`;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const rows = parseCSVRows(await response.text());
            const records = [];
            for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                const machineRow = rows[rowIndex];
                if ((machineRow[1] || "").trim().toLowerCase() !== "mesin") continue;

                const productRow = rows[rowIndex + 1] || [];
                const batchRow = rows[rowIndex + 2] || [];
                const storageRow = rows[rowIndex + 7] || [];
                for (let column = 2; column < batchRow.length; column++) {
                    const product = (productRow[column] || "").trim();
                    const batch = (batchRow[column] || "").trim();
                    const machine = (machineRow[column] || "").trim();
                    const rawBin = (storageRow[column] || "").trim();
                    const bin = rawBin.split("/")[0].trim();
                    if (!product || !batch || !machine || !bin) continue;

                    const machineKey = machine.toUpperCase().replace(/\s+/g, " ");
                    const machineLabel = machineKey.toLowerCase().replace(/\b\w/g, character => character.toUpperCase());
                    const storageNumber = STORAGE_ASSETS[machineKey]?.[bin] || "";
                    let locationLabel;
                    if (machineKey === "TETRA 2" || machineKey === "TETRA 3") {
                        const realStorage = TETRA_REAL_STORAGE_LABELS[bin] || bin;
                        locationLabel = `${machineLabel} Storage ${realStorage}`;
                    } else if (machineKey === "SILVERSON" || machineKey === "TETRA 1") {
                        locationLabel = `${machineLabel} Storage ${bin}`;
                    } else {
                        locationLabel = `${machineLabel} bin ${bin}`;
                    }

                    records.push({
                        key: createStorageKey(product, batch),
                        label: locationLabel,
                        storageNumber
                    });
                }
            }
            return records;
        } catch (error) {
            console.warn(`Gagal mengambil data storage bulan ${month}:`, error);
            return [];
        }
    }));

    const data = new Map();
    sheetResults.flat().forEach(record => data.set(record.key, record));
    return data;
}

function createStorageKey(product, batch) {
    return `${product}${batch}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// Menampilkan pesan status/alert langsung di tengah body grid dashboard
function showBodyStatus(type, message) {
    if (!latestDataGrid) return;
    
    if (type === "loading") {
        latestDataGrid.innerHTML = `
            <div class="col-span-full bg-blue-50/50 p-12 text-center rounded-2xl border border-blue-100 text-blue-600 animate-pulse">
                <i class="fa-solid fa-spinner fa-spin text-4xl mb-3 block text-blue-500"></i>
                <span class="font-medium text-base">${message}</span>
            </div>`;
    } else if (type === "error") {
        latestDataGrid.innerHTML = `
            <div class="col-span-full bg-rose-50 p-12 text-center rounded-2xl border border-rose-100 text-rose-600">
                <i class="fa-solid fa-triangle-exclamation text-4xl mb-3 block text-rose-500"></i>
                <span class="font-bold text-base block mb-1">Terjadi Kesalahan</span>
                <span class="text-sm text-rose-500/90">${message}</span>
            </div>`;
    }
}

function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === '"') {
            if (inQuotes && text[index + 1] === '"') {
                value += '"';
                index++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (character === "," && !inQuotes) {
            row.push(value);
            value = "";
        } else if (character === "\n" && !inQuotes) {
            row.push(value.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            value = "";
        } else {
            value += character;
        }
    }

    if (value || row.length) {
        row.push(value.replace(/\r$/, ""));
        rows.push(row);
    }
    return rows;
}

// Transformasi & Pemetaan Struktur Kolom Spreadsheet berbasis CSV
function processCSVData(csvText) {
    const rows = parseCSVRows(csvText);
    if (rows.length <= 1) {
        productsData = [];
        renderLatestData();
        return;
    }

    let parsedRows = [];

    // Loop mulai dari index 1 (melewati header baris ke-0)
    for (let i = 1; i < rows.length; i++) {
        const cells = rows[i];
        if (cells.every(cell => cell.trim() === "")) continue;
        
        // Pemetaan Sesuai Petunjuk Teknis:
        // Kolom B (Index 1) = Kode Produk, Kolom D (Index 3) = Nama Produk
        // Kolom J (Index 9) = Approved Supv, Kolom K (Index 10) = Status Release
        let kodeProdukRaw = cells[1] ? cells[1].trim() : "";
        const namaProduk = cells[3] ? cells[3].trim() : "";
        const rawApproved = cells[9] ? cells[9].trim() : "";
        const rawRelease = cells[10] ? cells[10].trim() : "";

        if (kodeProdukRaw === "") continue; // Bersihkan baris kosong jika ada

        // Format Kode Produk: Pisah dengan spasi setelah 5 huruf pertama
        let kodeProduk = kodeProdukRaw;
        if (kodeProdukRaw.length > 5) {
            kodeProduk = kodeProdukRaw.substring(0, 5) + " " + kodeProdukRaw.substring(5);
        }

        const storage = storageData.get(createStorageKey(kodeProdukRaw.substring(0, 5), kodeProdukRaw.substring(5)));
        const storageLabel = storage?.label || "";

        const isApproved = rawApproved !== "";
        const isReleased = rawRelease !== "";

        parsedRows.push({
            rowNumber: i + 1, 
            kodeProduk: kodeProduk,
            namaProduk: namaProduk,
            storageLabel: storageLabel,
            storageNumber: storage?.storageNumber || "",
            isApproved: isApproved,
            isReleased: isReleased,
            approvedTime: rawApproved, // Menyimpan teks tanggal/jam asli dari kolom J
            releasedTime: rawRelease   // Menyimpan teks tanggal/jam asli dari kolom K
        });
    }

    // AMBIL HANYA 15 DATA TERAKHIR DARI ARRAY (Untuk Dashboard & Pencarian Terbatas)
    productsData = parsedRows.slice(-50);

    // Perbarui Tampilan Dashboard Utama
    renderLatestData();
}

// Merender atau memperbarui data secara langsung ke elemen tanpa menghapus grid (Menghindari blip)
function renderLatestData() {
    if (productsData.length === 0) {
        latestDataGrid.innerHTML = `
            <div class="col-span-full bg-white p-8 text-center rounded-2xl border border-slate-100 text-slate-400">
                <i class="fa-solid fa-box-open text-3xl mb-2 block text-slate-300"></i>
                Tidak ditemukan data transaksi produk bulk pada sheet Ruah 2025.
            </div>`;
        return;
    }

    // Membalikkan urutan (reverse) agar data terbaru berada di atas dashboard
    const displayData = [...productsData].reverse();

    // Jika ini adalah muatan pertama kali atau struktur grid kosong, buat struktur dasarnya
    if (latestDataGrid.querySelector('.animate-pulse') || latestDataGrid.children.length !== displayData.length) {
        latestDataGrid.innerHTML = "";
        displayData.forEach(item => {
            latestDataGrid.appendChild(createCardElement(item));
        });
        return;
    }

    // Pembaruan Pintar (Update Teks Senyap): Mengganti isi teks tanpa merusak scroll / re-render card
    displayData.forEach((item, index) => {
        const card = latestDataGrid.children[index];
        if (!card) return;

        // Validasi kecocokan baris data agar posisinya akurat
        card.setAttribute("data-row", item.rowNumber);

        // Update bagian Kode Produk dan Nama Produk jika berbeda
        const codeBadge = card.querySelector(".product-code-badge");
        if (codeBadge && codeBadge.innerText !== item.kodeProduk) codeBadge.innerText = item.kodeProduk;

        const titleText = card.querySelector(".product-title-text");
        if (titleText && titleText.innerText !== (item.namaProduk || "-")) {
            titleText.innerText = item.namaProduk || "-";
            titleText.title = item.namaProduk;
        }

        const storageText = card.querySelector(".storage-status-text");
        if (storageText) storageText.textContent = item.storageLabel || "Tidak ditemukan";
        const storageNumberText = card.querySelector(".storage-number-text");
        if (storageNumberText) storageNumberText.textContent = item.storageNumber || "Tidak ditemukan";

        // Update Badge & Teks Status Approved secara real-time di tempat
        const appvContainer = card.querySelector(".approved-status-container");
        if (appvContainer) {
            const appvBadgeClass = item.isApproved ? "text-emerald-600 bg-emerald-50 border-emerald-100" : "text-rose-600 bg-rose-50 border-rose-100";
            const appvIcon = item.isApproved ? "fa-solid fa-circle-check text-emerald-500" : "fa-solid fa-circle-xmark text-rose-500";
            const appvText = item.isApproved ? item.approvedTime : "Belum approve";

            appvContainer.className = `approved-status-container px-2.5 py-1 rounded-full border ${appvBadgeClass} flex items-center gap-1.5 font-bold text-xs text-right break-all`;
            appvContainer.innerHTML = `<i class="${appvIcon}"></i> ${appvText}`;
        }

        // Update Badge & Teks Status Released secara real-time di tempat
        const relContainer = card.querySelector(".released-status-container");
        if (relContainer) {
            const relBadgeClass = item.isReleased ? "text-emerald-600 bg-emerald-50 border-emerald-100" : "text-rose-600 bg-rose-50 border-rose-100";
            const relIcon = item.isReleased ? "fa-solid fa-circle-check text-emerald-500" : "fa-solid fa-circle-xmark text-rose-500";
            const relText = item.isReleased ? item.releasedTime : "Belum release";

            relContainer.className = `released-status-container px-2.5 py-1 rounded-full border ${relBadgeClass} flex items-center gap-1.5 font-bold text-xs text-right break-all`;
            relContainer.innerHTML = `<i class="${relIcon}"></i> ${relText}`;
        }
    });
}

// Fungsi Generator Komponen UI Card Status
function createCardElement(item) {
    const card = document.createElement("div");
    card.className = "bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all duration-200 flex flex-col justify-between space-y-4";
    card.setAttribute("data-row", item.rowNumber);
    
    const appvBadgeClass = item.isApproved ? "text-emerald-600 bg-emerald-50 border-emerald-100" : "text-rose-600 bg-rose-50 border-rose-100";
    const appvIcon = item.isApproved ? "fa-solid fa-circle-check text-emerald-500" : "fa-solid fa-circle-xmark text-rose-500";
    const appvText = item.isApproved ? item.approvedTime : "Belum approve";

    const relBadgeClass = item.isReleased ? "text-emerald-600 bg-emerald-50 border-emerald-100" : "text-rose-600 bg-rose-50 border-rose-100";
    const relIcon = item.isReleased ? "fa-solid fa-circle-check text-emerald-500" : "fa-solid fa-circle-xmark text-rose-500";
    const relText = item.isReleased ? item.releasedTime : "Belum release";

    card.innerHTML = `
        <div class="space-y-2">
            <div class="flex justify-between items-start">
                <span class="product-code-badge text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md tracking-wider">
                    ${item.kodeProduk}
                </span>
            </div>
            <h3 class="product-title-text text-base font-semibold text-slate-800 line-clamp-2" title="${item.namaProduk}">
                ${item.namaProduk || "-"}
            </h3>
        </div>
        
        <div class="space-y-2.5 pt-3 border-t border-slate-100">
            <div class="flex justify-between items-center gap-4 text-sm">
                <span class="text-slate-400 text-xs font-medium shrink-0">Storage :</span>
                <span class="storage-status-text text-slate-700 text-xs font-semibold text-right">${escapeHTML(item.storageLabel || "Tidak ditemukan")}</span>
            </div>
            <div class="flex justify-between items-center gap-4 text-sm">
                <span class="text-slate-400 text-xs font-medium shrink-0">No Storage :</span>
                <span class="storage-number-text text-slate-700 text-xs font-semibold text-right">${escapeHTML(item.storageNumber || "Tidak ditemukan")}</span>
            </div>
            <div class="flex justify-between items-center gap-4 text-sm">
                <span class="text-slate-400 text-xs font-medium shrink-0">Approved Supv QC :</span>
                <span class="approved-status-container px-2.5 py-1 rounded-full border ${appvBadgeClass} flex items-center gap-1.5 font-bold text-xs text-right break-all">
                    <i class="${appvIcon}"></i> ${appvText}
                </span>
            </div>
            <div class="flex justify-between items-center gap-4 text-sm">
                <span class="text-slate-400 text-xs font-medium shrink-0">Status Release :</span>
                <span class="released-status-container px-2.5 py-1 rounded-full border ${relBadgeClass} flex items-center gap-1.5 font-bold text-xs text-right break-all">
                    <i class="${relIcon}"></i> ${relText}
                </span>
            </div>
        </div>
    `;
    return card;
}

// Logika Input Pencarian (Hanya menyaring data yang tampil aktif di dashboard)
function handleSearchInput(e) {
    const query = e.target.value.toLowerCase().trim();
    
    if (query.length > 0) {
        clearSearchBtn.classList.remove("hidden");
    } else {
        clearSearchBtn.classList.add("hidden");
        autocompleteBox.classList.add("hidden");
        return;
    }

    // Filter dari 15 data dashboard aktif saja
    const filtered = productsData.filter(item => 
        item.kodeProduk.toLowerCase().includes(query) || 
        item.namaProduk.toLowerCase().includes(query)
    );

    const suggestions = filtered.slice(0, 8);
    renderAutocompleteSuggestions(suggestions);
}

// Merender Dropdown Item Autocomplete
function renderAutocompleteSuggestions(suggestions) {
    autocompleteBox.innerHTML = "";
    
    if (suggestions.length === 0) {
        autocompleteBox.innerHTML = `<div class="px-4 py-3 text-sm text-slate-400 italic">Produk tidak ditemukan di dashboard</div>`;
        autocompleteBox.classList.remove("hidden");
        return;
    }

    suggestions.forEach(item => {
        const itemRow = document.createElement("div");
        itemRow.className = "px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 transition-colors flex justify-between items-center text-sm";
        itemRow.innerHTML = `
            <div class="flex flex-col">
                <span class="font-bold text-blue-600">${item.kodeProduk}</span>
                <span class="text-xs text-slate-500 line-clamp-1">${item.namaProduk}</span>
            </div>
            <span class="w-2 h-2 rounded-full ${item.isReleased ? 'bg-emerald-500' : 'bg-rose-400'} shadow-xs"></span>
        `;
        
        itemRow.addEventListener("click", () => {
            searchInput.value = item.kodeProduk;
            autocompleteBox.classList.add("hidden");
            showSearchResultCard(item);
        });
        
        autocompleteBox.appendChild(itemRow);
    });

    autocompleteBox.classList.remove("hidden");
}

// Menampilkan Hasil Pencarian Spesifik dari Dashboard
function showSearchResultCard(item) {
    searchResultCard.innerHTML = "";
    
    const card = document.createElement("div");
    card.className = "bg-gradient-to-br from-blue-50/50 to-white rounded-2xl p-5 border-2 border-blue-500/30 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 w-full";
    
    const appvBadgeClass = item.isApproved ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-rose-700 bg-rose-50 border-rose-200";
    const appvIcon = item.isApproved ? "fa-solid fa-circle-check text-emerald-500" : "fa-solid fa-circle-xmark text-rose-500";
    const appvText = item.isApproved ? item.approvedTime : "Belum approve";
    
    const relBadgeClass = item.isReleased ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-rose-700 bg-rose-50 border-rose-200";
    const relIcon = item.isReleased ? "fa-solid fa-circle-check text-emerald-500" : "fa-solid fa-circle-xmark text-rose-500";
    const relText = item.isReleased ? item.releasedTime : "Belum release";

    card.innerHTML = `
        <div class="space-y-1.5 flex-1">
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-white bg-blue-600 px-2.5 py-0.5 rounded-md tracking-wider uppercase">
                    ${item.kodeProduk}
                </span>
                <span class="text-xs text-slate-400">Hasil Pencarian Dashboard</span>
            </div>
            <h3 class="text-lg font-bold text-slate-900">${item.namaProduk || "-"}</h3>
        </div>
        
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 min-w-[280px]">
            <div class="flex-1 bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-center items-start gap-1">
                <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Storage</span>
                <div class="text-xs font-semibold text-slate-700 mt-1">${escapeHTML(item.storageLabel || "Tidak ditemukan")}</div>
            </div>
            <div class="flex-1 bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-center items-start gap-1">
                <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">No Storage</span>
                <div class="text-xs font-semibold text-slate-700 mt-1">${escapeHTML(item.storageNumber || "Tidak ditemukan")}</div>
            </div>
            <div class="flex-1 bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-center items-start gap-1">
                <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Approved Supv</span>
                <div class="px-2.5 py-1 rounded-lg border ${appvBadgeClass} flex items-center gap-1.5 font-bold text-xs mt-1 break-all">
                    <i class="${appvIcon}"></i> ${appvText}
                </div>
            </div>
            <div class="flex-1 bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-center items-start gap-1">
                <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Status Release</span>
                <div class="px-2.5 py-1 rounded-lg border ${relBadgeClass} flex items-center gap-1.5 font-bold text-xs mt-1 break-all">
                    <i class="${relIcon}"></i> ${relText}
                </div>
            </div>
        </div>
    `;

    searchResultCard.appendChild(card);
    searchResultContainer.classList.remove("hidden");
    searchResultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideSearchResult() {
    searchResultContainer.classList.add("hidden");
    searchResultCard.innerHTML = "";
}

function clearSearch() {
    searchInput.value = "";
    clearSearchBtn.classList.add("hidden");
    autocompleteBox.classList.add("hidden");
    hideSearchResult();
}

function showLoading(isLoading) {
    if (loadingSpinner) {
        if (isLoading) {
            loadingSpinner.classList.remove("opacity-0", "pointer-events-none");
        } else {
            loadingSpinner.classList.add("opacity-0", "pointer-events-none");
        }
    }
}
