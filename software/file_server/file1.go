package main

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	Host        = "0.0.0.0"
	Port        = "2015"
	RootDirName = "shared_files"
)

var (
	server      *http.Server
	serverMutex sync.Mutex
	isRunning   bool
	absRootDir  string
)

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

	reader := bufio.NewReader(os.Stdin)

	for {
		fmt.Println("\n========================================")
		fmt.Println("         SIMPLE FILE BRIDGE            ")
		fmt.Println("========================================")
		fmt.Println(" Root Dir :", absRootDir)
		fmt.Println(" Status   :", getStatusText())
		fmt.Println("----------------------------------------")
		fmt.Println(" [R] Run")
		fmt.Println(" [S] Stop")
		fmt.Println(" [Q] Quit")
		fmt.Print("\nCommand: ")

		input, _ := reader.ReadString('\n')
		cmd := strings.ToUpper(strings.TrimSpace(input))

		switch cmd {
		case "R":
			startServer()
		case "S":
			stopServer()
		case "Q":
			stopServer()
			fmt.Println("Exiting application...")
			return
		default:
			fmt.Println("Invalid command!")
		}
	}
}

func getStatusText() string {
	serverMutex.Lock()
	defer serverMutex.Unlock()
	if isRunning {
		return "RUNNING"
	}
	return "STOPPED"
}

func startServer() {
	serverMutex.Lock()
	defer serverMutex.Unlock()

	if isRunning {
		fmt.Println("\n[INFO] Server is already running!")
		return
	}

	addr := Host + ":" + Port

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleIndex)
	mux.HandleFunc("/api/files", handleListFiles)
	mux.HandleFunc("/api/download", handleDownload)
	mux.HandleFunc("/api/upload", handleUpload)

	server = &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Printf("\n[ERROR] Failed to bind %s: %v\n", addr, err)
		return
	}

	isRunning = true
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Printf("\n[ERROR] Server stopped with error: %v\n", err)
			serverMutex.Lock()
			isRunning = false
			serverMutex.Unlock()
		}
	}()

	fmt.Printf("\n[RUNNING]\nServer listening on %s\n\n", addr)
	printLocalIPs()
}

func stopServer() {
	serverMutex.Lock()
	defer serverMutex.Unlock()

	if !isRunning || server == nil {
		fmt.Println("\n[INFO] Server is not running.")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		fmt.Printf("\n[ERROR] Server forced shutdown: %v\n", err)
	} else {
		fmt.Println("\n[STOPPED] Server stopped safely.")
	}
	isRunning = false
	server = nil
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
        .actions { margin-top: 10px; display: flex; gap: 10px; }
        button, label.btn { background: #007bff; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-size: 0.9rem; font-weight: 500; text-align: center; display: inline-block; }
        button:hover, label.btn:hover { background: #0056b3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        input[type="file"] { display: none; }
        input[type="checkbox"] { margin-right: 10px; cursor: pointer; }
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
            </div>
        </div>
    </div>

    <script>
        let currentServerPath = "";
        let selectedServerItems = new Set();
        let selectedUserFiles = [];

        // --- SERVER SIDE LOGIC ---
        async function loadServerFiles(subPath) {
            currentServerPath = subPath;
            document.getElementById('serverPathDisplay').innerText = "/" + subPath;
            selectedServerItems.clear();
            updateCopyUserButton();

            try {
                const res = await fetch('/api/files?path=' + encodeURIComponent(subPath));
                if (!res.ok) throw new Error();
                const files = await res.json();

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
            const btn = document.getElementById('btnCopyUser');
            btn.disabled = selectedServerItems.size === 0;
            btn.innerText = "COPY → (To User " +
                (selectedServerItems.size ? "(" + selectedServerItems.size + ")" : "") +
                ")";
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

            if (selectedUserFiles.length === 0) {
                document.getElementById('userPathDisplay').innerText = "Select files or folder to prepare copy";
                document.getElementById('btnCopyServer').disabled = true;
                return;
            }

            document.getElementById('userPathDisplay').innerText = selectedUserFiles.length + " file(s) selected";
            document.getElementById('btnCopyServer').disabled = false;

            selectedUserFiles.forEach(file => {
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
                listEl.appendChild(div);
            });
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
