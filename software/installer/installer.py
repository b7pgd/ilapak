import os
import sys
import json
import time
import ctypes
import re
import socket
import subprocess
from pathlib import Path

# ==========================================
# 1. CORE & ENVIRONMENT HELPER
# ==========================================

def is_admin() -> bool:
    """Memeriksa apakah skrip berjalan dengan hak akses Administrator."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False

def run_elevated():
    """Melakukan re-launch skrip dengan UAC elevation jika belum Administrator."""
    if not is_admin():
        print("[!] Membutuhkan hak akses Administrator. Meminta izin UAC...")
        script = sys.executable if getattr(sys, 'frozen', False) else __file__
        params = f'"{script}"'
        if not getattr(sys, 'frozen', False):
            params = f'"{sys.argv[0]}"'
        ret = ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable if getattr(sys, 'frozen', False) else sys.executable, f'"{script}"' if getattr(sys, 'frozen', False) else f'"{params}"', None, 1)
        if ret > 32:
            sys.exit(0)
        else:
            print("[✗] ERROR: Gagal mendapatkan hak akses Administrator.")
            input("\nTekan ENTER untuk keluar...")
            sys.exit(1)

def get_root_dir() -> Path:
    """Mengambil direktori utama tempat installer.py / installer.exe berada."""
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent

ROOT_DIR = get_root_dir()
STATE_FILE = ROOT_DIR / "installer_state.json"

# ==========================================
# 2. LOGGING & DISPLAY HELPER
# ==========================================

def print_step(step_num: int, total_steps: int, title: str):
    print(f"\n[{step_num}/{total_steps}] {title}")

def print_success(msg: str):
    print(f"      ✓ {msg}")

def print_error(msg: str):
    print(f"      ✗ {msg}")

def print_warning(msg: str):
    print(f"      ! {msg}")

def print_info(msg: str):
    print(f"      - {msg}")

def handle_exit(success: bool, step_msg: str = ""):
    """
    Handling penutupan aplikasi.
    - Jika sukses: Countdown 10 detik lalu close.
    - Jika gagal: Tetap terbuka sampai user menekan ENTER.
    """
    print("\n========================================")
    if success:
        print("        INSTALLATION SUCCESSFUL        ")
        print("========================================")
        if step_msg:
            print(f"\n{step_msg}\n")
        print("Closing in 10 seconds...")
        for i in range(10, 0, -1):
            print(f"{i}...", end="\r", flush=True)
            time.sleep(1)
        print("\nDone.")
        sys.exit(0)
    else:
        print("          INSTALLATION FAILED          ")
        print("========================================")
        if step_msg:
            print(f"\n{step_msg}\n")
        print("========================================")
        print(" Installer will remain open because")
        print(" an error occurred.")
        print("========================================")
        print("Copy the log above and use it for debugging.")
        input("\nPress ENTER to close...")
        sys.exit(1)

# ==========================================
# 3. COMMAND EXECUTION & SYSTEM UTILS
# ==========================================

def run_cmd(cmd: str | list, cwd: Path = None, check: bool = False) -> tuple[int, str, str]:
    """Eksekusi command subprocess dengan aman dan menangkap output."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            shell=True
        )
        if check and proc.returncode != 0:
            print_error(f"Command execution failed: {cmd}")
            if proc.stdout:
                print(f"RAW STDOUT:\n{proc.stdout.strip()}")
            if proc.stderr:
                print(f"RAW STDERR:\n{proc.stderr.strip()}")
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except Exception as e:
        return -1, "", str(e)

def is_port_in_use(port: int) -> tuple[bool, int, str]:
    """Cek apakah port sedang digunakan dan dapatkan PID/Nama Process-nya jika ada."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        in_use = s.connect_ex(('127.0.0.1', port)) == 0

    if not in_use:
        return False, 0, ""

    # Dapatkan PID dan Process Name
    code, out, _ = run_cmd(f'netstat -ano | findstr :{port}')
    pid = 0
    pname = "Unknown"
    if code == 0 and out:
        lines = out.splitlines()
        for line in lines:
            parts = re.split(r'\s+', line.strip())
            if len(parts) >= 5 and "LISTENING" in parts:
                try:
                    pid = int(parts[-1])
                    break
                except ValueError:
                    pass

    if pid > 0:
        code, p_out, _ = run_cmd(f'tasklist /FI "PID eq {pid}" /FO CSV /NH')
        if code == 0 and p_out:
            pname = p_out.split(',')[0].replace('"', '')

    return True, pid, pname

# ==========================================
# 4. STATE MANAGEMENT
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
        print_warning(f"Gagal menyimpan installer_state.json: {e}")

# ==========================================
# 5. DISCOVERY MODULE (GENERIC DISCOVERY)
# ==========================================

def discover_backend_exe(root_dir: Path) -> Path | None:
    """Secara recursive mencari file .exe backend (menghindari installer itu sendiri)."""
    current_exe = Path(sys.executable).resolve() if getattr(sys, 'frozen', False) else None
    candidates = []

    for path in root_dir.rglob("*.exe"):
        # Abaikan file installer itu sendiri, nssm, atau uninstaller umum
        if current_exe and path.resolve() == current_exe:
            continue
        if path.name.lower() in ["nssm.exe", "unins000.exe", "installer.exe", "setup.exe", "node.exe"]:
            continue
        candidates.append(path)

    if not candidates:
        return None

    if len(candidates) == 1:
        return candidates[0]

    print("\nBackend executable candidates:")
    for idx, cand in enumerate(candidates, 1):
        print(f"[{idx}] {cand.relative_to(root_dir)}")

    while True:
        try:
            choice = input(f"\nPilih backend executable [1-{len(candidates)}]: ").strip()
            val = int(choice)
            if 1 <= val <= len(candidates):
                return candidates[val - 1]
        except ValueError:
            pass
        print("Pilihan tidak valid. Silakan coba lagi.")

def discover_frontend_standalone(root_dir: Path) -> list[Path]:
    """Mencari lokasi file .next/standalone/server.js secara recursive."""
    matches = []
    for path in root_dir.rglob("server.js"):
        normalized_parts = [p.lower() for p in path.parts]
        if ".next" in normalized_parts and "standalone" in normalized_parts:
            matches.append(path)
    return matches

def discover_frontend_project(root_dir: Path) -> Path | None:
    """Mencari folder Next.js berdasarkan package.json dan dependency Next."""
    candidates = []
    for package_file in root_dir.rglob("package.json"):
        if any(part.lower() in {"node_modules", ".next", "build", "dist"} for part in package_file.parts):
            continue
        try:
            with open(package_file, "r", encoding="utf-8") as f:
                package = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue

        dependencies = {
            **package.get("dependencies", {}),
            **package.get("devDependencies", {})
        }
        if "next" in dependencies and "build" in package.get("scripts", {}):
            candidates.append(package_file.parent)

    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        print("\nNext.js project candidates:")
        for idx, candidate in enumerate(candidates, 1):
            print(f"[{idx}] {candidate.relative_to(root_dir)}")
        while True:
            try:
                choice = int(input(f"\nPilih Next.js project [1-{len(candidates)}]: ").strip())
                if 1 <= choice <= len(candidates):
                    return candidates[choice - 1]
            except ValueError:
                pass
            print("Pilihan tidak valid. Silakan coba lagi.")
    return None

def discover_frontend_port(project_dir: Path) -> int | None:
    """Membaca PORT dari env atau script start package.json."""
    env_files = [project_dir / ".env.production", project_dir / ".env.local", project_dir / ".env"]
    for env_file in env_files:
        if not env_file.is_file():
            continue
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                match = re.match(r"^\s*PORT\s*=\s*(\d+)", line)
                if match:
                    return int(match.group(1))
        except OSError:
            pass

    try:
        package = json.loads((project_dir / "package.json").read_text(encoding="utf-8"))
        start_script = package.get("scripts", {}).get("start", "")
        match = re.search(r"(?:-p|--port)\s+(\d+)", start_script)
        if match:
            return int(match.group(1))
    except (OSError, json.JSONDecodeError):
        pass

    return None

def prompt_frontend_choice(matches: list[Path], root_dir: Path) -> Path:
    if len(matches) == 1:
        return matches[0]

    print("\nNext.js standalone server.js candidates:")
    for idx, cand in enumerate(matches, 1):
        print(f"[{idx}] {cand.relative_to(root_dir)}")

    while True:
        try:
            choice = input(f"\nPilih Next.js standalone file [1-{len(matches)}]: ").strip()
            val = int(choice)
            if 1 <= val <= len(matches):
                return matches[val - 1]
        except ValueError:
            pass
        print("Pilihan tidak valid. Silakan coba lagi.")

# ==========================================
# 6. RUNTIME & DEPENDENCY DETECTION
# ==========================================

def ensure_nssm(root_dir: Path) -> str | None:
    """Mengecek keberadaan NSSM di PATH atau lokal folder."""
    code, _, _ = run_cmd("nssm --version")
    if code == 0:
        return "nssm"

    for nssm_path in root_dir.rglob("nssm.exe"):
        if nssm_path.is_file():
            return str(nssm_path.resolve())

    return None

def ensure_node_js() -> str | None:
    """Mencari Node.js dan memasangnya melalui winget jika belum tersedia."""
    code, out, _ = run_cmd("node --version")
    if code == 0:
        code_path, out_path, _ = run_cmd("where node")
        if code_path == 0 and out_path:
            return out_path.splitlines()[0].strip()
        return "node"

    # Common Windows Node.js paths fallback
    common_paths = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "nodejs" / "node.exe",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "nodejs" / "node.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "node" / "node.exe"
    ]

    for p in common_paths:
        if p.is_file():
            return str(p)

    print_warning("Node.js belum ditemukan. Mencoba memasang Node.js LTS melalui winget...")
    install_code, _, install_err = run_cmd(
        "winget install --id OpenJS.NodeJS.LTS --exact "
        "--accept-source-agreements --accept-package-agreements --silent"
    )
    if install_code != 0:
        print_error(f"Instalasi Node.js gagal: {install_err or 'winget mengembalikan error.'}")
        return None

    node_dirs = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "nodejs",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "node"
    ]
    for node_dir in node_dirs:
        node_path = node_dir / "node.exe"
        npm_path = node_dir / "npm.cmd"
        if node_path.is_file():
            os.environ["PATH"] = f"{node_dir};{os.environ.get('PATH', '')}"
            if npm_path.is_file():
                return str(node_path)

    return None

def prepare_next_project(project_dir: Path) -> tuple[str | None, Path | None]:
    """Memasang dependency npm dan membuat build standalone Next.js."""
    node_bin = ensure_node_js()
    if not node_bin:
        return None, None

    npm_bin = Path(node_bin).with_name("npm.cmd")
    if not npm_bin.is_file():
        npm_bin = Path("npm.cmd")

    print_info(f"Installing npm dependencies in {project_dir}...")
    code, _, _ = run_cmd(f'"{npm_bin}" install', cwd=project_dir, check=True)
    if code != 0:
        return node_bin, None
    print_success("npm dependencies installed.")

    print_info("Building Next.js standalone deployment...")
    code, _, _ = run_cmd(f'"{npm_bin}" run build', cwd=project_dir, check=True)
    if code != 0:
        return node_bin, None
    print_success("Next.js standalone build completed.")

    matches = discover_frontend_standalone(project_dir)
    if not matches:
        print_error("Build selesai tetapi .next\\standalone\\server.js tidak ditemukan.")
        return node_bin, None
    return node_bin, prompt_frontend_choice(matches, ROOT_DIR)

# ==========================================
# 7. SERVICE & HEALTH MANAGEMENT
# ==========================================

def get_service_status(nssm_bin: str, service_name: str) -> str:
    code, stdout, _ = run_cmd(f'"{nssm_bin}" status {service_name}')
    if code == 0:
        return stdout.strip()
    return "NOT_INSTALLED"

def register_or_update_service(nssm_bin: str, service_name: str, app_path: str, app_dir: str, args: str = "", port: int | None = None) -> bool:
    status = get_service_status(nssm_bin, service_name)
    if status == "NOT_INSTALLED":
        cmd_install = f'"{nssm_bin}" install {service_name} "{app_path}"'
        if args:
            cmd_install += f' {args}'
        code, _, stderr = run_cmd(cmd_install)
        if code != 0:
            print_error(f"Gagal mendaftarkan service {service_name}: {stderr}")
            return False
    else:
        # Update konfigurasi jika service sudah terdaftar
        run_cmd(f'"{nssm_bin}" set {service_name} Application "{app_path}"')
        if args:
            run_cmd(f'"{nssm_bin}" set {service_name} AppParameters {args}')
        else:
            run_cmd(f'"{nssm_bin}" reset {service_name} AppParameters')

    run_cmd(f'"{nssm_bin}" set {service_name} AppDirectory "{app_dir}"')
    run_cmd(f'"{nssm_bin}" set {service_name} Start SERVICE_AUTO_START')
    if port is not None:
        run_cmd(f'"{nssm_bin}" set {service_name} AppEnvironmentExtra PORT={port}')
    else:
        run_cmd(f'"{nssm_bin}" reset {service_name} AppEnvironmentExtra')
    log_dir = ROOT_DIR / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    run_cmd(f'"{nssm_bin}" set {service_name} AppStdout "{log_dir / (service_name + ".out.log")}"')
    run_cmd(f'"{nssm_bin}" set {service_name} AppStderr "{log_dir / (service_name + ".err.log")}"')
    run_cmd(f'"{nssm_bin}" set {service_name} AppRotateFiles 1')
    run_cmd(f'"{nssm_bin}" set {service_name} AppRotateOnline 1')
    return True

def start_service_if_needed(nssm_bin: str, service_name: str) -> bool:
    status = get_service_status(nssm_bin, service_name)
    if status == "SERVICE_RUNNING":
        return True

    print_info(f"Restarting service {service_name} from status {status}...")
    run_cmd(f'"{nssm_bin}" stop {service_name}')
    time.sleep(1)
    run_cmd(f'"{nssm_bin}" start {service_name}')

    for _ in range(10):
        time.sleep(1)
        status = get_service_status(nssm_bin, service_name)
        if status == "SERVICE_RUNNING":
            return True
        if status in {"SERVICE_STOPPED", "SERVICE_PAUSED"}:
            continue

    print_error(f"Service {service_name} did not reach SERVICE_RUNNING (last status: {status}).")
    return False

# ==========================================
# 8. DIAGNOSTICS MODULE (DATABASE & SERVICE)
# ==========================================

def read_env_file(root_dir: Path) -> dict:
    """Mencari dan membaca file .env di sekitar project untuk keperluan diagnostik."""
    env_vars = {}
    env_files = list(root_dir.rglob(".env")) + list(root_dir.rglob(".env.local")) + list(root_dir.rglob(".env.production"))
    
    for ef in env_files:
        if ef.is_file():
            try:
                with open(ef, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            env_vars[k.strip()] = v.strip().strip('"').strip("'")
            except Exception:
                pass
    return env_vars

def run_database_diagnostics(root_dir: Path):
    """Diagnostik terstruktur untuk PostgreSQL / Database tanpa ekspos password."""
    print("\nDatabase Diagnostics")
    print("--------------------------------")
    
    env_vars = read_env_file(root_dir)
    if not env_vars:
        print_info("[1] Configuration file        ! Not found (.env)")
        return

    print_success("[1] Configuration file        ✓ Found")

    host = env_vars.get("DB_HOST", "127.0.0.1")
    port_str = env_vars.get("DB_PORT", "5432")
    dbname = env_vars.get("DB_NAME", "")
    user = env_vars.get("DB_USER", "")
    password = env_vars.get("DB_PASSWORD", "")

    try:
        port = int(port_str)
    except ValueError:
        port = 5432

    print_info(f"[2] DB_HOST                   ✓ {host}")
    print_info(f"[3] DB_PORT                   ✓ {port}")

    # Step 1: Reachable Test
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3)
    reachable = sock.connect_ex((host, port)) == 0
    sock.close()

    if not reachable:
        print_error("[4] Database server           ✗ Unreachable")
        print("\nDATABASE CONNECTION FAILED")
        print("Possible causes:")
        print("  - PostgreSQL/Database service is stopped")
        print("  - DB_HOST / DB_PORT incorrect")
        print("  - Firewall or network issue blocking connection")
        return
    else:
        print_success("[4] Database server           ✓ Reachable")

    # Step 2: Test via psql CLI if available
    code_psql, _, _ = run_cmd("psql --version")
    if code_psql == 0 and dbname and user:
        os.environ["PGPASSWORD"] = password
        cmd_test = f'psql -h {host} -p {port} -U {user} -d {dbname} -c "SELECT 1;"'
        code_conn, out_conn, err_conn = run_cmd(cmd_test)
        os.environ.pop("PGPASSWORD", None)

        if code_conn == 0:
            print_success("[5] Database connection       ✓ Verified")
        else:
            print_error("[5] Database authentication   ✗ FAILED")
            print("\nDATABASE CONNECTION FAILED")
            if "password authentication failed" in err_conn.lower():
                print("\nLikely cause:\n  Database username/password does not match.")
            elif f'database "{dbname}" does not exist' in err_conn.lower():
                print(f"\nLikely cause:\n  Database '{dbname}' does not exist on the server.")
            else:
                print("\nPossible causes:")
                print("  - Invalid credentials or database permissions")
                print("  - Database configuration mismatch")
            
            print("\nPlease check:")
            print(f"  - DB_USER: {user}")
            print(f"  - DB_HOST: {host}:{port}")
            print(f"  - DB_NAME: {dbname}")
            print("  - DB_PASSWORD: ******** (Hidden for security)")

def run_backend_error_diagnostics(exe_path: Path, root_dir: Path):
    """Menjalankan executable secara langsung dalam durasi singkat untuk menangkap stdout/stderr."""
    print_info("Running temporary backend process diagnostic...")
    try:
        proc = subprocess.Popen(
            [str(exe_path)],
            cwd=str(exe_path.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        try:
            stdout, stderr = proc.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()

        print(f"\nBackend process exited with code {proc.returncode}.")
        if stdout.strip():
            print(f"\n[Raw STDOUT]:\n{stdout.strip()}")
        if stderr.strip():
            print(f"\n[Raw STDERR]:\n{stderr.strip()}")

        # Analisa error spesifik
        err_full = (stdout + "\n" + stderr).lower()
        if "connect" in err_full or "sql" in err_full or "postgres" in err_full or "dial" in err_full:
            run_database_diagnostics(root_dir)

    except Exception as e:
        print_error(f"Gagal menjalankan diagnostik executable: {e}")

def run_frontend_error_diagnostics(node_bin: str, server_path: Path, nssm_bin: str, service_name: str, port: int | None):
    """Menjalankan server Next secara langsung dan menampilkan error runtime lengkap."""
    print_info("Running temporary frontend process diagnostic...")
    try:
        print_info(f"Command: {node_bin} {server_path}")
        print_info(f"Working directory: {server_path.parent}")
        diagnostic_env = os.environ.copy()
        if port is not None:
            print_info(f"PORT: {port} (from project configuration)")
            diagnostic_env["PORT"] = str(port)
        else:
            print_info("PORT: not overridden; using project/runtime default")
        timed_out = False
        proc = subprocess.Popen(
            [node_bin, str(server_path)],
            cwd=str(server_path.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=diagnostic_env
        )
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            timed_out = True
            proc.kill()
            stdout, stderr = proc.communicate()
            print_success("Frontend process stayed alive for 5 seconds in direct test.")

        if not timed_out:
            print(f"\nFrontend process exited with code {proc.returncode}.")
        if stdout.strip():
            print(f"\n[Frontend STDOUT]:\n{stdout.strip()}")
        if stderr.strip():
            print(f"\n[Frontend STDERR]:\n{stderr.strip()}")
        if not stdout.strip() and not stderr.strip():
            print_warning("Frontend tidak mengeluarkan stdout/stderr saat proses berhenti.")

        print("\nNSSM service configuration:")
        for setting in ("Application", "AppParameters", "AppDirectory", "AppStdout", "AppStderr"):
            code, value, error = run_cmd(f'"{nssm_bin}" get {service_name} {setting}')
            if code == 0:
                print_info(f"{setting}: {value}")
            elif error:
                print_error(f"{setting}: {error}")

        log_dir = ROOT_DIR / "logs"
        print_info(f"NSSM stdout log: {log_dir / (service_name + '.out.log')}")
        print_info(f"NSSM stderr log: {log_dir / (service_name + '.err.log')}")
    except Exception as e:
        print_error(f"Gagal menjalankan diagnostik frontend: {e}")

# ==========================================
# 9. MAIN DEPLOYMENT PIPELINE
# ==========================================

def run_deployment_pipeline(backend_service: str, frontend_service: str, backend_exe: Path, frontend_server: Path, frontend_port: int):
    total_steps = 8
    
    # ----------------------------------------------------
    print_step(1, total_steps, "Detecting deployment")
    print_success(f"Backend executable found: {backend_exe}")
    
    # ----------------------------------------------------
    print_step(2, total_steps, "Detecting Next.js standalone")
    print_success(f"server.js found: {frontend_server}")

    # ----------------------------------------------------
    print_step(3, total_steps, "Checking Node.js")
    node_bin = ensure_node_js()
    if not node_bin:
        print_error("Node.js runtime tidak ditemukan di environment PATH.")
        handle_exit(False, "Node.js missing. Next.js standalone requires Node.js runtime.")
    
    _, node_ver, _ = run_cmd(f'"{node_bin}" --version')
    print_success(f"Node.js available: {node_ver} ({node_bin})")

    # ----------------------------------------------------
    print_step(4, total_steps, "Checking NSSM")
    nssm_bin = ensure_nssm(ROOT_DIR)
    if not nssm_bin:
        print_error("NSSM executable tidak ditemukan!")
        handle_exit(False, "NSSM is required to register Windows Services.")
    print_success(f"NSSM available: {nssm_bin}")

    # ----------------------------------------------------
    print_step(5, total_steps, f"Configuring backend service [{backend_service}]")
    if not register_or_update_service(nssm_bin, backend_service, str(backend_exe), str(backend_exe.parent)):
        handle_exit(False, f"Failed to register backend service '{backend_service}'.")
    print_success(f"Backend service '{backend_service}' registered.")

    # ----------------------------------------------------
    print_step(6, total_steps, f"Starting backend service [{backend_service}]")
    if not start_service_if_needed(nssm_bin, backend_service):
        print_error(f"Backend service '{backend_service}' failed to start.")
        run_backend_error_diagnostics(backend_exe, ROOT_DIR)
        handle_exit(False, f"Backend service start failed.")
    print_success(f"Backend service '{backend_service}' is RUNNING.")

    # ----------------------------------------------------
    print_step(7, total_steps, f"Configuring & Starting frontend service [{frontend_service}]")
    node_args = f'"{str(frontend_server)}"'
    if not register_or_update_service(nssm_bin, frontend_service, node_bin, str(frontend_server.parent), args=node_args, port=frontend_port):
        handle_exit(False, f"Failed to register frontend service '{frontend_service}'.")

    if not start_service_if_needed(nssm_bin, frontend_service):
        print_error(f"Frontend service '{frontend_service}' failed to start.")
        run_frontend_error_diagnostics(node_bin, frontend_server, nssm_bin, frontend_service, frontend_port)
        print("\nPossible causes:")
        print("  - Required standalone dependency missing")
        print("  - Port already in use by another application")
        print("  - Invalid Node.js execution environment")
        handle_exit(False, "Frontend service start failed.")
    print_success(f"Frontend service '{frontend_service}' is RUNNING.")

    # ----------------------------------------------------
    print_step(8, total_steps, "Performing Health Checks")
    b_status = get_service_status(nssm_bin, backend_service)
    f_status = get_service_status(nssm_bin, frontend_service)

    print_info(f"Backend Service Status  : {b_status}")
    print_info(f"Frontend Service Status : {f_status}")

    if b_status == "SERVICE_RUNNING" and f_status == "SERVICE_RUNNING":
        print_success("All services are healthy and running.")
        save_state({
            "backend_service_name": backend_service,
            "frontend_service_name": frontend_service,
            "backend_executable": str(backend_exe),
            "frontend_server": str(frontend_server)
        })
        handle_exit(True, f"Backend Service  ✓ {backend_service} (RUNNING)\nFrontend Service ✓ {frontend_service} (RUNNING)")
    else:
        handle_exit(False, "Health check failed: One or more services are not running.")

# ==========================================
# 10. CLI INTERFACE
# ==========================================

def main():
    run_elevated()
    
    state = load_state()
    
    os.system("cls" if os.name == "nt" else "clear")
    print("========================================")
    print("     GENERIC APPLICATION INSTALLER      ")
    print("========================================")
    print(f"Root Directory: {ROOT_DIR}\n")

    if state.get("backend_service_name") and state.get("frontend_service_name"):
        print("Existing deployment detected:")
        print(f"  Backend Service  : {state.get('backend_service_name')}")
        print(f"  Frontend Service : {state.get('frontend_service_name')}")
        print("\n[R] Repair / Update / Restart")
        print("[C] Reconfigure services")
        print("[X] Exit")
        choice = input("\nPilih option [R/C/X]: ").strip().upper()
        if choice == 'X':
            sys.exit(0)
        elif choice == 'C':
            state = {}  # Reset configuration
    else:
        print("[R] Install / Repair / Update")
        print("[X] Exit")
        choice = input("\nPilih option [R/X]: ").strip().upper()
        if choice != 'R':
            sys.exit(0)

    # Discovery Phase
    print("\nScanning deployment...")
    
    backend_exe = discover_backend_exe(ROOT_DIR)
    if not backend_exe:
        print_error("Backend executable (.exe) tidak ditemukan di deployment directory.")
        handle_exit(False, "No valid backend executable found.")
    print_success(f"Backend executable detected:\n  {backend_exe}")

    frontend_project = discover_frontend_project(ROOT_DIR)
    if not frontend_project:
        print_error("Project Next.js dengan package.json tidak ditemukan.")
        handle_exit(False, "Next.js project not found.")
    print_success(f"Next.js project detected:\n  {frontend_project}")

    print("\nPreparing frontend dependencies...")
    _, frontend_server = prepare_next_project(frontend_project)
    if not frontend_server:
        handle_exit(False, "Frontend preparation failed. Check Node.js, npm, and build output above.")
    print_success(f"Next.js standalone detected:\n  {frontend_server}")
    frontend_port = discover_frontend_port(frontend_project)
    print_success(f"Frontend port detected: {frontend_port}")

    # Service Naming Phase
    print("\n========================================")
    print("         SERVICE CONFIGURATION          ")
    print("========================================")
    
    default_backend = state.get("backend_service_name", "")
    default_frontend = state.get("frontend_service_name", "")

    backend_prompt = f"Nama service backend [{default_backend}]: " if default_backend else "Nama service backend: "
    backend_service = input(backend_prompt).strip() or default_backend

    frontend_prompt = f"Nama service frontend [{default_frontend}]: " if default_frontend else "Nama service frontend: "
    frontend_service = input(frontend_prompt).strip() or default_frontend

    if not backend_service or not frontend_service:
        print_error("Nama service backend dan frontend wajib diisi.")
        handle_exit(False, "Service names cannot be empty.")

    print("\n----------------------------------------")
    print(f"Backend Service  : {backend_service}")
    print(f"Frontend Service : {frontend_service}")
    print("----------------------------------------")
    print("Tekan R untuk mulai deployment.")
    print("Tekan X untuk batal.")

    confirm = input("\nPilih [R/X]: ").strip().upper()
    if confirm != 'R':
        print("\nDeployment dibatalkan.")
        sys.exit(0)

    # Execute Installation
    run_deployment_pipeline(backend_service, frontend_service, backend_exe, frontend_server, frontend_port)

if __name__ == "__main__":
    main()
