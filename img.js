// Initialize Icons
lucide.createIcons();

// --- MODULE 1: DATA MODELS ---
class SpatialElement {
    constructor({ id, type = 'text', text = '', bbox = [0, 0, 0, 0], confidence = 1.0, order = 0, bboxSource = 'ocr-space', lines = [] }) {
        this.id = id;
        this.type = type;
        this.text = text.trim();
        this.bbox = bbox; // [x1, y1, x2, y2]
        this.confidence = confidence;
        this.position = '';
        this.normalized_bbox = [];
        this.order = order;
        this.relations = {};
        this.bboxSource = bboxSource; // 'ocr-space' | 'synthetic'
        this.lines = lines; // Detail line items untuk mempertahankan struktur internal
    }

    get width() { return Math.max(0, this.bbox[2] - this.bbox[0]); }
    get height() { return Math.max(0, this.bbox[3] - this.bbox[1]); }
    get cx() { return this.bbox[0] + this.width / 2; }
    get cy() { return this.bbox[1] + this.height / 2; }
}

// Helper: Convert Canvas/Img to JPEG Base64
function getPreprocessedJPEGBase64(imgElement, quality = 0.8) {
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth;
    canvas.height = imgElement.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0);
    return canvas.toDataURL('image/jpeg', quality);
}

// --- MODULE 2: OCR.SPACE ENGINE & PIPELINE ---

class OCRSpaceVisionEngine {
    constructor() {
        this.apiKey = 'K81551206988957';
        this.endpoint = 'https://api.ocr.space/parse/image';
        this.activeEngineUsed = '2';
    }

    async analyze(imageElement, onProgress) {
        const base64Data = getPreprocessedJPEGBase64(imageElement, 0.8);

        if (onProgress) onProgress({ percent: 20, status: 'OCR.Space Engine 2...' });
        let resultData = null;

        // PRIMARY: Engine 2 with 2000ms Timeout
        try {
            resultData = await this.callOCRSpace(base64Data, '2', 2000);
            this.activeEngineUsed = '2';
        } catch (err) {
            console.warn("Engine 2 failed or timed out. Falling back to Engine 1:", err.message);
            if (onProgress) onProgress({ percent: 50, status: 'Fallback → OCR.Space Engine 1...' });

            // FALLBACK: Engine 1 without strict timeout
            resultData = await this.callOCRSpace(base64Data, '1', 0);
            this.activeEngineUsed = '1';
        }

        if (onProgress) onProgress({ percent: 80, status: 'Processing Spatial Data...' });

        // Process Raw Response
        const parsedText = this.extractParsedText(resultData);
        const extractedWords = this.extractWordsWithBBox(resultData);

        // Run Pipeline dengan memelihara bukti spasial (Spatial Evidence)
        const normalizedWords = OCRNormalizer.filterAndNormalize(extractedWords, parsedText, imageElement.naturalWidth, imageElement.naturalHeight);
        const lines = TextLineGrouper.groupIntoLines(normalizedWords, imageElement.naturalWidth, imageElement.naturalHeight);
        const blocks = TextBlockGrouper.groupIntoBlocks(lines, imageElement.naturalWidth, imageElement.naturalHeight);

        return {
            elements: blocks,
            rawOCRText: parsedText,
            engineUsed: this.activeEngineUsed
        };
    }

    callOCRSpace(base64Image, engine, timeoutMs) {
        return new Promise((resolve, reject) => {
            let isTimedOut = false;
            let timer = null;

            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    isTimedOut = true;
                    reject(new Error(`Timeout after ${timeoutMs}ms`));
                }, timeoutMs);
            }

            const formData = new FormData();
            formData.append('base64Image', base64Image);
            formData.append('apikey', this.apiKey);
            formData.append('language', 'eng');
            formData.append('OCREngine', engine);
            formData.append('scale', 'false');
            formData.append('isOverlayRequired', 'true');

            fetch(this.endpoint, {
                method: 'POST',
                body: formData
            })
            .then(res => {
                if (timer) clearTimeout(timer);
                if (isTimedOut) return;
                if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (isTimedOut) return;
                if (!data) throw new Error("Response invalid");
                if (data.OCRExitCode !== 1) {
                    const errDetail = (data.ErrorMessage && data.ErrorMessage.join(', ')) || data.ErrorDetails || 'OCRExitCode is not 1';
                    throw new Error(`OCR Failed: ${errDetail}`);
                }
                if (!data.ParsedResults || data.ParsedResults.length === 0) {
                    throw new Error("ParsedResults empty");
                }
                resolve(data);
            })
            .catch(err => {
                if (timer) clearTimeout(timer);
                if (!isTimedOut) reject(err);
            });
        });
    }

    extractParsedText(data) {
        if (!data || !data.ParsedResults || !data.ParsedResults[0]) return '';
        return data.ParsedResults[0].ParsedText || '';
    }

    extractWordsWithBBox(data) {
        const words = [];
        if (!data || !data.ParsedResults || !data.ParsedResults[0]) return words;
        const overlay = data.ParsedResults[0].TextOverlay;
        if (!overlay || !overlay.Lines) return words;

        let globalWordIndex = 0;

        overlay.Lines.forEach((line, lineIdx) => {
            if (line.Words && line.Words.length > 0) {
                line.Words.forEach((w, wordIdx) => {
                    const txt = (w.WordText || '').trim();
                    if (txt) {
                        const l = Math.max(0, parseFloat(w.Left) || 0);
                        const t = Math.max(0, parseFloat(w.Top) || 0);
                        const wDist = Math.max(1, parseFloat(w.Width) || 1);
                        const hDist = Math.max(1, parseFloat(w.Height) || 1);
                        
                        words.push({
                            text: txt,
                            bbox: [l, t, l + wDist, t + hDist],
                            confidence: w.Confidence ? parseFloat(w.Confidence) : 1.0,
                            sourceOrder: globalWordIndex++,
                            lineSourceOrder: lineIdx,
                            wordSourceOrder: wordIdx,
                            bboxSource: 'ocr-space'
                        });
                    }
                });
            } else if (line.LineText) {
                const txt = line.LineText.trim();
                if (txt) {
                    const l = Math.max(0, parseFloat(line.Left || line.MinLeft || 0));
                    const t = Math.max(0, parseFloat(line.Top || line.MinTop || 0));
                    const wDist = Math.max(1, parseFloat(line.Width || 100));
                    const hDist = Math.max(1, parseFloat(line.Height || 20));
                    
                    // Apabila Words tidak terpisah, pecah menjadi kata sederhana sambil mempertahankan BBox baris
                    const subWords = txt.split(/\s+/).filter(Boolean);
                    const approxWordWidth = wDist / Math.max(1, subWords.length);

                    subWords.forEach((sw, wordIdx) => {
                        const wordLeft = l + (wordIdx * approxWordWidth);
                        words.push({
                            text: sw,
                            bbox: [wordLeft, t, wordLeft + approxWordWidth, t + hDist],
                            confidence: 1.0,
                            sourceOrder: globalWordIndex++,
                            lineSourceOrder: lineIdx,
                            wordSourceOrder: wordIdx,
                            bboxSource: 'ocr-space'
                        });
                    });
                }
            }
        });
        return words;
    }
}

// --- MODULE 3: OCR NORMALIZER ---
class OCRNormalizer {
    static filterAndNormalize(words, rawParsedText, imgWidth, imgHeight) {
        if (!words || words.length === 0) {
            if (rawParsedText && rawParsedText.trim()) {
                // Synthetic fallback if bbox words missing
                const rawLines = rawParsedText.split(/\r?\n/).filter(l => l.trim().length > 0);
                const syntheticWords = [];
                let globalIdx = 0;

                rawLines.forEach((lText, lineIdx) => {
                    const tokens = lText.trim().split(/\s+/).filter(Boolean);
                    const lineTop = 10 + (lineIdx * 30);
                    const lineBot = lineTop + 25;
                    
                    tokens.forEach((token, wordIdx) => {
                        const wordLeft = 10 + (wordIdx * 60);
                        syntheticWords.push({
                            text: token,
                            bbox: [wordLeft, lineTop, wordLeft + 50, lineBot],
                            confidence: 1.0,
                            sourceOrder: globalIdx++,
                            lineSourceOrder: lineIdx,
                            wordSourceOrder: wordIdx,
                            bboxSource: 'synthetic'
                        });
                    });
                });
                return syntheticWords;
            }
            return [];
        }

        const noiseSymbols = new Set(['®', '©', '™', '>>', '<<', '|', '~']);
        const filtered = [];

        words.forEach(w => {
            const txt = w.text.trim();
            if (w.confidence < 0.15) return;
            if (noiseSymbols.has(txt)) return;
            if (txt.length === 1 && !/[a-zA-Z0-9\+\-\•\.\,\$\%\#\&\*\(\)\/\\\_]/.test(txt)) return;

            // Validasi spasial BBox
            const x1 = Math.min(w.bbox[0], w.bbox[2]);
            const x2 = Math.max(w.bbox[0], w.bbox[2]);
            const y1 = Math.min(w.bbox[1], w.bbox[3]);
            const y2 = Math.max(w.bbox[1], w.bbox[3]);

            filtered.push({
                ...w,
                text: txt,
                bbox: [x1, y1, x2, y2]
            });
        });

        return filtered;
    }
}

// --- MODULE 4: TEXT LINE GROUPER ---
class TextLineGrouper {
    static groupIntoLines(words, imgWidth, imgHeight) {
        if (words.length === 0) return [];

        // Kelompokkan kata berdasarkan urutan baris sumber OCR terlebih dahulu untuk menjaga struktur asli
        const lineGroupsMap = new Map();
        
        words.forEach(word => {
            const lineKey = word.lineSourceOrder;
            if (!lineGroupsMap.has(lineKey)) {
                lineGroupsMap.set(lineKey, []);
            }
            lineGroupsMap.get(lineKey).push(word);
        });

        let rawLines = [];

        lineGroupsMap.forEach((lineWords) => {
            // Urutkan kata dalam satu line berdasarkan posisi X asli (atau wordSourceOrder)
            lineWords.sort((a, b) => a.wordSourceOrder - b.wordSourceOrder || a.bbox[0] - b.bbox[0]);
            
            const minX = Math.min(...lineWords.map(w => w.bbox[0]));
            const minY = Math.min(...lineWords.map(w => w.bbox[1]));
            const maxX = Math.max(...lineWords.map(w => w.bbox[2]));
            const maxY = Math.max(...lineWords.map(w => w.bbox[3]));
            
            rawLines.push({
                bbox: [minX, minY, maxX, maxY],
                words: lineWords,
                lineSourceOrder: lineWords[0].lineSourceOrder,
                bboxSource: lineWords[0].bboxSource
            });
        });

        // Rekonstruksi Baris Konservatif: Pecah atau Gabung Baris Secara Spasial dengan Ketat
        const finalizedLines = [];

        rawLines.forEach(line => {
            // Periksa jarak horizontal antar kata di dalam line asli.
            // Jika ada celah horizontal terlalu lebar, pecah menjadi baris terpisah agar tidak menggabung kolom berbeda.
            let currentSubLine = [line.words[0]];

            for (let i = 1; i < line.words.length; i++) {
                const prevWord = line.words[i - 1];
                const currWord = line.words[i];

                const prevHeight = prevWord.bbox[3] - prevWord.bbox[1];
                const currHeight = currWord.bbox[3] - currWord.bbox[1];
                const avgHeight = (prevHeight + currHeight) / 2;

                const horizGap = currWord.bbox[0] - prevWord.bbox[2];
                const vertOverlap = Math.min(prevWord.bbox[3], currWord.bbox[3]) - Math.max(prevWord.bbox[1], currWord.bbox[1]);

                // Batas pemisah kata yang sangat ketat (jika gap > 3x tinggi huruf atau vertical overlap buruk, pisahkan)
                if (horizGap > Math.max(30, avgHeight * 3.0) || vertOverlap < avgHeight * 0.2) {
                    finalizedLines.push(TextLineGrouper.buildLineObject(currentSubLine));
                    currentSubLine = [currWord];
                } else {
                    currentSubLine.push(currWord);
                }
            }

            if (currentSubLine.length > 0) {
                finalizedLines.push(TextLineGrouper.buildLineObject(currentSubLine));
            }
        });

        return finalizedLines;
    }

    static buildLineObject(words) {
        words.sort((a, b) => a.bbox[0] - b.bbox[0]);
        
        const minX = Math.min(...words.map(w => w.bbox[0]));
        const minY = Math.min(...words.map(w => w.bbox[1]));
        const maxX = Math.max(...words.map(w => w.bbox[2]));
        const maxY = Math.max(...words.map(w => w.bbox[3]));

        const fullText = words.map(w => w.text).join(' ');
        const avgConf = words.reduce((acc, w) => acc + w.confidence, 0) / words.length;

        return {
            text: fullText,
            bbox: [minX, minY, maxX, maxY],
            confidence: parseFloat(avgConf.toFixed(2)),
            words: words,
            bboxSource: words[0].bboxSource,
            lineSourceOrder: words[0].lineSourceOrder
        };
    }
}

// --- MODULE 5: TEXT BLOCK GROUPER ---
class TextBlockGrouper {
    static groupIntoBlocks(lines, imgWidth, imgHeight) {
        if (lines.length === 0) return [];

        // Jangan pernah melakukan sorting global Y berlebihan jika urutan sumber OCR sudah membawa hirarki terstruktur.
        // Pertahankan urutan baris OCR asli sebagai basis utama.
        const sortedLines = [...lines].sort((a, b) => {
            const lineDiff = a.lineSourceOrder - b.lineSourceOrder;
            if (lineDiff !== 0) return lineDiff;
            return a.bbox[1] - b.bbox[1];
        });

        const blocks = [];

        sortedLines.forEach(line => {
            let merged = false;
            const lH = line.bbox[3] - line.bbox[1];

            // PENGGABUNGAN KONSERVATIF:
            // Hanya gabungkan line ke dalam block jika:
            // 1. Berada tepat di bawah line sebelumnya (jarak vertikal sangat dekat).
            // 2. Memiliki kemiripan alignment horizontal yang jelas.
            for (let block of blocks) {
                const lastLine = block.lines[block.lines.length - 1];
                const lastH = lastLine.bbox[3] - lastLine.bbox[1];
                const avgH = (lH + lastH) / 2;

                const verticalGap = line.bbox[1] - lastLine.bbox[3];
                const horizontalOverlap = Math.min(block.bbox[2], line.bbox[2]) - Math.max(block.bbox[0], line.bbox[0]);
                const blockWidth = block.bbox[2] - block.bbox[0];
                const lineWidth = line.bbox[2] - line.bbox[0];

                // Batasan sangat ketat agar tidak menggabungkan judul/baris terpisah seperti "Card Reader" & "3 in 1 • USB 2.0"
                const isVeryCloseVertical = verticalGap >= -avgH * 0.2 && verticalGap < avgH * 0.45;
                const isHorizontallyAligned = horizontalOverlap > 0 && horizontalOverlap > Math.min(blockWidth, lineWidth) * 0.4;
                const isSameSourceLine = line.lineSourceOrder === lastLine.lineSourceOrder;

                if ((isVeryCloseVertical && isHorizontallyAligned) || isSameSourceLine) {
                    block.lines.push(line);
                    block.bbox[0] = Math.min(block.bbox[0], line.bbox[0]);
                    block.bbox[1] = Math.min(block.bbox[1], line.bbox[1]);
                    block.bbox[2] = Math.max(block.bbox[2], line.bbox[2]);
                    block.bbox[3] = Math.max(block.bbox[3], line.bbox[3]);
                    merged = true;
                    break;
                }
            }

            if (!merged) {
                blocks.push({
                    bbox: [...line.bbox],
                    lines: [line],
                    bboxSource: line.bboxSource
                });
            }
        });

        // Hasil akhir berupa SpatialElement
        let orderCounter = 1;
        return blocks.map(b => {
            const blockText = b.lines.map(l => l.text).join('\n');
            const avgConf = b.lines.reduce((acc, l) => acc + l.confidence, 0) / b.lines.length;

            return new SpatialElement({
                id: `elem_${orderCounter}`,
                type: 'text_block',
                text: blockText,
                bbox: b.bbox,
                confidence: parseFloat(avgConf.toFixed(2)),
                order: orderCounter++,
                bboxSource: b.bboxSource,
                lines: b.lines.map(l => ({
                    text: l.text,
                    bbox: l.bbox
                }))
            });
        });
    }
}

// --- MODULE 6: SPATIAL ANALYZER ---
class SpatialAnalyzer {
    static process(elements, imageWidth, imageHeight) {
        // Spatial Order: Pertahankan hirarki visual natural Y-primary (dengan margin) & X-secondary
        elements.sort((a, b) => {
            const dy = a.bbox[1] - b.bbox[1];
            if (Math.abs(dy) > 12) return dy;
            return a.bbox[0] - b.bbox[0];
        });

        elements.forEach((el, idx) => {
            el.order = idx + 1;

            // Normalized BBox [0.0 - 1.0]
            if (imageWidth > 0 && imageHeight > 0) {
                el.normalized_bbox = [
                    parseFloat((el.bbox[0] / imageWidth).toFixed(3)),
                    parseFloat((el.bbox[1] / imageHeight).toFixed(3)),
                    parseFloat((el.bbox[2] / imageWidth).toFixed(3)),
                    parseFloat((el.bbox[3] / imageHeight).toFixed(3))
                ];
            } else {
                el.normalized_bbox = [0, 0, 0, 0];
            }

            // Positional Grid Location
            el.position = SpatialAnalyzer.getSemanticPosition(el.cx, el.cy, imageWidth, imageHeight);
        });

        // Relative Relationships (Sangat Konservatif & Berarti)
        elements.forEach(el => {
            el.relations = SpatialAnalyzer.findRelationships(el, elements);
        });

        return elements;
    }

    static getSemanticPosition(cx, cy, width, height) {
        if (!width || !height) return 'center';
        const col = cx < width / 3 ? 'left' : cx < (2 * width) / 3 ? 'center' : 'right';
        const row = cy < height / 3 ? 'top' : cy < (2 * height) / 3 ? 'middle' : 'bottom';
        if (row === 'middle' && col === 'center') return 'center';
        return `${row}-${col}`;
    }

    static findRelationships(target, allElements) {
        const rels = {};

        allElements.forEach(other => {
            if (other.id === target.id) return;

            // Jangan hitung relasi jika salah satu menggunakan synthetic bbox
            if (target.bboxSource === 'synthetic' || other.bboxSource === 'synthetic') return;

            const targetH = target.height;
            const targetW = target.width;

            const dx = other.cx - target.cx;
            const dy = other.cy - target.cy;

            const vertOverlap = Math.min(target.bbox[3], other.bbox[3]) - Math.max(target.bbox[1], other.bbox[1]);
            const horizOverlap = Math.min(target.bbox[2], other.bbox[2]) - Math.max(target.bbox[0], other.bbox[0]);

            // KONSISTENSI VERTIKAL (Above / Below)
            if (horizOverlap > Math.min(targetW, other.width) * 0.3) {
                if (dy > 0 && dy < (targetH + other.height) * 1.5) {
                    if (!rels.below) rels.below = [];
                    rels.below.push(other.id);
                } else if (dy < 0 && Math.abs(dy) < (targetH + other.height) * 1.5) {
                    if (!rels.above) rels.above = [];
                    rels.above.push(other.id);
                }
            }

            // KONSISTENSI HORISONTAL (Left_of / Right_of)
            if (vertOverlap > Math.min(targetH, other.height) * 0.3) {
                if (dx > 0 && dx < (targetW + other.width) * 1.5) {
                    if (!rels.right_of) rels.right_of = [];
                    rels.right_of.push(other.id);
                } else if (dx < 0 && Math.abs(dx) < (targetW + other.width) * 1.5) {
                    if (!rels.left_of) rels.left_of = [];
                    rels.left_of.push(other.id);
                }
            }
        });

        return rels;
    }
}

// --- MODULE 7: OUTPUT GENERATOR ---
class OutputGenerator {
    static toJSON(imageMeta, elements, isCompact, thumbnailData, ocrMeta) {
        const schema = {
            schema_version: "2.0",
            image: {
                filename: imageMeta.filename,
                width: imageMeta.width,
                height: imageMeta.height,
                size: imageMeta.size
            },
            ocr: {
                provider: "OCR.Space",
                engine: ocrMeta ? ocrMeta.engine : "2",
                language: "eng"
            },
            ...(thumbnailData && { thumbnail: thumbnailData }),
            elements: elements.map(e => {
                if (isCompact) {
                    return {
                        id: e.id,
                        type: e.type,
                        text: e.text,
                        bbox: e.bbox,
                        pos: e.position,
                        order: e.order
                    };
                }
                return {
                    id: e.id,
                    type: e.type,
                    text: e.text,
                    confidence: e.confidence,
                    bbox: e.bbox,
                    normalized_bbox: e.normalized_bbox,
                    position: e.position,
                    order: e.order,
                    relations: e.relations,
                    ...(e.lines && e.lines.length > 1 && { lines: e.lines })
                };
            })
        };
        return JSON.stringify(schema, null, 2);
    }

    static toVisualMarkdown(imageMeta, elements, isCompact) {
        let md = `IMAGE ${imageMeta.width}x${imageMeta.height} (${imageMeta.filename})\n\n`;

        if (isCompact) {
            elements.forEach(e => {
                const cleanText = e.text.replace(/\n/g, ' ');
                md += `T${e.order} "${cleanText}" @${e.bbox[0]},${e.bbox[1]} ${e.width}x${e.height}\n`;
            });
        } else {
            elements.forEach(e => {
                const cleanText = e.text.replace(/\n/g, ' ');
                md += `[TEXT #${e.order}]\n`;
                md += `"${cleanText}"\n`;
                md += `bbox=(${e.bbox[0]},${e.bbox[1]})-(${e.bbox[2]},${e.bbox[3]})\n`;
                md += `position=${e.position}\n`;
                md += `order=${e.order}\n`;
                if (e.relations && Object.keys(e.relations).length > 0) {
                    md += `relations=${JSON.stringify(e.relations)}\n`;
                }
                md += `\n`;
            });
        }
        return md.trim();
    }
}

// --- MODULE 8: APPLICATION CONTROLLER ---
class App {
    constructor() {
        this.images = []; // [{file, imgElement, meta, elements: [], rawOCRText: '', ocrMeta: {}}]
        this.currentIndex = -1;
        this.selectedIndex = -1;
        this.engine = new OCRSpaceVisionEngine();
        this.outputFormat = 'markdown'; // 'markdown' | 'json'
        this.outputMode = 'normal'; // 'normal' | 'compact'

        this.initDOM();
        this.bindEvents();
    }

    initDOM() {
        this.dom = {
            fileInput: document.getElementById('fileInput'),
            dropZone: document.getElementById('dropZone'),
            imageListContainer: document.getElementById('imageListContainer'),
            imageList: document.getElementById('imageList'),
            btnAnalyze: document.getElementById('btnAnalyze'),
            btnAddElement: document.getElementById('btnAddElement'),
            btnClearAll: document.getElementById('btnClearAll'),
            sourceImage: document.getElementById('sourceImage'),
            overlayCanvas: document.getElementById('overlayCanvas'),
            canvasContainer: document.getElementById('canvasContainer'),
            imageMeta: document.getElementById('imageMeta'),
            analysisStatus: document.getElementById('analysisStatus'),
            outputDisplay: document.getElementById('outputDisplay'),
            btnTabMarkdown: document.getElementById('btnTabMarkdown'),
            btnTabJSON: document.getElementById('btnTabJSON'),
            btnModeNormal: document.getElementById('btnModeNormal'),
            btnModeCompact: document.getElementById('btnModeCompact'),
            chkShowBoxes: document.getElementById('chkShowBoxes'),
            chkIncludeThumbnail: document.getElementById('chkIncludeThumbnail'),
            btnCopy: document.getElementById('btnCopy'),
            btnDownload: document.getElementById('btnDownload'),
            // Progress DOMs
            progressContainer: document.getElementById('progressContainer'),
            progressBar: document.getElementById('progressBar'),
            progressPercent: document.getElementById('progressPercent'),
            progressStatus: document.getElementById('progressStatus'),
            // Inspector
            inspectorPanel: document.getElementById('inspectorPanel'),
            editType: document.getElementById('editType'),
            editText: document.getElementById('editText'),
            editX: document.getElementById('editX'),
            editY: document.getElementById('editY'),
            editW: document.getElementById('editW'),
            editH: document.getElementById('editH'),
            btnDeleteSelected: document.getElementById('btnDeleteSelected')
        };
        this.ctx = this.dom.overlayCanvas.getContext('2d');
    }

    bindEvents() {
        // File Handling
        this.dom.dropZone.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
        this.dom.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
        this.dom.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.handleFiles(e.dataTransfer.files);
        });

        // Analysis Execution
        this.dom.btnAnalyze.addEventListener('click', () => this.runAnalysis());

        // View & Output Toggles
        this.dom.chkShowBoxes.addEventListener('change', () => this.renderCanvas());
        this.dom.chkIncludeThumbnail.addEventListener('change', () => this.updateOutput());

        this.dom.btnTabMarkdown.addEventListener('click', () => {
            this.outputFormat = 'markdown';
            this.dom.btnTabMarkdown.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-600 text-white shadow-sm";
            this.dom.btnTabJSON.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-800";
            this.updateOutput();
        });

        this.dom.btnTabJSON.addEventListener('click', () => {
            this.outputFormat = 'json';
            this.dom.btnTabJSON.className = "px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-600 text-white shadow-sm";
            this.dom.btnTabMarkdown.className = "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-500 hover:text-slate-800";
            this.updateOutput();
        });

        this.dom.btnModeNormal.addEventListener('click', () => {
            this.outputMode = 'normal';
            this.dom.btnModeNormal.className = "px-2 py-0.5 rounded-md font-semibold bg-white text-blue-700 shadow-sm";
            this.dom.btnModeCompact.className = "px-2 py-0.5 rounded-md font-semibold text-slate-500 hover:text-slate-800";
            this.updateOutput();
        });

        this.dom.btnModeCompact.addEventListener('click', () => {
            this.outputMode = 'compact';
            this.dom.btnModeCompact.className = "px-2 py-0.5 rounded-md font-semibold bg-white text-blue-700 shadow-sm";
            this.dom.btnModeNormal.className = "px-2 py-0.5 rounded-md font-semibold text-slate-500 hover:text-slate-800";
            this.updateOutput();
        });

        // Copy & Download
        this.dom.btnCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(this.dom.outputDisplay.value);
            alert("Structured Data copied to clipboard!");
        });

        this.dom.btnDownload.addEventListener('click', () => {
            const ext = this.outputFormat === 'json' ? 'json' : 'md';
            const blob = new Blob([this.dom.outputDisplay.value], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `spatial-data.${ext}`;
            a.click();
        });

        // Interactive Bounding Box Click
        this.dom.overlayCanvas.addEventListener('mousedown', (e) => this.handleCanvasClick(e));

        // Inspector Sync
        const updateSelected = () => this.applyInspectorChanges();
        ['editType', 'editText', 'editX', 'editY', 'editW', 'editH'].forEach(id => {
            this.dom[id].addEventListener('input', updateSelected);
        });

        this.dom.btnDeleteSelected.addEventListener('click', () => this.deleteSelectedElement());
        this.dom.btnClearAll.addEventListener('click', () => {
            if (this.currentData) {
                this.currentData.elements = [];
                this.selectedIndex = -1;
                this.syncInspector();
                this.renderCanvas();
                this.updateOutput();
            }
        });

        this.dom.btnAddElement.addEventListener('click', () => {
            if (!this.currentData) return;
            const img = this.currentData.imgElement;
            const cx = Math.round(img.naturalWidth / 2);
            const cy = Math.round(img.naturalHeight / 2);

            const newEl = new SpatialElement({
                id: `elem_${Date.now().toString().slice(-4)}`,
                type: 'text_block',
                text: 'New Element',
                bbox: [cx - 60, cy - 20, cx + 60, cy + 20],
                bboxSource: 'synthetic'
            });

            this.currentData.elements.push(newEl);
            this.selectedIndex = this.currentData.elements.length - 1;
            SpatialAnalyzer.process(this.currentData.elements, img.naturalWidth, img.naturalHeight);
            this.syncInspector();
            this.renderCanvas();
            this.updateOutput();
        });
    }

    get currentData() {
        return this.images[this.currentIndex] || null;
    }

    handleFiles(files) {
        if (!files || files.length === 0) return;

        Array.from(files).forEach((file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    this.images.push({
                        file: file,
                        imgElement: img,
                        meta: {
                            filename: file.name,
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                            size: (file.size / (1024 * 1024)).toFixed(2) + ' MB'
                        },
                        elements: [],
                        rawOCRText: '',
                        ocrMeta: { provider: 'OCR.Space', engine: '2', language: 'eng' }
                    });

                    if (this.currentIndex === -1) {
                        this.selectImage(0);
                    }
                    this.renderImageList();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    renderImageList() {
        this.dom.imageListContainer.classList.remove('hidden');
        this.dom.imageList.innerHTML = '';
        this.images.forEach((item, index) => {
            const btn = document.createElement('button');
            btn.className = `text-left px-2.5 py-1.5 rounded-lg text-xs flex justify-between items-center ${index === this.currentIndex ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`;
            btn.innerHTML = `<span class="truncate w-36">${item.meta.filename}</span><span class="text-[10px] text-slate-400 font-normal">${item.meta.width}x${item.meta.height}</span>`;
            btn.onclick = () => this.selectImage(index);
            this.dom.imageList.appendChild(btn);
        });
    }

    selectImage(index) {
        this.currentIndex = index;
        this.selectedIndex = -1;
        const data = this.currentData;

        this.dom.sourceImage.src = data.imgElement.src;
        this.dom.imageMeta.textContent = `${data.meta.filename} (${data.meta.width}×${data.meta.height})`;
        this.dom.btnAnalyze.disabled = false;

        // Canvas coordinates synced strictly to original natural image size
        this.dom.overlayCanvas.width = data.meta.width;
        this.dom.overlayCanvas.height = data.meta.height;
        this.dom.sourceImage.style.width = `${data.meta.width}px`;
        this.dom.sourceImage.style.height = `${data.meta.height}px`;

        this.renderImageList();
        this.syncInspector();
        this.renderCanvas();
        this.updateOutput();
    }

    async runAnalysis() {
        if (!this.currentData) return;
        this.dom.analysisStatus.classList.remove('hidden');
        this.dom.progressContainer.classList.remove('hidden');
        this.dom.progressBar.style.width = '0%';
        this.dom.progressPercent.textContent = '0%';
        this.dom.btnAnalyze.disabled = true;

        try {
            const result = await this.engine.analyze(this.currentData.imgElement, (prog) => {
                this.dom.progressBar.style.width = `${prog.percent}%`;
                this.dom.progressPercent.textContent = `${prog.percent}%`;
                this.dom.progressStatus.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-blue-600"></i> ${prog.status}`;
                lucide.createIcons();
            });

            this.currentData.rawOCRText = result.rawOCRText;
            this.currentData.ocrMeta = {
                provider: 'OCR.Space',
                engine: result.engineUsed,
                language: 'eng'
            };

            const processedElements = SpatialAnalyzer.process(
                result.elements,
                this.currentData.meta.width,
                this.currentData.meta.height
            );

            this.currentData.elements = processedElements;

        } catch (e) {
            alert("Analysis error: " + e.message);
        } finally {
            this.dom.analysisStatus.classList.add('hidden');
            this.dom.progressContainer.classList.add('hidden');
            this.dom.btnAnalyze.disabled = false;
            this.renderCanvas();
            this.updateOutput();
        }
    }

    renderCanvas() {
        const data = this.currentData;
        if (!data) return;

        const ctx = this.ctx;
        ctx.clearRect(0, 0, data.meta.width, data.meta.height);

        // Background original image
        ctx.drawImage(data.imgElement, 0, 0);

        if (!this.dom.chkShowBoxes.checked) return;

        // Overlay bounding boxes
        data.elements.forEach((el, idx) => {
            const isSelected = idx === this.selectedIndex;

            ctx.strokeStyle = isSelected ? '#0284c7' : '#2563eb';
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.fillStyle = isSelected ? 'rgba(2, 132, 199, 0.25)' : 'rgba(37, 99, 235, 0.12)';

            ctx.fillRect(el.bbox[0], el.bbox[1], el.width, el.height);
            ctx.strokeRect(el.bbox[0], el.bbox[1], el.width, el.height);

            // Label tag
            ctx.fillStyle = isSelected ? '#0284c7' : '#2563eb';
            const displayLabel = el.text.replace(/\n/g, ' ');
            const tagText = `#${el.order} [${el.type}] ${displayLabel.length > 20 ? displayLabel.substring(0, 20) + '...' : displayLabel}`;
            ctx.font = '12px sans-serif';
            const textWidth = ctx.measureText(tagText).width;

            ctx.fillRect(el.bbox[0], Math.max(0, el.bbox[1] - 18), textWidth + 8, 18);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(tagText, el.bbox[0] + 4, Math.max(12, el.bbox[1] - 4));
        });
    }

    handleCanvasClick(e) {
        if (!this.currentData) return;
        const rect = this.dom.overlayCanvas.getBoundingClientRect();
        const scaleX = this.currentData.meta.width / rect.width;
        const scaleY = this.currentData.meta.height / rect.height;

        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        let foundIndex = -1;
        for (let i = this.currentData.elements.length - 1; i >= 0; i--) {
            const el = this.currentData.elements[i];
            if (clickX >= el.bbox[0] && clickX <= el.bbox[2] && clickY >= el.bbox[1] && clickY <= el.bbox[3]) {
                foundIndex = i;
                break;
            }
        }

        this.selectedIndex = foundIndex;
        this.syncInspector();
        this.renderCanvas();
    }

    syncInspector() {
        if (this.selectedIndex >= 0 && this.currentData) {
            const el = this.currentData.elements[this.selectedIndex];
            this.dom.inspectorPanel.classList.remove('hidden');
            this.dom.editType.value = el.type;
            this.dom.editText.value = el.text;
            this.dom.editX.value = el.bbox[0];
            this.dom.editY.value = el.bbox[1];
            this.dom.editW.value = el.width;
            this.dom.editH.value = el.height;
        } else {
            this.dom.inspectorPanel.classList.add('hidden');
        }
    }

    applyInspectorChanges() {
        if (this.selectedIndex < 0 || !this.currentData) return;
        const el = this.currentData.elements[this.selectedIndex];

        el.type = this.dom.editType.value;
        el.text = this.dom.editText.value;
        const x = parseInt(this.dom.editX.value) || 0;
        const y = parseInt(this.dom.editY.value) || 0;
        const w = parseInt(this.dom.editW.value) || 0;
        const h = parseInt(this.dom.editH.value) || 0;

        el.bbox = [x, y, x + w, y + h];

        SpatialAnalyzer.process(this.currentData.elements, this.currentData.meta.width, this.currentData.meta.height);
        this.renderCanvas();
        this.updateOutput();
    }

    deleteSelectedElement() {
        if (this.selectedIndex >= 0 && this.currentData) {
            this.currentData.elements.splice(this.selectedIndex, 1);
            this.selectedIndex = -1;
            this.syncInspector();
            this.renderCanvas();
            this.updateOutput();
        }
    }

    getThumbnailData() {
        if (!this.dom.chkIncludeThumbnail.checked || !this.currentData) return null;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = Math.round(256 * (this.currentData.meta.height / this.currentData.meta.width));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.currentData.imgElement, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.5);
    }

    updateOutput() {
        if (!this.currentData) {
            this.dom.outputDisplay.value = '';
            return;
        }

        const isCompact = this.outputMode === 'compact';
        const thumbnail = this.getThumbnailData();

        if (this.outputFormat === 'json') {
            this.dom.outputDisplay.value = OutputGenerator.toJSON(
                this.currentData.meta,
                this.currentData.elements,
                isCompact,
                thumbnail,
                this.currentData.ocrMeta
            );
        } else {
            this.dom.outputDisplay.value = OutputGenerator.toVisualMarkdown(
                this.currentData.meta,
                this.currentData.elements,
                isCompact
            );
        }
    }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
