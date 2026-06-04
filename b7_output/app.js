// ==========================================
// CONFIGURATION & GLOBAL STATE
// ==========================================
const CONFIG = {
    // Tambahin map bulan & GID lu di sini
    sheetGids: {
        "Mei": "587360054"
    },
    baseUrl: "https://docs.google.com/spreadsheets/d/10bKsfF0ozFcJSTWX5AhUJLAofJgB1o9QEL0KPRR1XIM/export?format=csv&gid="
};

// Offset map sesuai struct di models.go
const BATCH_OFFSETS = [
    { label: "Batch 1", kode: 0, batch: 1, output: 2 },
    { label: "Batch 2", kode: 4, batch: 5, output: 6 },
    { label: "Batch 3", kode: 8, batch: 9, output: 10 },
];

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

// Fungsi buat nge-parse CSV ke format 2D Array dengan aman (handle comma di dalam string)
function parseCSV(str) {
    const arr = [];
    let quote = false;
    for (let row = 0, col = 0, c = 0; c < str.length; c++) {
        let cc = str[c], nc = str[c + 1];
        arr[row] = arr[row] || [];
        arr[row][col] = arr[row][col] || '';

        if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++c; continue; }
        if (cc === '"') { quote = !quote; continue; }
        if (cc === ',' && !quote) { ++col; continue; }
        if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++c; continue; }
        if (cc === '\n' && !quote) { ++row; col = 0; continue; }
        if (cc === '\r' && !quote) { ++row; col = 0; continue; }
        
        arr[row][col] += cc;
    }
    return arr;
}

function titleCase(str) {
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatFloat(f) {
    return Number(f).toFixed(2);
}

// ==========================================
// CORE DATA FETCHING & PARSING
// ==========================================
async function fetchAndParseSheets() {
    let semuaPencapaian = [];

    for (const [namaBulan, gid] of Object.entries(CONFIG.sheetGids)) {
        try {
            const url = CONFIG.baseUrl + gid;
            const response = await fetch(url);
            
            if (!response.ok) throw new Error(`Gagal fetch GID: ${gid}`);
            
            const csvText = await response.text();
            const records = parseCSV(csvText);

            if (records.length < 5) continue;

            const totalBaris = records.length;
            const rowTanggal = records[1];
            const rowShift = records[2];
            const totalKolom = rowShift.length;

            // Loop Vertikal (Lompat per 12 baris)
            for (let mesinRow = 4; mesinRow < totalBaris; mesinRow += 12) {
                if (mesinRow >= totalBaris) break;

                let namaMesin = records[mesinRow][0]?.trim();
                if (!namaMesin && mesinRow + 1 < totalBaris) {
                    namaMesin = records[mesinRow + 1][0]?.trim();
                }

                if (!namaMesin || namaMesin.toUpperCase().includes("NAMA MESIN")) continue;
                namaMesin = titleCase(namaMesin);

                // Proses 3 Batch
                for (const b of BATCH_OFFSETS) {
                    const kodeRow = mesinRow + b.kode;
                    const batchRow = mesinRow + b.batch;
                    const outputRow = mesinRow + b.output;

                    if (outputRow >= totalBaris) continue;

                    let listDetails = [];
                    let currentTanggal = "";

                    // Loop Horizontal (Mulai dari kolom index 2 / C)
                    for (let col = 2; col < totalKolom; col++) {
                        // Caching tanggal untuk merged cell
                        if (col < rowTanggal.length && rowTanggal[col]?.trim() !== "") {
                            currentTanggal = rowTanggal[col].trim();
                        }

                        let shiftKerja = "1";
                        if (col < rowShift.length && rowShift[col]?.trim() !== "") {
                            shiftKerja = rowShift[col].trim();
                        }

                        let kodeProduk = col < records[kodeRow]?.length ? records[kodeRow][col]?.trim() : "";
                        let noBatch = col < records[batchRow]?.length ? records[batchRow][col]?.trim() : "";
                        let valOutput = col < records[outputRow]?.length ? records[outputRow][col]?.trim() : "0";

                        // Standarisasi
                        if (!valOutput || valOutput.toLowerCase() === "off" || valOutput === "-") valOutput = "0";
                        
                        const cleanKode = kodeProduk.toUpperCase();
                        if (!kodeProduk || cleanKode === "OFF" || cleanKode === "LIBUR" || cleanKode === "-") {
                            kodeProduk = "-";
                            noBatch = "-";
                        }

                        listDetails.push({
                            tanggal: currentTanggal,
                            shift: shiftKerja,
                            kode_produk: kodeProduk,
                            no_batch: noBatch,
                            output: valOutput
                        });
                    }

                    semuaPencapaian.push({
                        bulan: namaBulan,
                        mesin: namaMesin,
                        nama_batch: b.label,
                        details: listDetails
                    });
                }
            }
        } catch (error) {
            console.error(`Error processing sheet ${namaBulan}:`, error);
        }
    }
    return semuaPencapaian;
}

// ==========================================
// DATA PROCESSING (GETTERS)
// ==========================================
function getDashboardData(dataMentah, bulanFilter, mesinFilter) {
    let mapBulan = new Set(), mapMesin = new Set();
    
    dataMentah.forEach(item => {
        if (item.bulan) mapBulan.add(item.bulan);
        if (item.mesin) mapMesin.add(item.mesin);
    });

    const listBulan = Array.from(mapBulan).sort();
    const listMesin = Array.from(mapMesin).sort();

    let dataFiltered = [];
    let maxOutputs = 0;

    dataMentah.forEach(item => {
        const matchBulan = (bulanFilter === "all" || item.bulan === bulanFilter);
        const matchMesin = (mesinFilter === "all" || item.mesin === mesinFilter);

        if (matchBulan && matchMesin) {
            dataFiltered.push(item);
            if (item.details.length > maxOutputs) {
                maxOutputs = item.details.length;
            }
        }
    });

    return { bulanFilter, mesinFilter, listBulan, listMesin, data: dataFiltered, maxOutputs };
}

function getPencapaianData(dataMentah, bulanFilter, mesinFilter) {
    let mapBulan = new Set(), mapMesin = new Set();
    
    dataMentah.forEach(item => {
        if (item.bulan) mapBulan.add(item.bulan);
        if (item.mesin) mapMesin.add(item.mesin);
    });

    const listBulan = Array.from(mapBulan).sort();
    const listMesin = Array.from(mapMesin).sort();

    let mapTanggalUnik = new Set();
    dataMentah.forEach(item => {
        if (bulanFilter === "all" || item.bulan === bulanFilter) {
            item.details.forEach(det => {
                if (det.tanggal && det.tanggal !== "-") mapTanggalUnik.add(det.tanggal);
            });
        }
    });
    const uniqueDates = Array.from(mapTanggalUnik).sort();

    let mapAkumulasi = {};
    dataMentah.forEach(item => {
        const matchBulan = (bulanFilter === "all" || item.bulan === bulanFilter);
        const matchMesin = (mesinFilter === "all" || item.mesin === mesinFilter);

        if (matchBulan && matchMesin) {
            if (!mapAkumulasi[item.mesin]) mapAkumulasi[item.mesin] = {};
            
            item.details.forEach(det => {
                if (!det.tanggal || det.tanggal === "-") return;
                const outVal = parseFloat(det.output) || 0;
                mapAkumulasi[item.mesin][det.tanggal] = (mapAkumulasi[item.mesin][det.tanggal] || 0) + outVal;
            });
        }
    });

    let finalDataCapaian = [];
    const sortedMesins = Object.keys(mapAkumulasi).sort();

    sortedMesins.forEach(namaMesin => {
        let listTglCapaian = [];
        uniqueDates.forEach(tgl => {
            const totalOut = mapAkumulasi[namaMesin][tgl] || 0;
            const persenCap = totalOut > 0 ? (totalOut / 31250) : 0; // Sesuai logic Go

            listTglCapaian.push({
                tanggal: tgl,
                total_output: totalOut,
                persen_capaian: persenCap
            });
        });

        finalDataCapaian.push({
            mesin: namaMesin,
            bulan: bulanFilter,
            list_tgl: listTglCapaian
        });
    });

    return { bulanFilter, mesinFilter, listBulan, listMesin, dataCapaian: finalDataCapaian, uniqueDates };
}

// ==========================================
// RENDERING UI (DOM MANIPULATION)
// ==========================================
function renderDropdowns(payload) {
    const bulanSelect = document.getElementById('filter-bulan');
    const mesinSelect = document.getElementById('filter-mesin');
    
    if (bulanSelect) {
        bulanSelect.innerHTML = `<option value="all" ${payload.bulanFilter === 'all' ? 'selected' : ''}>-- Semua Bulan --</option>`;
        payload.listBulan.forEach(b => {
            bulanSelect.innerHTML += `<option value="${b}" ${payload.bulanFilter === b ? 'selected' : ''}>${b}</option>`;
        });
    }

    if (mesinSelect) {
        mesinSelect.innerHTML = `<option value="all" ${payload.mesinFilter === 'all' ? 'selected' : ''}>-- Semua Mesin --</option>`;
        payload.listMesin.forEach(m => {
            mesinSelect.innerHTML += `<option value="${m}" ${payload.mesinFilter === m ? 'selected' : ''}>${m}</option>`;
        });
    }

    // Update Action Buttons URL
    const btnSuccess = document.querySelector('.btn-success');
    if (btnSuccess) btnSuccess.href = `pencapaian.html?bulan=${payload.bulanFilter}&mesin=${payload.mesinFilter}`;
    
    const btnSecondary = document.querySelector('.btn-secondary');
    if (btnSecondary) btnSecondary.href = `index.html?bulan=${payload.bulanFilter}&mesin=${payload.mesinFilter}`;
}

function renderDashboardTable(payload) {
    const thead = document.querySelector('.styled-table thead');
    const tbody = document.querySelector('.styled-table tbody');
    if (!thead || !tbody) return;

    // Header Generator
    let headerRow1 = `<tr>
        <th rowspan="2" style="z-index:15; border-bottom: 2px solid #cbd5e1; vertical-align: middle;">Nama Mesin</th>
        <th rowspan="2" style="z-index:15; border-bottom: 2px solid #cbd5e1; vertical-align: middle;">Kelompok</th>`;
    let headerRow2 = `<tr>`;

    if (payload.data.length > 0) {
        const firstRowDetails = payload.data[0].details;
        firstRowDetails.forEach(detail => {
            if (detail.shift === "1") {
                headerRow1 += `<th colspan="3" style="text-align:center; font-weight: bold; border-bottom: 1px solid #cbd5e1;">📅 ${detail.tanggal || 'N/A'}</th>`;
            }
        });
        
        for (let i = 0; i < payload.maxOutputs; i++) {
            headerRow2 += `<th style="text-align:center; min-width:110px;">Shift ${(i % 3) + 1}</th>`;
        }
    } else {
        if (payload.maxOutputs > 0) {
            headerRow1 += `<th colspan="${payload.maxOutputs}" style="text-align:center;">Data Kosong</th>`;
            for (let i = 0; i < payload.maxOutputs; i++) {
                headerRow2 += `<th style="text-align:center; min-width:110px;">Shift ${(i % 3) + 1}</th>`;
            }
        }
    }
    
    headerRow1 += `</tr>`;
    headerRow2 += `</tr>`;
    thead.innerHTML = headerRow1 + headerRow2;

    // Body Generator
    let bodyHtml = ``;
    if (payload.data.length > 0) {
        payload.data.forEach(item => {
            bodyHtml += `<tr>
                <td style="font-weight: 600; color: #1e3a8a; background: #fff; position: sticky; left: 0; z-index: 5;">${item.mesin}</td>
                <td style="font-weight: 500; color: #475569; background: #fff;">${item.nama_batch}</td>`;
            
            item.details.forEach(det => {
                const isEmpty = det.output === "0";
                bodyHtml += `
                <td class="${isEmpty ? 'bg-empty' : ''}" style="text-align: center;">
                    <div class="cell-container" title="Tanggal: ${det.tanggal} | Shift: ${det.shift}">
                        <div class="badge-kode" title="Kode Produk">${det.kode_produk}</div>
                        <div class="badge-batch" title="No. Batch">${det.no_batch}</div>
                        <div class="output-value">${det.output}</div>
                    </div>
                </td>`;
            });
            bodyHtml += `</tr>`;
        });
    } else {
        bodyHtml = `<tr><td colspan="100" style="text-align:center; padding: 40px; color: #64748b;">Tidak ada data produksi yang cocok.</td></tr>`;
    }
    tbody.innerHTML = bodyHtml;
}

function renderPencapaianTable(payload) {
    const thead = document.querySelector('.styled-table thead');
    const tbody = document.querySelector('.styled-table tbody');
    if (!thead || !tbody) return;

    // Header Generator
    let headerRow1 = `<tr><th rowspan="2" style="z-index:15; border-bottom: 2px solid #cbd5e1; vertical-align: middle;">Nama Mesin</th>`;
    let headerRow2 = `<tr>`;

    payload.uniqueDates.forEach(date => {
        headerRow1 += `<th colspan="2" style="text-align:center; font-weight: bold; border-bottom: 1px solid #cbd5e1;">📅 ${date}</th>`;
        headerRow2 += `<th style="text-align:right; min-width:100px;">Output Total</th><th style="text-align:right; min-width:100px;">Pencapaian</th>`;
    });
    headerRow1 += `</tr>`;
    headerRow2 += `</tr>`;
    thead.innerHTML = headerRow1 + headerRow2;

    // Body Generator
    let bodyHtml = ``;
    if (payload.dataCapaian.length > 0) {
        payload.dataCapaian.forEach(item => {
            bodyHtml += `<tr>
                <td style="font-weight: 600; color: #1e3a8a; background: #fff; position: sticky; left: 0; z-index: 5; border-right: 2px solid #cbd5e1;">${item.mesin}</td>`;
            
            item.list_tgl.forEach(tgl => {
                const isZero = tgl.total_output === 0.0;
                bodyHtml += `
                <td class="val-total ${isZero ? 'bg-zero' : ''}">
                    ${isZero ? '-' : formatFloat(tgl.total_output)}
                </td>
                <td class="val-capaian ${isZero ? 'bg-zero' : ''}">
                    ${isZero ? '-' : formatFloat(tgl.persen_capaian)}
                </td>`;
            });
            bodyHtml += `</tr>`;
        });
    } else {
        bodyHtml = `<tr><td colspan="100" style="text-align:center; padding: 40px; color: #64748b;">Tidak ada data untuk kalkulasi pencapaian.</td></tr>`;
    }
    tbody.innerHTML = bodyHtml;
}

// ==========================================
// APP INITIALIZATION & EVENT LISTENERS
// ==========================================
async function initApp() {
    const isPencapaian = window.location.pathname.includes("pencapaian.html");
    const urlParams = new URLSearchParams(window.location.search);
    const filterBulan = urlParams.get('bulan') || 'Mei';
    const filterMesin = urlParams.get('mesin') || 'all';

    // Refresh Logic (Clear Cache)
    const refreshBtn = document.querySelector('.btn-primary');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            refreshBtn.innerHTML = "⏳ Syncing...";
            sessionStorage.removeItem("sheets_cache_v1");
            const data = await fetchAndParseSheets();
            sessionStorage.setItem("sheets_cache_v1", JSON.stringify(data));
            window.location.reload();
        });
    }

    // Load Data from Cache or Fetch
    let dataMentah = [];
    const cached = sessionStorage.getItem("sheets_cache_v1");
    if (cached) {
        dataMentah = JSON.parse(cached);
    } else {
        dataMentah = await fetchAndParseSheets();
        sessionStorage.setItem("sheets_cache_v1", JSON.stringify(dataMentah));
    }

    // Prevent default form submission and use history API to stop Github Pages 404 pathing
    document.querySelectorAll('.filter-form').forEach(form => {
        form.onsubmit = (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set('bulan', formData.get('bulan'));
            targetUrl.searchParams.set('mesin', formData.get('mesin'));
            window.history.pushState({}, '', targetUrl);
            
            // Re-render UI based on new params without page reload
            renderCurrentPage(dataMentah, targetUrl.searchParams.get('bulan'), targetUrl.searchParams.get('mesin'), isPencapaian);
        };
    });

    renderCurrentPage(dataMentah, filterBulan, filterMesin, isPencapaian);
}

function renderCurrentPage(data, bulan, mesin, isPencapaian) {
    if (isPencapaian) {
        const payload = getPencapaianData(data, bulan, mesin);
        renderDropdowns(payload);
        renderPencapaianTable(payload);
    } else {
        const payload = getDashboardData(data, bulan, mesin);
        renderDropdowns(payload);
        renderDashboardTable(payload);
    }
}

// Trigger inisialisasi pas DOM siap
document.addEventListener("DOMContentLoaded", initApp);

