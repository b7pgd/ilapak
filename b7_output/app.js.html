// ==========================================
// CONFIGURATION & GLOBAL STATE
// ==========================================
const CONFIG = {
    sheetGids: {
        "Mei": "587360054"
    },
    baseUrl: "https://docs.google.com/spreadsheets/d/10bKsfF0ozFcJSTWX5AhUJLAofJgB1o9QEL0KPRR1XIM/export?format=csv&gid="
};

// Offset internal data baris lembar kerja Google Sheets
const BATCH_OFFSETS = [
    { kode: 0, batch: 1, output: 2 },  // Batch 1
    { kode: 4, batch: 5, output: 6 },  // Batch 2
    { kode: 8, batch: 9, output: 10 }, // Batch 3
];

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

function cleanAndCleanNamaMesin(str) {
    if (!str) return "";
    // Regex hapus text "target Per Shift..." ke belakang secara aman
    let clean = str.replace(/(?:target\s+per\s+shift|shift\s*\d+\s*=).*$/i, "");
    // Bersihkan spasi sisa di ujung teks
    clean = clean.trim();
    
    // Konversi ke format Title Case standar
    return clean.toLowerCase().split(' ').map(word => {
        // Biarkan singkatan tetap uppercase (Contoh: SIG, LKJTA) jika aslinya huruf besar semua
        if (word.toUpperCase() === "SIG" || word.toUpperCase() === "JOYEA" || word.toUpperCase() === "UNIFIL") {
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

            // Map untuk melakukan akumulasi horizontal data 3 batch menjadi 1 baris per mesin
            let mapGabunganMesin = {};

            // Telusuri baris secara dinamis tanpa hardcode lompatan kelipatan agar menjangkau baris tak terbatas (> A136)
            for (let r = 3; r < totalBaris; r++) {
                let cellPertama = records[r][0]?.trim() || "";
                
                // Cari cell penanda awal block mesin (mempunyai string target atau nama mesin murni)
                if (cellPertama !== "" && !cellPertama.toUpperCase().includes("NAMA MESIN") && cellPertama !== "-") {
                    
                    let namaMesinMentah = cellPertama;
                    let mesinRow = r;
                    let namaMesinBersih = cleanAndCleanNamaMesin(namaMesinMentah);

                    if (!mapGabunganMesin[namaMesinBersih]) {
                        mapGabunganMesin[namaMesinBersih] = {
                            bulan: namaBulan,
                            mesin: namaMesinBersih,
                            details: []
                        };
                    }

                    // Inisialisasi detail temporary untuk menampung kompilasi horizontal kolom
                    let rincianKolomTmp = {};

                    // Loop Horizontal Kolom Data (Mulai dari kolom C / Index 2)
                    for (let col = 2; col < totalKolom; col++) {
                        // FIX BUG LOOPING TANGGAL: Cari penanda tanggal yang pas sesuai rentang kolom koordinatnya
                        let currentTanggal = "";
                        let targetCol = col;
                        while (targetCol >= 2) {
                            if (rowTanggal[targetCol]?.trim()) {
                                currentTanggal = rowTanggal[targetCol].trim();
                                break;
                            }
                            targetCol--;
                        }

                        let shiftKerja = "1";
                        if (col < rowShift.length && rowShift[col]?.trim() !== "") {
                            shiftKerja = rowShift[col].trim();
                        }

                        // Buat key koordinat unik berbasis Tanggal & Shift agar data batch 1, 2, 3 tidak tumpang tindih
                        const keyKolom = `${currentTanggal}_${shiftKerja}_${col}`;

                        if (!rincianKolomTmp[keyKolom]) {
                            rincianKolomTmp[keyKolom] = {
                                tanggal: currentTanggal,
                                shift: shiftKerja,
                                kode_produk: "-",
                                no_batch: "-",
                                output: 0
                            };
                        }

                        // Ekstrak nilai dari ke-3 Batch secara vertikal 
                        for (const b of BATCH_OFFSETS) {
                            const kodeRow = mesinRow + b.kode;
                            const batchRow = mesinRow + b.batch;
                            const outputRow = mesinRow + b.output;

                            if (outputRow >= totalBaris) continue;

                            let kodeProduk = col < records[kodeRow]?.length ? records[kodeRow][col]?.trim() : "";
                            let noBatch = col < records[batchRow]?.length ? records[batchRow][col]?.trim() : "";
                            let valOutput = col < records[outputRow]?.length ? records[outputRow][col]?.trim() : "0";

                            // Standardisasi nilai kosong / off
                            if (!valOutput || valOutput.toLowerCase() === "off" || valOutput === "-") valOutput = "0";
                            let floatOut = parseFloat(valOutput) || 0;

                            const cleanKode = kodeProduk.toUpperCase();
                            if (kodeProduk && cleanKode !== "OFF" && cleanKode !== "LIBUR" && cleanKode !== "-") {
                                rincianKolomTmp[keyKolom].kode_produk = kodeProduk;
                            }
                            if (noBatch && noBatch !== "-") {
                                rincianKolomTmp[keyKolom].no_batch = noBatch;
                            }
                            
                            // Akumulasikan nilai output batch secara matematis
                            rincianKolomTmp[keyKolom].output += floatOut;
                        }
                    }

                    // Pindahkan data rincian kolom temporary ke susunan array utama milik mesin terkait
                    Object.keys(rincianKolomTmp).forEach(key => {
                        let itemKolom = rincianKolomTmp[key];
                        // Kembalikan tipe data string output untuk keperluan visual badge UI
                        itemKolom.output = String(itemKolom.output);
                        mapGabunganMesin[namaMesinBersih].details.push(itemKolom);
                    });

                    // Lompat ke baris terbawah block batch mesin ini agar pembacaan baris berikutnya tidak double parse
                    r += 11; 
                }
            }

            // Push seluruh objek olahan mesin ke penampung final
            Object.values(mapGabunganMesin).forEach(objMesin => {
                semuaPencapaian.push(objMesin);
            });

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
    
    // Sort tanggal agar terurut kronologis rapi ke samping kanan
    const uniqueDates = Array.from(mapTanggalUnik).sort((a, b) => {
        return new Date(a) - new Date(b);
    });

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
            const persenCap = totalOut > 0 ? (totalOut / 31250) * 100 : 0; // Skala persentase %

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

    const btnSuccess = document.querySelector('.btn-success');
    if (btnSuccess) btnSuccess.href = `pencapaian.html?bulan=${payload.bulanFilter}&mesin=${payload.mesinFilter}`;
    
    const btnSecondary = document.querySelector('.btn-secondary');
    if (btnSecondary) btnSecondary.href = `index.html?bulan=${payload.bulanFilter}&mesin=${payload.mesinFilter}`;
}

function renderDashboardTable(payload) {
    const thead = document.querySelector('.styled-table thead');
    const tbody = document.querySelector('.styled-table tbody');
    if (!thead || !tbody) return;

    // Header Generator (Row Kelompok sudah dibuang total dari string TH)
    let headerRow1 = `<tr>
        <th rowspan="2" style="z-index:15; border-bottom: 2px solid #cbd5e1; vertical-align: middle;">Nama Mesin</th>`;
    let headerRow2 = `<tr>`;

    if (payload.data.length > 0) {
        // Track tanggal yang sudah masuk header biar ga terulang double loop
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

    // Body Generator (TD Kelompok dibuang, menyisakan 1 row solid per nama mesin)
    let bodyHtml = ``;
    if (payload.data.length > 0) {
        payload.data.forEach(item => {
            bodyHtml += `<tr>
                <td style="font-weight: 600; color: #1e3a8a; background: #fff; position: sticky; left: 0; z-index: 5; border-right: 2px solid #cbd5e1;">${item.mesin}</td>`;
            
            item.details.forEach(det => {
                const isEmpty = !det.output || det.output === "0";
                bodyHtml += `
                <td class="${isEmpty ? 'bg-empty' : ''}" style="text-align: center;">
                    <div class="cell-container" title="Tanggal: ${det.tanggal} | Shift: ${det.shift}">
                        <div class="badge-kode" title="Kode Produk">${det.kode_produk}</div>
                        <div class="badge-batch" title="No. Batch">${det.no_batch}</div>
                        <div class="output-value">${isEmpty ? '-' : det.output}</div>
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

    let headerRow1 = `<tr><th rowspan="2" style="z-index:15; border-bottom: 2px solid #cbd5e1; vertical-align: middle;">Nama Mesin</th>`;
    let headerRow2 = `<tr>`;

    payload.uniqueDates.forEach(date => {
        headerRow1 += `<th colspan="2" style="text-align:center; font-weight: bold; border-bottom: 1px solid #cbd5e1;">📅 ${date}</th>`;
        headerRow2 += `<th style="text-align:right; min-width:100px;">Output Total</th><th style="text-align:right; min-width:100px;">Pencapaian (%)</th>`;
    });
    headerRow1 += `</tr>`;
    headerRow2 += `</tr>`;
    thead.innerHTML = headerRow1 + headerRow2;

    let bodyHtml = ``;
    if (payload.dataCapaian.length > 0) {
        payload.dataCapaian.forEach(item => {
            bodyHtml += `<tr>
                <td style="font-weight: 600; color: #1e3a8a; background: #fff; position: sticky; left: 0; z-index: 5; border-right: 2px solid #cbd5e1;">${item.mesin}</td>`;
            
            item.list_tgl.forEach(tgl => {
                const isZero = tgl.total_output === 0;
                bodyHtml += `
                <td class="val-total ${isZero ? 'bg-zero' : ''}">
                    ${isZero ? '-' : formatFloat(tgl.total_output)}
                </td>
                <td class="val-capaian ${isZero ? 'bg-zero' : ''}">
                    ${isZero ? '-' : formatFloat(tgl.persen_capaian) + '%'}
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

