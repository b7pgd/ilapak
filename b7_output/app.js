// ==========================================
// CONFIGURATION & GLOBAL STATE
// ==========================================
const CONFIG = {
    sheetGids: {
        "Mei": "587360054"
    },
    baseUrl: "https://docs.google.com/spreadsheets/d/10bKsfF0ozFcJSTWX5AhUJLAofJgB1o9QEL0KPRR1XIM/export?format=csv&gid="
};

// List kata kunci mesin valid yang disisir dari Kolom A spreadsheet asli
const VALID_MACHINE_KEYWORDS = ["JINSUNG", "SIG", "ILAPAK", "UNIFIL", "JOYEA", "YONAN"];

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

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

function cleanNamaMesin(str) {
    if (!str) return "";
    
    let upperStr = str.toUpperCase();
    if (upperStr.includes("JINSUNG 1") || upperStr.includes("JINSUNG1")) return "Jinsung 1";
    if (upperStr.includes("JINSUNG 2") || upperStr.includes("JINSUNG2")) return "Jinsung 2";
    if (upperStr.includes("JINSUNG 3") || upperStr.includes("JINSUNG3")) return "Jinsung 3";
    if (upperStr.includes("JINSUNG 4") || upperStr.includes("JINSUNG4")) return "Jinsung 4";
    if (upperStr.includes("JINSUNG 5") || upperStr.includes("JINSUNG5")) return "Jinsung 5";
    if (upperStr.includes("SIG 5") || upperStr.includes("SIG5")) return "Sig 5";
    if (upperStr.includes("SIG 6") || upperStr.includes("SIG6")) return "Sig 6";
    if (upperStr.includes("ILAPAK 11") || upperStr.includes("ILAPAK11")) return "Ilapak 11";

    let clean = str.replace(/(?:target|per|shift|=|\d+\.\d+).*$/i, "");
    clean = clean.trim();
    
    return clean.toLowerCase().split(' ').map(word => {
        if (["sig", "joyea", "unifil", "yonan", "ilapak"].includes(word)) {
            return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
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

            // Sisir baris secara sekuensial murni ke bawah mencari nama mesin
            for (let r = 3; r < totalBaris; r++) {
                let cellKolomA = records[r][0]?.trim() || "";
                
                let IsValidMachineRow = VALID_MACHINE_KEYWORDS.some(keyword => 
                    cellKolomA.toUpperCase().includes(keyword)
                );

                if (IsValidMachineRow) {
                    let namaMesinBersih = cleanNamaMesin(cellKolomA);
                    let upperNama = namaMesinBersih.toUpperCase();

                    if (namaMesinBersih === "" || upperNama.includes("KODE") || upperNama.includes("PRODUK") || upperNama.includes("BATCH")) {
                        continue;
                    }

                    let mesinRow = r;
                    
                    // PENENTUAN JUMLAH BATCH DAN OFFSET SECARA DINAMIS
                    let currentBatchOffsets = [
                        { label: "Batch 1", kode: 0, batch: 1, output: 2 },
                        { label: "Batch 2", kode: 4, batch: 5, output: 6 }
                    ];
                    let lompatanBaris = 7;

                    if (upperNama.includes("JINSUNG")) {
                        currentBatchOffsets = [
                            { label: "Batch 1", kode: 0, batch: 1, output: 2 },
                            { label: "Batch 2", kode: 4, batch: 5, output: 6 },
                            { label: "Batch 3", kode: 8, batch: 9, output: 10 }
                        ];
                        lompatanBaris = 11;
                    }

                    // Proses kelompok Batch sesuai konfigurasi dinamis mesin tersebut
                    for (const b of currentBatchOffsets) {
                        const kodeRow = mesinRow + b.kode;
                        const batchRow = mesinRow + b.batch;
                        const outputRow = mesinRow + b.output;

                        if (outputRow >= totalBaris) continue;

                        let listDetails = [];
                        let currentTanggal = "";

                        // Loop Horizontal: Sisir kolom mulai dari Kolom C (Index 2) ke kanan
                        for (let col = 2; col < totalKolom; col++) {
                            
                            if (col < rowTanggal.length && rowTanggal[col]?.trim() !== "") {
                                currentTanggal = rowTanggal[col].trim();
                            } else {
                                let pointerCol = col;
                                while (pointerCol >= 2) {
                                    if (rowTanggal[pointerCol]?.trim()) {
                                        currentTanggal = rowTanggal[pointerCol].trim();
                                        break;
                                    }
                                    pointerCol--;
                                }
                            }

                            let shiftKerja = "1";
                            if (col < rowShift.length && rowShift[col]?.trim() !== "") {
                                shiftKerja = rowShift[col].trim();
                            }

                            let kodeProduk = col < records[kodeRow]?.length ? records[kodeRow][col]?.trim() : "";
                            let noBatch = col < records[batchRow]?.length ? records[batchRow][col]?.trim() : "";
                            let valOutput = col < records[outputRow]?.length ? records[outputRow][col]?.trim() : "0";

                            if (!valOutput || valOutput.toLowerCase() === "off" || valOutput === "-") {
                                valOutput = "0";
                            }

                            let cleanKode = kodeProduk.toUpperCase();
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
                            mesin: namaMesinBersih,
                            nama_batch: b.label,
                            details: listDetails
                        });
                    }

                    r += lompatanBaris;
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
            // FIX LOGIC: Pure pembagian murni dengan 31250 untuk menghasilkan nilai desimal 0.xx
            const desimalCapaian = totalOut > 0 ? (totalOut / 31250) : 0; 

            listTglCapaian.push({
                tanggal: tgl,
                total_output: totalOut,
                persen_capaian: desimalCapaian // Menyimpan nilai desimal murni tanpa perkalian 100
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

    const btnSuccess = document.querySelector('.btn-success');
    if (btnSuccess) btnSuccess.href = `pencapaian.html?bulan=${payload.bulanFilter}&mesin=${payload.mesinFilter}`;
    
    const btnSecondary = document.querySelector('.btn-secondary');
    if (btnSecondary) btnSecondary.href = `index.html?bulan=${payload.bulanFilter}&mesin=${payload.mesinFilter}`;
}

function renderDashboardTable(payload) {
    const thead = document.querySelector('.styled-table thead');
    const tbody = document.querySelector('.styled-table tbody');
    if (!thead || !tbody) return;

    let headerRow1 = `<tr>
        <th rowspan="2" class="sticky-corner" style="vertical-align: middle;">Nama Mesin</th>
        <th rowspan="2" style="z-index:15; border-bottom: 2px solid #cbd5e1; background-color: #cbd5e1; color:#0f172a; vertical-align: middle; text-align:center;">Batch</th>`;
    let headerRow2 = `<tr>`;

    if (payload.data.length > 0) {
        let setHeaderTgl = new Set();
        const firstRowDetails = payload.data[0].details;
        
        firstRowDetails.forEach(detail => {
            if (!setHeaderTgl.has(detail.tanggal)) {
                setHeaderTgl.add(detail.tanggal);
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

    let bodyHtml = ``;
    if (payload.data.length > 0) {
        let groupedByMesin = {};
        payload.data.forEach(item => {
            if (!groupedByMesin[item.mesin]) groupedByMesin[item.mesin] = [];
            groupedByMesin[item.mesin].push(item);
        });

        Object.keys(groupedByMesin).forEach(namaMesin => {
            let recordsMesin = groupedByMesin[namaMesin];
            
            recordsMesin.forEach((item, index) => {
                const isLastRow = (index === recordsMesin.length - 1);
                bodyHtml += `<tr class="${isLastRow ? 'machine-group-end' : ''}">`;
                
                if (index === 0) {
                    bodyHtml += `<td rowspan="${recordsMesin.length}" class="sticky-col" style="font-weight: 600; color: #1e3a8a; vertical-align: middle; border-right: 2px solid #cbd5e1;">${item.mesin}</td>`;
                }
                
                bodyHtml += `<td style="font-weight: 500; background: #f8fafc; color: #475569; text-align:center; border-right: 1px solid #e2e8f0;">${item.nama_batch}</td>`;
                
                item.details.forEach(det => {
                    const isEmpty = !det.output || det.output === "0" || det.output === "0.0";
                    bodyHtml += `
                    <td class="${isEmpty ? 'bg-empty' : ''}" style="text-align: center;">
                        <div class="cell-container" title="Tanggal: ${det.tanggal} | Shift: ${det.shift} | ${item.nama_batch}">
                            <div class="badge-kode" title="Kode Produk">${det.kode_produk}</div>
                            <div class="badge-batch" title="No. Batch">${det.no_batch}</div>
                            <div class="output-value">${isEmpty ? '-' : det.output}</div>
                        </div>
                    </td>`;
                });
                bodyHtml += `</tr>`;
            });
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

    let headerRow1 = `<tr><th rowspan="2" class="sticky-corner" style="vertical-align: middle;">Nama Mesin</th>`;
    let headerRow2 = `<tr>`;

    payload.uniqueDates.forEach(date => {
        headerRow1 += `<th colspan="2" style="text-align:center; font-weight: bold; border-bottom: 1px solid #cbd5e1;">📅 ${date}</th>`;
        headerRow2 += `<th style="text-align:right; min-width:100px;">Output Total</th><th style="text-align:right; min-width:100px;">Pencapaian</th>`;
    });
    headerRow1 += `</tr>`;
    headerRow2 += `</tr>`;
    thead.innerHTML = headerRow1 + headerRow2;

    let bodyHtml = ``;
    if (payload.dataCapaian.length > 0) {
        payload.dataCapaian.forEach(item => {
            bodyHtml += `<tr>
                <td class="sticky-col" style="font-weight: 600; color: #1e3a8a; border-right: 2px solid #cbd5e1;">${item.mesin}</td>`;
            
            item.list_tgl.forEach(tgl => {
                const isZero = tgl.total_output === 0 || tgl.total_output === 0.0;
                bodyHtml += `
                <td class="val-total ${isZero ? 'bg-empty' : ''}" style="text-align: right;">
                    ${isZero ? '-' : formatFloat(tgl.total_output)}
                </td>
                <td class="val-capaian ${isZero ? 'bg-empty' : ''}" style="text-align: right; font-weight: bold; color: ${tgl.persen_capaian >= 1.0 ? '#10b981' : '#f59e0b'}">
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

    let dataMentah = [];
    const cached = sessionStorage.getItem("sheets_cache_v1");
    if (cached) {
        dataMentah = JSON.parse(cached);
    } else {
        dataMentah = await fetchAndParseSheets();
        sessionStorage.setItem("sheets_cache_v1", JSON.stringify(dataMentah));
    }

    document.querySelectorAll('.filter-form').forEach(form => {
        form.onsubmit = (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set('bulan', formData.get('bulan'));
            targetUrl.searchParams.set('mesin', formData.get('mesin'));
            window.history.pushState({}, '', targetUrl);
            
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

document.addEventListener("DOMContentLoaded", initApp);

