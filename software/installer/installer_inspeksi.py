import sys
import os
import subprocess
import json
import hashlib
import socket
import time
import shutil
from pathlib import Path

# ==========================================
# KONFIGURASI GLOBAL & CONSTANTS
# ==========================================
SERVICE_NAME = "b7_inspeksi"
FRONTEND_PORT = 2025
STATE_FILENAME = "installer_state.json"


def get_installer_dir() -> Path:
    """
    Mengambil direktori tempat installer.exe atau installer.py berada.
    Menghindari masalah hardcoded path dan perbedaan CWD.
    """
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


# Path berbasis Root Deployment
ROOT_DIR = get_installer_dir()
FRONTEND_DIR = ROOT_DIR / "frontend"
RUN_SERVER_DIR = ROOT_DIR / "run_server"

BACKEND_EXE = RUN_SERVER_DIR / "b7_inspeksi.exe"
PACKAGE_JSON = FRONTEND_DIR / "package.json"
PACKAGE_LOCK = FRONTEND_DIR / "package-lock.json"
NODE_MODULES = FRONTEND_DIR / "node_modules"
NEXT_BUILD_DIR = FRONTEND_DIR / ".next"
STATE_FILE = ROOT_DIR / STATE_FILENAME
NSSM_EXE = RUN_SERVER_DIR / "nssm.exe"

# PID Tracking untuk instance Frontend
frontend_process = None


# ==========================================
# HELPER SYSTEM & UTILITIES
# ==========================================
def run_command(cmd, cwd=None, check=True) -> tuple[int, str, str]:
    """Menjalankan perintah eksternal secara aman dan menangkap stdout/stderr."""
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            shell=True
        )
        if check and result.returncode != 0:
            print(f"\n[ERROR] Command gagal execution: {cmd}")
            if result.stdout:
                print(f"STDOUT:\n{result.stdout.strip()}")
            if result.stderr:
                print(f"STDERR:\n{result.stderr.strip()}")
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        print(f"\n[ERROR] Gagal eksekusi process: {e}")
        return -1, "", str(e)


def is_port_in_use(port: int) -> bool:
    """Mengecek apakah port tertentu sedang aktif digunakan."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == 0


def get_lan_ip() -> str:
    """Mendeteksi IP LAN mesin secara normal tanpa external lookup."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "Tidak terdeteksi"


# ==========================================
# VALIDASI & DETECTION
# ==========================================
def validate_deployment_structure() -> bool:
    """Memastikan struktur deployment minimal terpenuhi sebelum dieksekusi."""
    print("[1/7] Memeriksa struktur folder deployment...")
    
    missing = []
    if not FRONTEND_DIR.is_dir():
        missing.append(f"Folder: {FRONTEND_DIR}")
    if not RUN_SERVER_DIR.is_dir():
        missing.append(f"Folder: {RUN_SERVER_DIR}")
    if not PACKAGE_JSON.is_file():
        missing.append(f"File: {PACKAGE_JSON}")
    if not BACKEND_EXE.is_file():
        missing.append(f"File: {BACKEND_EXE}")

    if missing:
        print("\n[ERROR] Deployment structure tidak lengkap!")
        for item in missing:
            print(f"  - Missing: {item}")
        return False
    
    print("  ✓ Struktur folder dan file utama lengkap.")
    return True


def check_node_environment() -> bool:
    """Mengecek ketersediaan node dan npm di environment Windows."""
    print("[2/7] Memeriksa environment Node.js & NPM...")
    
    code_node, out_node, _ = run_command("node --version", check=False)
    code_npm, out_npm, _ = run_command("npm --version", check=False)

    if code_node != 0 or code_npm != 0:
        print("\n[ERROR] Node.js atau NPM tidak ditemukan di Windows Environment PATH.")
        print("Silakan install Node.js terlebih dahulu dari situs resminya.")
        return False
    
    print(f"  ✓ Node.js : {out_node.strip()}")
    print(f"  ✓ NPM     : {out_npm.strip()}")
    return True


# ==========================================
# STATE & HASH MANAGEMENT (DETEKSI PERUBAHAN)
# ==========================================
def load_state() -> dict:
    if STATE_FILE.is_file():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_state(state: dict):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[WARN] Gagal menyimpan installer_state.json: {e}")


def calculate_dir_hash(paths: list[Path]) -> str:
    """Menghitung hash kombinasi file untuk mendeteksi perubahan source frontend."""
    hasher = hashlib.md5()
    
    def hash_file(p: Path):
        if p.is_file():
            try:
                hasher.update(p.name.encode())
                hasher.update(str(p.stat().st_mtime).encode())
                hasher.update(str(p.stat().st_size).encode())
            except Exception:
                pass

    for path in paths:
        if not path.exists():
            continue
        if path.is_file():
            hash_file(path)
        elif path.is_dir():
            for root, _, files in os.walk(path):
                for file in files:
                    hash_file(Path(root) / file)

    return hasher.hexdigest()


# ==========================================
# FRONTEND DEPLOYMENT MANAGEMENT
# ==========================================
def process_frontend_build(state: dict) -> bool:
    """Mengelola npm install dan npm run build berdasarkan deteksi kondisi real & hash."""
    print("[3/7] Memeriksa dependencies & build frontend...")

    # Files untuk mendeteksi kebutuhan rebuild
    source_paths = [
        PACKAGE_JSON,
        PACKAGE_LOCK,
        FRONTEND_DIR / "next.config.ts",
        FRONTEND_DIR / "tsconfig.json",
        FRONTEND_DIR / "app",
        FRONTEND_DIR / "public"
    ]
    
    current_hash = calculate_dir_hash(source_paths)
    last_hash = state.get("frontend_hash", "")

    # Check 1: Need npm install?
    need_install = False
    if not NODE_MODULES.is_dir():
        print("  - Folder node_modules tidak ditemukan. Menjalankan npm install...")
        need_install = True
    elif state.get("last_package_hash") != calculate_dir_hash([PACKAGE_JSON, PACKAGE_LOCK]):
        print("  - Perubahan package.json/package-lock.json terdeteksi. Menjalankan npm install...")
        need_install = True

    if need_install:
        code, _, _ = run_command("npm install", cwd=FRONTEND_DIR)
        if code != 0:
            print("[ERROR] 'npm install' gagal.")
            return False
        state["last_package_hash"] = calculate_dir_hash([PACKAGE_JSON, PACKAGE_LOCK])
    else:
        print("  ✓ Dependencies (node_modules) sudah siap.")

    # Check 2: Need npm run build?
    need_build = False
    if not NEXT_BUILD_DIR.is_dir():
        print("  - Folder build (.next) tidak ditemukan. Menjalankan npm run build...")
        need_build = True
    elif current_hash != last_hash:
        print("  - Perubahan source frontend terdeteksi. Menjalankan npm run build...")
        need_build = True

    if need_build:
        code, _, _ = run_command("npm run build", cwd=FRONTEND_DIR)
        if code != 0:
            print("[ERROR] 'npm run build' gagal.")
            return False
        state["frontend_hash"] = current_hash
        state["frontend_build_completed"] = True
    else:
        print("  ✓ Build frontend (.next) sudah siap dan up-to-date.")

    save_state(state)
    return True


# ==========================================
# SERVICE MANAGEMENT (NSSM & BACKEND GO)
# ==========================================
def ensure_nssm() -> str | None:
    """Memastikan NSSM tersedia di PATH atau di folder run_server."""
    code, _, _ = run_command("nssm --version", check=False)
    if code == 0:
        return "nssm"
    
    if NSSM_EXE.is_file():
        return str(NSSM_EXE)
    
    print("\n[ERROR] NSSM executable tidak ditemukan!")
    print(f"Pastikan nssm.exe berada di {RUN_SERVER_DIR} atau terdaftar pada System PATH.")
    return None


def get_service_status(nssm_bin: str) -> str:
    """Mengambil status aktual dari Windows Service."""
    code, stdout, _ = run_command(f'"{nssm_bin}" status {SERVICE_NAME}', check=False)
    if code == 0:
        return stdout.strip()
    return "NOT_INSTALLED"


def setup_backend_service(state: dict) -> bool:
    """Mengonfigurasi dan mengaktifkan Windows Service untuk backend Go."""
    print("[4/7] Memeriksa & Mengonfigurasi Windows Service Backend...")

    nssm_bin = ensure_nssm()
    if not nssm_bin:
        return False

    status = get_service_status(nssm_bin)

    if status == "NOT_INSTALLED":
        print(f"  - Membuat service '{SERVICE_NAME}'...")
        cmd_install = f'"{nssm_bin}" install {SERVICE_NAME} "{BACKEND_EXE}"'
        code, _, _ = run_command(cmd_install)
        if code != 0:
            print("[ERROR] Gagal mendaftarkan service dengan NSSM. Pastikan installer dijalankan sebagai Administrator.")
            return False

        # Set AppDirectory agar service mengenali lokasi kerja backend
        run_command(f'"{nssm_bin}" set {SERVICE_NAME} AppDirectory "{RUN_SERVER_DIR}"')
    else:
        print(f"  ✓ Service '{SERVICE_NAME}' sudah terdaftar.")
        # Re-path jika direktori berpindah (Portable support)
        run_command(f'"{nssm_bin}" set {SERVICE_NAME} Application "{BACKEND_EXE}"', check=False)
        run_command(f'"{nssm_bin}" set {SERVICE_NAME} AppDirectory "{RUN_SERVER_DIR}"', check=False)

    # Start Service jika belum berjalan
    status = get_service_status(nssm_bin)
    if status != "SERVICE_RUNNING":
        print(f"  - Menjalankan service '{SERVICE_NAME}'...")
        run_command(f'"{nssm_bin}" start {SERVICE_NAME}', check=False)
        time.sleep(2)  # Memberi jeda startup service

    final_status = get_service_status(nssm_bin)
    print(f"  ✓ Status Service Backend: {final_status}")

    state["backend_service_configured"] = True
    save_state(state)
    return final_status == "SERVICE_RUNNING"


# ==========================================
# RUNNER FRONTEND (PRODUCTION)
# ==========================================
def start_frontend_server():
    """Menjalankan Next.js server produksi (npm run start)."""
    global frontend_process
    print("[5/7] Memeriksa status Frontend Server...")

    if is_port_in_use(FRONTEND_PORT):
        print(f"  ✓ Frontend Server sudah berjalan di port {FRONTEND_PORT}.")
        return True

    print(f"  - Menjalankan Frontend Production Server di port {FRONTEND_PORT}...")
    try:
        frontend_process = subprocess.Popen(
            "npm run start",
            cwd=str(FRONTEND_DIR),
            shell=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        )
        
        # Verifikasi port terhubung (max 10 detik timeout)
        for _ in range(10):
            time.sleep(1)
            if is_port_in_use(FRONTEND_PORT):
                print("  ✓ Frontend Server berhasil berjalan.")
                return True
        
        print("[WARN] Frontend Server memakan waktu lama untuk bind port.")
        return True
    except Exception as e:
        print(f"[ERROR] Gagal memunculkan process frontend: {e}")
        return False


def stop_frontend_server():
    """Menghentikan instance Frontend yang dikelola runner."""
    global frontend_process
    if frontend_process and frontend_process.poll() is None:
        print("Menghentikan Frontend Server...")
        subprocess.run(f"taskkill /F /T /PID {frontend_process.pid}", shell=True, capture_output=True)
        frontend_process = None
        print("Frontend Server dihentikan.")
    else:
        print("Tidak ada instance Frontend aktif yang dikelola installer.")


# ==========================================
# FLOW UTAMA INSTALL / RUN
# ==========================================
def execute_deployment_flow():
    state = load_state()

    if not validate_deployment_structure():
        return False

    if not check_node_environment():
        return False

    if not process_frontend_build(state):
        return False

    if not setup_backend_service(state):
        return False

    if not start_frontend_server():
        return False

    return True


# ==========================================
# INTERFACE CLI / MENU
# ==========================================
def display_menu():
    nssm_bin = ensure_nssm()
    backend_status = get_service_status(nssm_bin) if nssm_bin else "UNKNOWN"
    
    frontend_status = "RUNNING" if is_port_in_use(FRONTEND_PORT) else "STOPPED"
    lan_ip = get_lan_ip()

    os.system("cls" if os.name == "nt" else "clear")
    print("==================================================")
    print("           B7 INSPEKSI DEPLOYMENT                 ")
    print("==================================================")
    print(f"Root      : {ROOT_DIR}")
    print(f"Frontend  : {FRONTEND_DIR}")
    print(f"Backend   : {RUN_SERVER_DIR}")
    print("--------------------------------------------------")
    print(f"Backend Service : {backend_status}")
    print(f"Frontend        : {frontend_status}")
    print(f"Frontend URL    : http://localhost:{FRONTEND_PORT}")
    if lan_ip != "Tidak terdeteksi":
        print(f"LAN URL         : http://{lan_ip}:{FRONTEND_PORT}")
    print("--------------------------------------------------")
    print("[R] Run / Install Deployment")
    print("[S] Stop Frontend")
    print("[X] Exit")
    print("==================================================")


def main():
    while True:
        display_menu()
        choice = input("\nPilih [R/S/X]: ").strip().upper()

        if choice == 'R':
            print("\n--- PROSES DEPLOYMENT & VERIFIKASI ---")
            success = execute_deployment_flow()
            if success:
                print("\n[SUCCESS] Seluruh layanan berhasil diinstal & dijalankan!")
            else:
                print("\n[FAIL] Terdapat kesalahan pada proses deployment.")
            input("\nTekan Enter untuk kembali ke menu...")
            
        elif choice == 'S':
            print("\n--- MENGHENTIKAN FRONTEND ---")
            stop_frontend_server()
            input("\nTekan Enter untuk kembali ke menu...")

        elif choice == 'X':
            print("\nKeluar dari installer...")
            # PENTING:
            # stop_frontend_server() dipanggil untuk membersihkan runner GUI frontend jika diinginkan,
            # Namun Windows Service BACKEND TETAP RUNNING dan TIDAK dihentikan.
            stop_frontend_server()
            break


if __name__ == "__main__":
    main()
