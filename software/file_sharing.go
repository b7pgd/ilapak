package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const (
	Host        = "0.0.0.0"
	Port        = "2015"
	RootDirName = "shared_files"
)

var absRootDir string

func main() {
	var err error
	absRootDir, err = filepath.Abs(RootDirName)
	if err != nil {
		fmt.Printf("Error resolving root path: %v\n", err)
		return
	}

	if err := os.MkdirAll(absRootDir, 0755); err != nil {
		fmt.Printf("Error creating shared folder: %v\n", err)
		return
	}

	addr := Host + ":" + Port

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleIndex)
	mux.HandleFunc("/api/files", handleListFiles)
	mux.HandleFunc("/api/download", handleDownload)
	mux.HandleFunc("/api/upload", handleUpload)
	mux.HandleFunc("/api/read", handleReadFile)
	mux.HandleFunc("/api/save", handleSaveFile)

	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	// Menjalankan server di goroutine
	go func() {
		fmt.Printf("Starting Simple File Bridge on %s...\n", addr)
		printLocalIPs()
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("[ERROR] Server listen error: %v\n", err)
		}
	}()

	// Menangkap SIGHUP, SIGINT, SIGTERM untuk Graceful Shutdown (Cocok untuk NSSM / Windows Service)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	fmt.Println("\nShutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		fmt.Printf("Server forced shutdown: %v\n", err)
	} else {
		fmt.Println("Server stopped gracefully.")
	}
}

func printLocalIPs() {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		fmt.Println("Cannot get network interfaces:", err)
		return
	}

	fmt.Println("Access URLs:")
	found := false

	for _, addr := range addrs {
		ipNet, ok := addr.(*net.IPNet)
		if !ok || ipNet.IP.IsLoopback() || ipNet.IP.To4() == nil {
			continue
		}
		fmt.Printf(" -> http://%s:%s\n", ipNet.IP.String(), Port)
		found = true
	}

	fmt.Printf(" -> http://127.0.0.1:%s\n", Port)

	if !found {
		fmt.Println(" [WARNING] No LAN IPv4 address detected.")
	}
}

func safePath(subPath string) (string, error) {
	subPath = strings.ReplaceAll(subPath, "/", string(filepath.Separator))
	subPath = strings.ReplaceAll(subPath, "\\", string(filepath.Separator))

	cleanSub := filepath.Clean(subPath)

	if cleanSub == "." {
		cleanSub = ""
	}

	if filepath.IsAbs(cleanSub) {
		return "", fmt.Errorf("absolute path denied")
	}

	targetPath := filepath.Join(absRootDir, cleanSub)

	rel, err := filepath.Rel(absRootDir, targetPath)
	if err != nil {
		return "", fmt.Errorf("cannot resolve path")
	}

	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path traversal attempt denied")
	}

	return targetPath, nil
}

// getUniquePath memeriksa apakah file/folder sudah ada.
// Jika sudah ada, menambahkan suffix (1), (2), dst. agar file asli tidak ter-rewrite.
func getUniquePath(targetPath string) string {
	if _, err := os.Stat(targetPath); os.IsNotExist(err) {
		return targetPath
	}

	dir := filepath.Dir(targetPath)
	ext := filepath.Ext(targetPath)
	base := strings.TrimSuffix(filepath.Base(targetPath), ext)

	counter := 1
	for {
		newName := fmt.Sprintf("%s (%d)%s", base, counter, ext)
		newPath := filepath.Join(dir, newName)
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			return newPath
		}
		counter++
	}
}

type FileItem struct {
	Name    string    `json:"name"`
	IsDir   bool      `json:"is_dir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
}

func handleListFiles(w http.ResponseWriter, r *http.Request) {
	sub := r.URL.Query().Get("path")
	targetPath, err := safePath(sub)
	if err != nil {
		http.Error(w, "Access Denied", http.StatusForbidden)
		return
	}

	entries, err := os.ReadDir(targetPath)
	if err != nil {
		http.Error(w, "Directory not found", http.StatusNotFound)
		return
	}

	var list []FileItem
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		list = append(list, FileItem{
			Name:    entry.Name(),
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func handleDownload(w http.ResponseWriter, r *http.Request) {
	sub := r.URL.Query().Get("path")
	targetPath, err := safePath(sub)
	if err != nil {
		http.Error(w, "Access Denied", http.StatusForbidden)
		return
	}

	info, err := os.Stat(targetPath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	if info.IsDir() {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.zip\"", filepath.Base(targetPath)))

		zw := zip.NewWriter(w)
		defer zw.Close()

		err := filepath.Walk(targetPath, func(path string, walkInfo os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			relPath, err := filepath.Rel(targetPath, path)
			if err != nil {
				return err
			}
			if relPath == "." {
				return nil
			}

			if walkInfo.IsDir() {
				_, err = zw.Create(filepath.ToSlash(relPath) + "/")
				return err
			}

			zipFile, err := zw.Create(filepath.ToSlash(relPath))
			if err != nil {
				return err
			}

			fsFile, err := os.Open(path)
			if err != nil {
				return err
			}
			defer fsFile.Close()

			_, err = io.Copy(zipFile, fsFile)
			return err
		})

		if err != nil {
			http.Error(w, "Error creating zip", http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(targetPath)))
	http.ServeFile(w, r, targetPath)
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sub := r.URL.Query().Get("path")
	targetDir, err := safePath(sub)
	if err != nil {
		http.Error(w, "Access Denied", http.StatusForbidden)
		return
	}

	err = r.ParseMultipartForm(1000 << 20) // Limit 1GB
	if err != nil {
		http.Error(w, "File upload error", http.StatusBadRequest)
		return
	}

	files := r.MultipartForm.File["files"]
	relPaths := r.MultipartForm.Value["paths"]

	for i, fileHeader := range files {
		src, err := fileHeader.Open()
		if err != nil {
			continue
		}

		var relPath string
		if i < len(relPaths) && relPaths[i] != "" {
			relPath = relPaths[i]
		} else {
			relPath = fileHeader.Filename
		}

		// Sanitasi path upload
		relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
		relPath = strings.ReplaceAll(relPath, "\\", string(filepath.Separator))
		relPath = filepath.Clean(relPath)

		if filepath.IsAbs(relPath) || relPath == ".." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) {
			src.Close()
			continue
		}

		dstPath := filepath.Join(targetDir, relPath)

		// Verifikasi target path tidak keluar dari root dir
		relCheck, err := filepath.Rel(absRootDir, dstPath)
		if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
			src.Close()
			continue
		}

		if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
			src.Close()
			continue
		}

		// CEK UNTUK MENCEGAH REWRITE (AMBIL UNIQUE PATH JIKA SUDAH ADA)
		dstPath = getUniquePath(dstPath)

		dst, err := os.Create(dstPath)
		if err != nil {
			src.Close()
			continue
		}

		io.Copy(dst, src)
		src.Close()
		dst.Close()
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Upload success"))
}

// Endpoint baru untuk membaca isi file teks di server
func handleReadFile(w http.ResponseWriter, r *http.Request) {
	sub := r.URL.Query().Get("path")
	targetPath, err := safePath(sub)
	if err != nil {
		http.Error(w, "Access Denied", http.StatusForbidden)
		return
	}

	info, err := os.Stat(targetPath)
	if err != nil || info.IsDir() {
		http.Error(w, "File not found or is directory", http.StatusBadRequest)
		return
	}

	// Batasi pembacaan preview maks 5MB
	if info.Size() > 5<<20 {
		http.Error(w, "File is too large to preview", http.StatusBadRequest)
		return
	}

	content, err := os.ReadFile(targetPath)
	if err != nil {
		http.Error(w, "Error reading file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(content)
}

// Endpoint baru untuk menulis ulang (overwrite) file teks di server
func handleSaveFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sub := r.URL.Query().Get("path")
	targetPath, err := safePath(sub)
	if err != nil {
		http.Error(w, "Access Denied", http.StatusForbidden)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	err = os.WriteFile(targetPath, body, 0644)
	if err != nil {
		http.Error(w, "Failed to write file", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Saved successfully"))
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(htmlUI))
}

const htmlUI = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Simple File Bridge</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: #f4f6f9; color: #333; padding: 15px; }
        h2 { text-align: center; margin-bottom: 15px; color: #1a252f; font-size: 1.4rem; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; max-width: 1200px; margin: 0 auto; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
        .card { background: #fff; border-radius: 8px; padding: 15px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); display: flex; flex-direction: column; height: 75vh; }
        .card-header { font-weight: bold; font-size: 1.1rem; padding-bottom: 10px; border-bottom: 2px solid #eee; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        .path-bar { font-size: 0.85rem; color: #666; background: #eef2f5; padding: 6px 10px; border-radius: 4px; margin-bottom: 10px; word-break: break-all; }
        .file-list { flex: 1; overflow-y: auto; border: 1px solid #e1e4e8; border-radius: 4px; }
        .item { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid #f0f0f0; cursor: pointer; user-select: none; }
        .item:hover { background: #f8f9fa; }
        .item.selected { background: #e3f2fd; }
        .item-icon { margin-right: 10px; font-weight: bold; width: 20px; text-align: center; }
        .item-info { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
        .item-name { font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .item-meta { font-size: 0.75rem; color: #888; margin-top: 2px; }
        .actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
        button, label.btn { background: #007bff; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-weight: 500; text-align: center; display: inline-block; }
        button:hover, label.btn:hover { background: #0056b3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        input[type="file"] { display: none; }
        input[type="checkbox"] { margin-right: 10px; cursor: pointer; }

        /* MODAL STYLES */
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; z-index: 1000; }
        .modal-overlay.active { display: flex; }
        .modal { background: #fff; border-radius: 8px; width: 90%; max-width: 700px; height: 80vh; display: flex; flex-direction: column; padding: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .modal-header { font-weight: bold; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        .modal-body { flex: 1; display: flex; flex-direction: column; margin-bottom: 10px; }
        .modal-body textarea { flex: 1; width: 100%; border: 1px solid #ccc; border-radius: 4px; padding: 10px; font-family: monospace; font-size: 0.9rem; resize: none; outline: none; }
        .modal-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px solid #ddd; padding-top: 10px; }
        .btn-close { background: #6c757d; }
        .btn-close:hover { background: #5a6268; }
        .btn-save { background: #28a745; }
        .btn-save:hover { background: #218838; }
        .btn-warning { background: #ffc107; color: #212529; }
        .btn-warning:hover { background: #e0a800; }
        .btn-info { background: #17a2b8; }
        .btn-info:hover { background: #138496; }
    </style>
</head>
<body>

    <h2>SIMPLE FILE BRIDGE</h2>

    <div class="grid">
        <div class="card">
            <div class="card-header">
                <span>PC SERVER</span>
                <button onclick="loadServerFiles('')" style="padding: 4px 8px; font-size: 0.75rem;">Refresh</button>
            </div>
            <div class="path-bar" id="serverPathDisplay">/</div>
            <div class="file-list" id="serverFileList"></div>
            <div class="actions">
                <button id="btnCopyUser" onclick="copyServerToUser()" disabled>COPY &rarr; (To User)</button>
                <button id="btnPreviewServer" onclick="openServerPreview()" disabled style="background: #6f42c1; display: none;">👁 Preview / Edit</button>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <span>PC USER</span>
            </div>
            <div class="path-bar" id="userPathDisplay">Select files or folder to prepare copy</div>
            <div class="file-list" id="userFileList">
                <div style="padding: 15px; text-align: center; color: #888; font-size: 0.85rem;">
                    Click <b>Browse File/Folder</b> below to select files from PC User.
                </div>
            </div>
            <div class="actions">
                <label class="btn">
                    Browse Files
                    <input type="file" id="userInputFile" multiple onchange="handleUserFilesSelect(this.files)">
                </label>
                <label class="btn" style="background: #28a745;">
                    Browse Folder
                    <input type="file" id="userInputFolder" webkitdirectory directory onchange="handleUserFilesSelect(this.files)">
                </label>
                <button id="btnCopyServer" onclick="copyUserToServer()" disabled style="background: #17a2b8;">&larr; COPY (To Server)</button>
                <button id="btnPreviewUser" onclick="openUserPreview()" disabled style="background: #6f42c1; display: none;">👁 Preview / Edit</button>
            </div>
        </div>
    </div>

    <!-- MODAL POPUP PREVIEW -->
    <div class="modal-overlay" id="previewModal">
        <div class="modal">
            <div class="modal-header">
                <span id="modalTitle">Preview File</span>
                <button class="btn-close" onclick="closeModal()" style="padding: 2px 8px;">✕</button>
            </div>
            <div class="modal-body">
                <textarea id="modalTextarea" placeholder="Write or view content here..."></textarea>
            </div>
            <div class="modal-footer">
                <div>
                    <button onclick="copyModalText()" class="btn-info">Copy</button>
                    <button onclick="pasteModalText()" class="btn-warning">Paste</button>
                    <button onclick="clearModalText()" style="background: #dc3545;">Clear</button>
                </div>
                <div>
                    <button id="btnSaveModal" onclick="saveModalContent()" class="btn-save">Save / Send to Server</button>
                    <button onclick="closeModal()" class="btn-close">Close</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentServerPath = "";
        let selectedServerItems = new Set();
        let serverFilesData = [];
        let selectedUserFiles = [];
        let currentModalMode = ""; // 'server' or 'user'
        let activeServerFileName = "";
        let activeUserFileIndex = -1;

        // Ekstensi file yang didukung untuk Preview / Edit
        const viewableExts = ['.txt', '.json', '.xml', '.csv', '.log', '.md', '.html', '.css', '.js', '.go', '.py', '.sh', '.bat', '.ini', '.yaml', '.yml'];

        function isViewable(filename) {
            const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
            return viewableExts.includes(ext);
        }

        // --- SERVER SIDE LOGIC ---
        async function loadServerFiles(subPath) {
            currentServerPath = subPath;
            document.getElementById('serverPathDisplay').innerText = "/" + subPath;
            selectedServerItems.clear();
            serverFilesData = [];
            updateCopyUserButton();

            try {
                const res = await fetch('/api/files?path=' + encodeURIComponent(subPath));
                if (!res.ok) throw new Error();
                const files = await res.json();
                serverFilesData = files || [];

                const listEl = document.getElementById('serverFileList');
                listEl.innerHTML = "";

                if (subPath !== "") {
                    const upDiv = document.createElement('div');
                    upDiv.className = 'item';
                    upDiv.innerHTML = '<span class="item-icon">📁</span><div class="item-info"><span class="item-name">.. (Go Up)</span></div>';
                    upDiv.onclick = () => {
                        const parts = subPath.split('/').filter(Boolean);
                        parts.pop();
                        loadServerFiles(parts.join('/'));
                    };
                    listEl.appendChild(upDiv);
                }

                if (!files || files.length === 0) {
                    listEl.innerHTML += '<div style="padding:15px; color:#888; text-align:center;">Folder is empty</div>';
                    return;
                }

                files.sort((a, b) => b.is_dir - a.is_dir);

                files.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'item';
                    const icon = item.is_dir ? '📁' : '📄';
                    const sizeStr = item.is_dir ? '' : formatBytes(item.size);
                    const dateStr = formatDate(item.mod_time);
                    const metaText = item.is_dir ? dateStr : sizeStr + ' • ' + dateStr;

                    const checkboxHtml = '<input type="checkbox" class="server-cb" data-name="' + escapeHtml(item.name) + '">';

                    div.innerHTML = checkboxHtml +
                        '<span class="item-icon">' + icon + '</span>' +
                        '<div class="item-info">' +
                            '<span class="item-name">' + escapeHtml(item.name) + '</span>' +
                            '<span class="item-meta">' + metaText + '</span>' +
                        '</div>';

                    div.onclick = (e) => {
                        if (e.target.tagName === 'INPUT') {
                            toggleServerSelection(item.name, div);
                            return;
                        }

                        if (item.is_dir) {
                            const nextPath = currentServerPath ? currentServerPath + '/' + item.name : item.name;
                            loadServerFiles(nextPath);
                        } else {
                            const cb = div.querySelector('input[type="checkbox"]');
                            cb.checked = !cb.checked;
                            toggleServerSelection(item.name, div);
                        }
                    };

                    listEl.appendChild(div);
                });
            } catch (e) {
                document.getElementById('serverFileList').innerHTML = '<div style="padding:15px; color:red;">Failed to load server files</div>';
            }
        }

        function toggleServerSelection(name, itemEl) {
            const cb = itemEl.querySelector('input[type="checkbox"]');
            if (selectedServerItems.has(name)) {
                selectedServerItems.delete(name);
                itemEl.classList.remove('selected');
                if (cb) cb.checked = false;
            } else {
                selectedServerItems.add(name);
                itemEl.classList.add('selected');
                if (cb) cb.checked = true;
            }
            updateCopyUserButton();
        }

        function updateCopyUserButton() {
            const btnCopy = document.getElementById('btnCopyUser');
            const btnPrev = document.getElementById('btnPreviewServer');

            btnCopy.disabled = selectedServerItems.size === 0;
            btnCopy.innerText = "COPY → (To User " +
                (selectedServerItems.size ? "(" + selectedServerItems.size + ")" : "") +
                ")";

            // Tampilkan tombol preview hanya jika tepat 1 file teks dicentang
            if (selectedServerItems.size === 1) {
                const selectedName = Array.from(selectedServerItems)[0];
                const item = serverFilesData.find(f => f.name === selectedName);
                if (item && !item.is_dir && isViewable(item.name)) {
                    btnPrev.style.display = "inline-block";
                    btnPrev.disabled = false;
                    activeServerFileName = selectedName;
                    return;
                }
            }
            btnPrev.style.display = "none";
            btnPrev.disabled = true;
        }

        function copyServerToUser() {
            if (selectedServerItems.size === 0) return;
            selectedServerItems.forEach(name => {
                const filePath = currentServerPath ? currentServerPath + '/' + name : name;
                const a = document.createElement('a');
                a.href = '/api/download?path=' + encodeURIComponent(filePath);
                a.download = name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
        }

        // --- USER SIDE LOGIC ---
        function handleUserFilesSelect(files) {
            selectedUserFiles = Array.from(files);
            const listEl = document.getElementById('userFileList');
            listEl.innerHTML = "";
            activeUserFileIndex = -1;

            if (selectedUserFiles.length === 0) {
                document.getElementById('userPathDisplay').innerText = "Select files or folder to prepare copy";
                document.getElementById('btnCopyServer').disabled = true;
                updateUserPreviewButton();
                return;
            }

            document.getElementById('userPathDisplay').innerText = selectedUserFiles.length + " file(s) selected";
            document.getElementById('btnCopyServer').disabled = false;

            selectedUserFiles.forEach((file, index) => {
                const div = document.createElement('div');
                div.className = 'item';
                const relPath = file.webkitRelativePath || file.name;
                const sizeStr = formatBytes(file.size);
                const dateStr = formatDate(file.lastModified);

                div.innerHTML =
                    '<span class="item-icon">📄</span>' +
                    '<div class="item-info">' +
                        '<span class="item-name">' + escapeHtml(relPath) + '</span>' +
                        '<span class="item-meta">' + sizeStr + ' • ' + dateStr + '</span>' +
                    '</div>';

                div.onclick = () => {
                    document.querySelectorAll('#userFileList .item').forEach(el => el.classList.remove('selected'));
                    div.classList.add('selected');
                    activeUserFileIndex = index;
                    updateUserPreviewButton();
                };

                listEl.appendChild(div);
            });

            // Auto-select first item
            if (selectedUserFiles.length > 0) {
                const firstItem = listEl.querySelector('.item');
                if (firstItem) {
                    firstItem.classList.add('selected');
                    activeUserFileIndex = 0;
                }
            }
            updateUserPreviewButton();
        }

        function updateUserPreviewButton() {
            const btnPrev = document.getElementById('btnPreviewUser');
            if (activeUserFileIndex >= 0 && activeUserFileIndex < selectedUserFiles.length) {
                const file = selectedUserFiles[activeUserFileIndex];
                if (isViewable(file.name)) {
                    btnPrev.style.display = "inline-block";
                    btnPrev.disabled = false;
                    return;
                }
            }
            btnPrev.style.display = "none";
            btnPrev.disabled = true;
        }

        async function copyUserToServer() {
            if (selectedUserFiles.length === 0) return;

            const formData = new FormData();
            selectedUserFiles.forEach(file => {
                formData.append('files', file);
                formData.append('paths', file.webkitRelativePath || file.name);
            });

            const btn = document.getElementById('btnCopyServer');
            btn.disabled = true;
            btn.innerText = "Copying...";

            try {
                const res = await fetch('/api/upload?path=' + encodeURIComponent(currentServerPath), {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    alert('Copy successfully completed!');
                    selectedUserFiles = [];
                    handleUserFilesSelect([]);
                    loadServerFiles(currentServerPath);
                } else {
                    alert('Failed to copy files to server.');
                }
            } catch (e) {
                alert('Network error during copy operation.');
            } finally {
                btn.disabled = false;
                btn.innerText = "← COPY (To Server)";
            }
        }

        // --- PREVIEW & MODAL LOGIC ---
        async function openServerPreview() {
            if (!activeServerFileName) return;
            const filePath = currentServerPath ? currentServerPath + '/' + activeServerFileName : activeServerFileName;

            try {
                const res = await fetch('/api/read?path=' + encodeURIComponent(filePath));
                if (!res.ok) throw new Error('Failed to read file');
                const text = await res.text();

                currentModalMode = "server";
                document.getElementById('modalTitle').innerText = "Preview & Live Edit (Server): " + activeServerFileName;
                document.getElementById('modalTextarea').value = text;
                document.getElementById('btnSaveModal').style.display = "inline-block";
                document.getElementById('btnSaveModal').innerText = "Save / Rewrite to Server";
                document.getElementById('previewModal').classList.add('active');
            } catch (e) {
                alert('Cannot preview this file.');
            }
        }

        function openUserPreview() {
            if (activeUserFileIndex < 0 || activeUserFileIndex >= selectedUserFiles.length) return;
            const file = selectedUserFiles[activeUserFileIndex];

            const reader = new FileReader();
            reader.onload = function(e) {
                currentModalMode = "user";
                document.getElementById('modalTitle').innerText = "Preview & Edit (User Local): " + file.name;
                document.getElementById('modalTextarea').value = e.target.result;
                document.getElementById('btnSaveModal').style.display = "inline-block";
                document.getElementById('btnSaveModal').innerText = "Apply Local Changes";
                document.getElementById('previewModal').classList.add('active');
            };
            reader.readAsText(file);
        }

        async function saveModalContent() {
            const content = document.getElementById('modalTextarea').value;

            if (currentModalMode === "server") {
                const filePath = currentServerPath ? currentServerPath + '/' + activeServerFileName : activeServerFileName;
                try {
                    const res = await fetch('/api/save?path=' + encodeURIComponent(filePath), {
                        method: 'POST',
                        body: content
                    });
                    if (res.ok) {
                        alert('File updated on server successfully!');
                        closeModal();
                        loadServerFiles(currentServerPath);
                    } else {
                        alert('Failed to save file to server.');
                    }
                } catch (e) {
                    alert('Error saving file.');
                }
            } else if (currentModalMode === "user") {
                // Update file di memori JS lokal
                const oldFile = selectedUserFiles[activeUserFileIndex];
                const updatedFile = new File([content], oldFile.name, { type: oldFile.type, lastModified: Date.now() });
                selectedUserFiles[activeUserFileIndex] = updatedFile;
                alert('Local changes applied. Click "COPY (To Server)" to upload!');
                closeModal();
            }
        }

        function copyModalText() {
            const textToCopy = document.getElementById('modalTextarea').value;

            // Memakai execCommand dengan hidden textarea untuk kompabilitas HP dan Non-HTTPS (LAN IP)
            const tempInput = document.createElement("textarea");
            tempInput.value = textToCopy;
            tempInput.style.position = "fixed";
            tempInput.style.left = "-9999px";
            tempInput.style.top = "-9999px";
            document.body.appendChild(tempInput);
            tempInput.focus();
            tempInput.select();

            let success = false;
            try {
                success = document.execCommand('copy');
            } catch (err) {
                success = false;
            }
            document.body.removeChild(tempInput);

            if (success) {
                alert('Content copied to clipboard!');
            } else if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy).then(() => {
                    alert('Content copied to clipboard!');
                }).catch(() => {
                    alert('Failed to copy text. Please select and copy manually.');
                });
            } else {
                alert('Failed to copy text. Please select and copy manually.');
            }
        }

        async function pasteModalText() {
            try {
                const text = await navigator.clipboard.readText();
                const textarea = document.getElementById('modalTextarea');
                textarea.value += text;
            } catch (err) {
                alert('Clipboard access denied or unsupported.');
            }
        }

        function clearModalText() {
            document.getElementById('modalTextarea').value = "";
        }

        function closeModal() {
            document.getElementById('previewModal').classList.remove('active');
        }

        // --- UTILS ---
        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }

        function formatDate(dateInput) {
            if (!dateInput) return '';
            const d = new Date(dateInput);
            if (isNaN(d.getTime())) return '';
            const pad = (n) => n.toString().padStart(2, '0');
            const day = pad(d.getDate());
            const month = pad(d.getMonth() + 1);
            const year = d.getFullYear();
            const hours = pad(d.getHours());
            const minutes = pad(d.getMinutes());
            return day + "/" + month + "/" + year + " " + hours + ":" + minutes;
        }

        function escapeHtml(text) {
            return text.replace(/[&<>"']/g, function(m) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]; });
        }

        // Init
        loadServerFiles("");
    </script>
</body>
</html>`
