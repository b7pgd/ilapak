import os
import sys
import json
import time
import ctypes
import re
import socket
import subprocess
import shutil
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
        ret = ctypes.windll.shell32.ShellExecuteW(
            None, "runas",
            sys.executable if getattr(sys, 'frozen', False) else sys.executable,
            f'"{script}"' if getattr(sys, 'frozen', False) else f'"{params}"',
            None, 1
        )
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
LOGS_DIR = ROOT_DIR / "logs"

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
        print("     INSTALLATION / UPDATE SUCCESSFUL   ")
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
        print("       INSTALLATION / UPDATE FAILED     ")
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

def sanitize_filename(name: str) -> str:
    """Membersihkan string dari karakter ilegal untuk file Windows."""
    return re.sub(r'[\\/*?:"<>|]', '_', name)

# ==========================================
# 3. COMMAND EXECUTION & SYSTEM UTILS
# ==========================================

def run_cmd(cmd: str | list, cwd: Path = None, check: bool = False, use_shell: bool = False) -> tuple[int, str, str]:
    """Eksekusi command subprocess dengan aman dan menangkap output."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            shell=use_shell
        )
        if check and proc.returncode != 0:
            print_error(f"COMMAND EXECUTION FAILED")
            print(f"Command      : {cmd}")
            print(f"Return code  : {proc.returncode}")
            if proc.stdout:
                print(f"STDOUT       : {proc.stdout.strip()}")
            if proc.stderr:
                print(f"STDERR       : {proc.stderr.strip()}")
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except Exception as e:
        return -1, "", str(e)

def inspect_port_owner(port: int) -> tuple[bool, int, str]:
    """Cek apakah port sedang digunakan dan dapatkan PID & Process Name secara presisi."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        in_use = s.connect_ex(('127.0.0.1', port)) == 0

    if not in_use:
        return False, 0, ""

    code, out, _ = run_cmd(['netstat', '-ano'])
    pid = 0
    pname = "Unknown"
    if code == 0 and out:
        lines = out.splitlines()
        for line in lines:
            if f":{port} " in line or f":{port}\t" in line:
                parts = re.split(r'\s+', line.strip())
                if len(parts) >= 5 and "LISTENING" in parts:
                    try:
                        pid = int(parts[-1])
                        break
                    except ValueError:
                        pass

    if pid > 0:
        code, p_out, _ = run_cmd(['tasklist', '/FI', f'PID eq {pid}', '/FO', 'CSV', '/NH'])
        if code == 0 and p_out:
            pname = p_out.split(',')[0].replace('"', '')

    return True, pid, pname

def get_file_metadata(path: Path) -> dict:
    """Mengambil metadata file untuk deteksi perubahan (mtime dan size)."""
    if not path or not path.exists():
        return {"mtime": 0, "size": 0, "path": ""}
    try:
        stat = path.stat()
        return {
            "mtime": stat.st_mtime,
            "size": stat.st_size,
            "path": str(path.resolve())
        }
    except Exception:
        return {"mtime": 0, "size": 0, "path": str(path)}

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

def discover_go_project(root_dir: Path) -> Path | None:
    """Mencari file go.mod untuk mendeteksi project Go."""
    mods = list(root_dir.rglob("go.mod"))
    if not mods:
        return None
    return mods[0].parent

def discover_backend_exe(root_dir: Path) -> Path | None:
    """Secara recursive mencari file .exe backend (menghindari installer & utilitas)."""
    current_exe = Path(sys.executable).resolve() if getattr(sys, 'frozen', False) else None
    candidates = []

    for path in root_dir.rglob("*.exe"):
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

def discover_nextjs_project(root_dir: Path) -> Path | None:
    """Mencari package.json yang menggunakan dependency 'next'."""
    for pkg in root_dir.rglob("package.json"):
        if "node_modules" in pkg.parts:
            continue
        try:
            with open(pkg, "r", encoding="utf-8") as f:
                data = json.load(f)
                deps = data.get("dependencies", {})
                dev_deps = data.get("devDependencies", {})
                if "next" in deps or "next" in dev_deps:
                    return pkg.parent
        except Exception:
            pass
    return None

def discover_frontend_standalone(root_dir: Path) -> list[Path]:
    """Mencari lokasi file .next/standalone/server.js secara recursive."""
    matches = []
    for path in root_dir.rglob("server.js"):
        normalized_parts = [p.lower() for p in path.parts]
        if ".next" in normalized_parts and "standalone" in normalized_parts:
            matches.append(path)
    return matches

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

def is_source_newer_than_target(source_dir: Path, target_file: Path, extensions: list[str]) -> bool:
    """Mengecek apakah ada source file yang lebih baru dari target artifact."""
    if not target_file.exists():
        return True

    target_mtime = target_file.stat().st_mtime
    for p in source_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in extensions:
            if "node_modules" in p.parts or ".next" in p.parts or "vendor" in p.parts:
                continue
            if p.stat().st_mtime > target_mtime:
                return True
    return False

# ==========================================
# 6. RUNTIME & DEPENDENCY PREPARATION
# ==========================================

def ensure_nssm(root_dir: Path) -> str | None:
    code, _, _ = run_cmd(["nssm", "version"])
    if code == 0:
        return "nssm"

    for nssm_path in root_dir.rglob("nssm.exe"):
        if nssm_path.is_file():
            return str(nssm_path.resolve())

    return None

def ensure_node_js() -> str | None:
    code, out, _ = run_cmd(["node", "--version"])
    if code == 0:
        code_path, out_path, _ = run_cmd(["where", "node"])
        if code_path == 0 and out_path:
            return out_path.splitlines()[0].strip()
        return "node"

    common_paths = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "nodejs" / "node.exe",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "nodejs" / "node.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "node" / "node.exe"
    ]

    for p in common_paths:
        if p.is_file():
            return str(p)

    return None

def prepare_and_build_go(root_dir: Path, force_rebuild: bool = False) -> Path | None:
    go_dir = discover_go_project(root_dir)
    existing_exe = discover_backend_exe(root_dir)

    if not go_dir:
        if existing_exe:
            print_info(f"No go.mod found, using existing backend executable: {existing_exe}")
            return existing_exe
        return None

    code_go, out_go, _ = run_cmd(["go", "version"])
    if code_go != 0:
        if existing_exe:
            print_warning("Go compiler not found, but an existing executable is available.")
            return existing_exe
        print_error("Go compiler ('go') is required to build the backend but was not found.")
        return None

    print_success(f"Go project detected at: {go_dir}")
    print_info(f"Go compiler version: {out_go}")

    rebuild_needed = force_rebuild or (existing_exe is None) or is_source_newer_than_target(go_dir, existing_exe, [".go", ".mod", ".sum"])

    if not rebuild_needed and existing_exe:
        print_success("Backend artifact is up-to-date. Skipping build.")
        return existing_exe

    print_info("Preparing Go dependencies (go mod download)...")
    run_cmd(["go", "mod", "download"], cwd=go_dir, check=True)

    output_exe = go_dir / "backend.exe"
    print_info(f"Building Go backend -> {output_exe.name}...")
    code_build, stdout_b, stderr_b = run_cmd(["go", "build", "-o", str(output_exe)], cwd=go_dir)

    if code_build != 0:
        print_error("Go backend build failed!")
        print(f"STDOUT:\n{stdout_b}")
        print(f"STDERR:\n{stderr_b}")
        return None

    print_success(f"Backend build completed: {output_exe}")
    return output_exe

def get_package_manager(next_dir: Path) -> tuple[str, list[str]]:
    if (next_dir / "yarn.lock").exists():
        return "yarn", ["yarn", "install"]
    elif (next_dir / "pnpm-lock.yaml").exists():
        return "pnpm", ["pnpm", "install"]
    else:
        return "npm", ["npm", "install"]

def check_and_ensure_standalone_config(next_dir: Path):
    cfg_files = list(next_dir.glob("next.config.*"))
    if not cfg_files:
        return

    cfg_file = cfg_files[0]
    try:
        content = cfg_file.read_text(encoding="utf-8")
        if 'output:' not in content or 'standalone' not in content:
            print_warning(f"Note: '{cfg_file.name}' might missing `output: 'standalone'`. Ensure standalone build is enabled.")
    except Exception:
        pass

def prepare_and_build_nextjs(root_dir: Path, force_rebuild: bool = False) -> Path | None:
    next_dir = discover_nextjs_project(root_dir)
    existing_matches = discover_frontend_standalone(root_dir)

    if not next_dir:
        if existing_matches:
            print_info(f"Using existing Next.js standalone server: {existing_matches[0]}")
            return existing_matches[0]
        return None

    node_bin = ensure_node_js()
    if not node_bin:
        if existing_matches:
            print_warning("Node.js CLI not found in PATH, but existing standalone artifact was detected.")
            return existing_matches[0]
        print_error("Node.js runtime is required to prepare/build Next.js frontend.")
        return None

    code_npm, _, _ = run_cmd(["npm", "--version"], use_shell=True)
    if code_npm != 0:
        print_error("npm package manager was not found.")
        return None

    print_success(f"Next.js project detected at: {next_dir}")
    check_and_ensure_standalone_config(next_dir)

    target_server = next_dir / ".next" / "standalone" / "server.js"
    rebuild_needed = force_rebuild or not target_server.exists() or is_source_newer_than_target(
        next_dir, target_server, [".js", ".jsx", ".ts", ".tsx", ".json", ".css"]
    )

    if not (next_dir / "node_modules").exists():
        pm_name, pm_cmd = get_package_manager(next_dir)
        print_info(f"node_modules missing. Installing dependencies using {pm_name}...")
        code_inst, out_inst, err_inst = run_cmd(pm_cmd, cwd=next_dir, use_shell=True)
        if code_inst != 0:
            print_error("Failed to install Node.js dependencies.")
            print(f"STDOUT:\n{out_inst}")
            print(f"STDERR:\n{err_inst}")
            return None

    if not rebuild_needed and target_server.exists():
        print_success("Next.js standalone build is up-to-date. Skipping build.")
    else:
        print_info("Building Next.js production build (npm run build)...")
        code_b, out_b, err_b = run_cmd(["npm", "run", "build"], cwd=next_dir, use_shell=True)
        if code_b != 0:
            print_error("Next.js build failed!")
            print(f"STDOUT:\n{out_b}")
            print(f"STDERR:\n{err_b}")
            return None

    if not target_server.exists():
        matches = discover_frontend_standalone(next_dir)
        if matches:
            target_server = matches[0]
        else:
            print_error("Next.js build succeeded, but .next/standalone/server.js was not generated.")
            print_info("Please verify `output: 'standalone'` is set in next.config.js")
            return None

    standalone_dir = target_server.parent
    static_src = next_dir / ".next" / "static"
    public_src = next_dir / "public"

    if static_src.exists():
        static_dst = standalone_dir / ".next" / "static"
        static_dst.parent.mkdir(parents=True, exist_ok=True)
        if not static_dst.exists():
            print_info("Copying .next/static to standalone output...")
            shutil.copytree(static_src, static_dst, dirs_exist_ok=True)

    if public_src.exists():
        public_dst = standalone_dir / "public"
        if not public_dst.exists():
            print_info("Copying public folder to standalone output...")
            shutil.copytree(public_src, public_dst, dirs_exist_ok=True)

    print_success(f"Next.js standalone build verified: {target_server}")
    return target_server

# ==========================================
# 7. SERVICE MANAGEMENT & LOGGING CONFIG
# ==========================================

def get_service_status(nssm_bin: str, service_name: str) -> str:
    code, stdout, _ = run_cmd([nssm_bin, "status", service_name])
    if code == 0:
        return stdout.strip()
    return "NOT_INSTALLED"

def stop_service_safely(nssm_bin: str, service_name: str) -> bool:
    status = get_service_status(nssm_bin, service_name)
    if status == "NOT_INSTALLED":
        return True

    if status != "SERVICE_STOPPED":
        print_info(f"Stopping service '{service_name}'...")
        run_cmd([nssm_bin, "stop", service_name])
        for _ in range(15):
            time.sleep(1)
            status = get_service_status(nssm_bin, service_name)
            if status == "SERVICE_STOPPED":
                break

    return get_service_status(nssm_bin, service_name) == "SERVICE_STOPPED"

def configure_nssm_service(nssm_bin: str, service_name: str, app_path: str, app_dir: str, args: str = "", log_prefix: str = "app") -> bool:
    """Mendaftarkan atau memperbarui Windows Service menggunakan NSSM lengkap dengan Stdout/Stderr log redirect."""
    status = get_service_status(nssm_bin, service_name)

    if status == "NOT_INSTALLED":
        cmd_install = [nssm_bin, "install", service_name, app_path]
        if args:
            cmd_install.append(args)
        code, _, stderr = run_cmd(cmd_install, check=True)
        if code != 0:
            print_error(f"Gagal mendaftarkan service '{service_name}': {stderr}")
            return False
    else:
        if status == "SERVICE_RUNNING":
            print_info(f"Stopping existing service '{service_name}' for configuration update...")
            stop_service_safely(nssm_bin, service_name)

        code, _, _ = run_cmd([nssm_bin, "set", service_name, "Application", app_path], check=True)
        if code != 0: return False

        if args:
            code, _, _ = run_cmd([nssm_bin, "set", service_name, "AppParameters", args], check=True)
        else:
            code, _, _ = run_cmd([nssm_bin, "reset", service_name, "AppParameters"], check=True)
        if code != 0: return False

    code, _, _ = run_cmd([nssm_bin, "set", service_name, "AppDirectory", app_dir], check=True)
    if code != 0: return False

    code, _, _ = run_cmd([nssm_bin, "set", service_name, "Start", "SERVICE_AUTO_START"], check=True)
    if code != 0: return False

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    clean_svc = sanitize_filename(service_name)
    stdout_file = LOGS_DIR / f"{log_prefix}_{clean_svc}.log"
    stderr_file = LOGS_DIR / f"{log_prefix}_{clean_svc}_error.log"

    code_out, _, _ = run_cmd([nssm_bin, "set", service_name, "AppStdout", str(stdout_file)], check=True)
    code_err, _, _ = run_cmd([nssm_bin, "set", service_name, "AppStderr", str(stderr_file)], check=True)

    if code_out != 0 or code_err != 0:
        return False

    return True

def start_and_verify_service(nssm_bin: str, service_name: str, timeout_sec: int = 10) -> bool:
    status = get_service_status(nssm_bin, service_name)
    if status != "SERVICE_RUNNING":
        print_info(f"Starting service '{service_name}'...")
        run_cmd([nssm_bin, "start", service_name])

    start_time = time.time()
    while time.time() - start_time < timeout_sec:
        print_info("Checking service...")
        status = get_service_status(nssm_bin, service_name)
        if status == "SERVICE_RUNNING":
            time.sleep(2)
            if get_service_status(nssm_bin, service_name) == "SERVICE_RUNNING":
                return True
            else:
                print_error(f"Service '{service_name}' entered RUNNING state but stopped unexpectedly.")
                return False
        time.sleep(1)

    return get_service_status(nssm_bin, service_name) == "SERVICE_RUNNING"

# ==========================================
# 8. SERIOUS LOGGING & DIAGNOSTICS MODULE
# ==========================================

def read_env_file(root_dir: Path) -> dict:
    """Membaca konfigurasi environment dari file .env tanpa hardcode nama."""
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
                            env_vars[k.strip().upper()] = v.strip().strip('"').strip("'")
            except Exception:
                pass
    return env_vars

def read_latest_log_file(log_path: Path, max_lines: int = 30) -> str:
    """Membaca baris-baris terakhir dari file log terlepas dari ukuran log."""
    if not log_path.is_file():
        return "[Log file does not exist or has not been written to yet]"
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
            if not lines:
                return "[Log file is empty]"
            return "".join(lines[-max_lines:]).strip()
    except Exception as e:
        return f"[Failed to read log file: {e}]"

def analyze_and_mask_db_log(raw_log: str) -> str:
    """Menyembunyikan password plaintext yang berpotensi muncul pada raw log trace."""
    masked = re.sub(r'(password=)[^\s&;]+', r'\1********', raw_log, flags=re.IGNORECASE)
    masked = re.sub(r'(postgres://[^:]+:)[^@]+(@)', r'\1********\2', masked, flags=re.IGNORECASE)
    return masked

def analyze_pg_privilege_error(log_text: str) -> dict | None:
    """
    Helper khusus untuk mendeteksi error PostgreSQL privilege / GRANT.
    Mengembalikan dict berisi detail diagnosis jika terdeteksi, atau None jika bukan privilege error.
    """
    patterns = [
        r"(permission denied for (?:table|schema|sequence|database|relation|function)\s+[^\s\n\"']+|permission denied[^\n]*|must be owner of[^\n]*|insufficient privilege[^\n]*|role\s+[^\s\n]+\s+does not have permission[^\n]*|role\s+[^\s\n]+\s+is not permitted[^\n]*|no privileges were granted[^\n]*)",
        r"(pq:\s*permission denied[^\n]*)"
    ]

    detected_err = None
    for pattern in patterns:
        match = re.search(pattern, log_text, re.IGNORECASE)
        if match:
            detected_err = match.group(1).strip()
            break

    if not detected_err:
        if "permission denied" in log_text.lower() and "password" not in log_text.lower():
            for line in log_text.splitlines():
                if "permission denied" in line.lower():
                    detected_err = line.strip()
                    break

    if not detected_err:
        return None

    obj_info = ""
    specific_msg = ""

    schema_match = re.search(r"permission denied for schema\s+([^\s\n\"']+)", detected_err, re.IGNORECASE)
    table_match = re.search(r"permission denied for (?:table|relation)\s+([^\s\n\"']+)", detected_err, re.IGNORECASE)
    seq_match = re.search(r"permission denied for sequence\s+([^\s\n\"']+)", detected_err, re.IGNORECASE)
    db_match = re.search(r"permission denied for database\s+([^\s\n\"']+)", detected_err, re.IGNORECASE)
    func_match = re.search(r"permission denied for function\s+([^\s\n\"']+)", detected_err, re.IGNORECASE)

    if schema_match:
        sch = schema_match.group(1)
        obj_info = f"schema {sch}"
        specific_msg = f"PostgreSQL schema privilege error detected — check USAGE privilege on schema {sch}."
    elif table_match:
        tbl = table_match.group(1)
        obj_info = f"table {tbl}"
        specific_msg = f"PostgreSQL table privilege error detected — check table privileges for {tbl}."
    elif seq_match:
        seq = seq_match.group(1)
        obj_info = f"sequence {seq}"
        specific_msg = f"PostgreSQL sequence privilege error detected — check sequence privileges for {seq}."
    elif db_match:
        db = db_match.group(1)
        obj_info = f"database {db}"
        specific_msg = f"PostgreSQL database privilege error detected — check CONNECT privilege on database {db}."
    elif func_match:
        fn = func_match.group(1)
        obj_info = f"function {fn}"
        specific_msg = f"PostgreSQL function privilege error detected — check EXECUTE privilege on function {fn}."

    return {
        "error": detected_err,
        "object": obj_info,
        "specific_msg": specific_msg
    }

def run_database_diagnostics(root_dir: Path):
    """Diagnostik Database secara aman tanpa menjalankan query destruktif."""
    print("\n----------------------------------------")
    print("      DATABASE CONNECTION DIAGNOSTICS   ")
    print("----------------------------------------")

    env_vars = read_env_file(root_dir)
    if not env_vars:
        print_info("[1] Configuration file        ! Not found (.env)")
        return

    print_success("[1] Configuration file        ✓ Found")

    host = env_vars.get("DB_HOST", env_vars.get("POSTGRES_HOST", "127.0.0.1"))
    port_str = env_vars.get("DB_PORT", env_vars.get("POSTGRES_PORT", "5432"))
    dbname = env_vars.get("DB_NAME", env_vars.get("POSTGRES_DB", ""))
    user = env_vars.get("DB_USER", env_vars.get("POSTGRES_USER", ""))
    password = env_vars.get("DB_PASSWORD", env_vars.get("POSTGRES_PASSWORD", ""))

    try:
        port = int(port_str)
    except ValueError:
        port = 5432

    print_info(f"[2] DB_HOST                   ✓ {host}")
    print_info(f"[3] DB_PORT                   ✓ {port}")

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3)
    reachable = sock.connect_ex((host, port)) == 0
    sock.close()

    if not reachable:
        print_error("[4] Database server           ✗ Unreachable / Connection Refused")
        print("\nDATABASE CONNECTION FAILED")
        print("Possible causes:")
        print("  - PostgreSQL/Database service is stopped")
        print("  - DB_HOST or DB_PORT is incorrect")
        print("  - Firewall or network policy is blocking port")
        return
    else:
        print_success("[4] Database server           ✓ Reachable (TCP Port Open)")

    code_psql, _, _ = run_cmd(["psql", "--version"])
    if code_psql == 0 and dbname and user:
        os.environ["PGPASSWORD"] = password
        cmd_test = ["psql", "-h", host, "-p", str(port), "-U", user, "-d", dbname, "-c", "SELECT 1;"]
        code_conn, _, err_conn = run_cmd(cmd_test)
        os.environ.pop("PGPASSWORD", None)

        if code_conn == 0:
            print_success("[5] Database authentication   ✓ Verified (SELECT 1 succeeded)")
        else:
            print_error("[5] Database authentication   ✗ FAILED")
            print("\nDATABASE CONNECTION FAILED")
            err_lower = err_conn.lower()
            if "password authentication failed" in err_lower:
                print("\nLikely cause:\n  Database username/password does not match.")
            elif f'database "{dbname}" does not exist' in err_lower or "does not exist" in err_lower:
                print(f"\nLikely cause:\n  Database '{dbname}' does not exist on the database server.")
            else:
                print("\nPossible causes:")
                print("  - Invalid user permissions")
                print("  - Database configuration restriction (pg_hba.conf)")

            print("\nPlease check:")
            print(f"  - DB_USER     : {user}")
            print(f"  - DB_HOST     : {host}:{port}")
            print(f"  - DB_NAME     : {dbname}")
            print("  - DB_PASSWORD : ******** (Hidden for security)")

def run_service_error_analysis(service_name: str, log_prefix: str, root_dir: Path):
    """Membaca log aktual service dan memberikan diagnosa penyebab masalah."""
    clean_svc = sanitize_filename(service_name)
    stdout_file = LOGS_DIR / f"{log_prefix}_{clean_svc}.log"
    stderr_file = LOGS_DIR / f"{log_prefix}_{clean_svc}_error.log"

    stdout_content = analyze_and_mask_db_log(read_latest_log_file(stdout_file))
    stderr_content = analyze_and_mask_db_log(read_latest_log_file(stderr_file))

    print(f"\n--- {log_prefix.upper()} STDERR LOG [{stderr_file.name}] ---")
    print(stderr_content)
    print(f"\n--- {log_prefix.upper()} STDOUT LOG [{stdout_file.name}] ---")
    print(stdout_content)

    full_log_raw = stdout_content + "\n" + stderr_content
    full_log = full_log_raw.lower()

    print("\n--- DIAGNOSTIC ANALYSIS ---")

    priv_diag = analyze_pg_privilege_error(full_log_raw)
    if priv_diag:
        print("\n!!! POSTGRESQL PRIVILEGE / GRANT ERROR DETECTED !!!\n")
        if priv_diag["specific_msg"]:
            print(priv_diag["specific_msg"])
            print()
        print(f"Error:\n{priv_diag['error']}\n")
        if priv_diag["object"]:
            print(f"Object:\n{priv_diag['object']}\n")

        print("Likely cause:\nPostgreSQL role used by the application does not have sufficient privileges.\n")
        print("Please check PostgreSQL privileges:\n")
        print("- Database CONNECT privilege")
        print("- Schema USAGE privilege")
        print("- Table SELECT / INSERT / UPDATE / DELETE privileges")
        print("- Sequence USAGE / SELECT privileges when applicable")
        print("- Function EXECUTE privilege when applicable")
        print("- Role ownership / inherited privileges\n")
        print("Action:\nVerify the required GRANT statements for the application's PostgreSQL role.")
        return

    if any(k in full_log for k in ["eaddrinuse", "address already in use", "bind", "listen tcp"]):
        port_match = re.search(r':(\d{2,5})', full_log)
        port_num = int(port_match.group(1)) if port_match else 0
        print_error("Port conflict detected (EADDRINUSE).")
        if port_num > 0:
            in_use, pid, pname = inspect_port_owner(port_num)
            if in_use:
                print(f"  - Port        : {port_num}")
                print(f"  - Occupied By : PID {pid} ({pname})")
                print("  - Action      : The installer did not kill this process automatically. Please resolve the port conflict.")
        else:
            print("  - Action      : A process is already listening on the configured application port.")
        return

    if "cannot find module" in full_log or "module_not_found" in full_log:
        print_error("Next.js standalone build is incomplete or missing a required module.")
        print("Possible causes:")
        print("  - Standalone build was generated without copying required node_modules/static files.")
        print("  - Missing production dependency in .next/standalone folder.")
        return

    if any(k in full_log for k in ["postgres", "dial tcp", "access denied", "password authentication", "pq:"]):
        run_database_diagnostics(root_dir)
        return

    print_warning("Could not determine specific root cause automatically from rules.")
    print("Please inspect the raw log trace above for details.")

# ==========================================
# 9. SERVICE NAME & EXISTENCE HANDLING
# ==========================================

def prompt_service_name_with_existence_check(service_type: str, nssm_bin: str, default_name: str, opposite_service_name: str = "") -> str:
    """Meminta nama service dan menangani kondisi service yang sudah ada/duplicate secara aman."""
    current_name = default_name

    while True:
        if not current_name:
            prompt_msg = f"Nama service {service_type}: "
            val = input(prompt_msg).strip()
        else:
            prompt_msg = f"Nama service {service_type} [{current_name}]: "
            val = input(prompt_msg).strip()
            if not val:
                val = current_name

        if not val:
            print_error(f"Nama service {service_type} wajib diisi.")
            current_name = ""
            continue

        if opposite_service_name and val.lower() == opposite_service_name.lower():
            print_error(f"Nama service backend dan frontend tidak boleh sama ('{val}').")
            current_name = ""
            continue

        status = get_service_status(nssm_bin, val)
        if status != "NOT_INSTALLED":
            print(f"\n========================================")
            print(f"        SERVICE ALREADY EXISTS          ")
            print(f"========================================")
            print(f"{service_type.capitalize()} service '{val}' already exists in Windows.")
            print(f"Current Status: {status}")
            print("\n[R] Repair / Update existing service")
            print("[N] Use another service name")
            print("[X] Cancel deployment")

            choice = input("\nPilih option [R/N/X]: ").strip().upper()
            if choice == 'R':
                return val
            elif choice == 'N':
                current_name = ""
                continue
            else:
                print("\nDeployment dibatalkan oleh user.")
                sys.exit(0)
        else:
            return val

# ==========================================
# 10. WORKFLOWS: INSTALL NEW & UPDATE / REPAIR
# ==========================================

def run_install_new_workflow():
    print("\n========================================")
    print("           INSTALL NEW SERVICE          ")
    print("========================================")

    nssm_bin = ensure_nssm(ROOT_DIR)
    if not nssm_bin:
        print_error("NSSM executable tidak ditemukan di System PATH atau folder deployment.")
        handle_exit(False, "NSSM is required to setup services.")

    print("\n[1/6] Auto-detecting & Preparing Backend...")
    backend_exe = prepare_and_build_go(ROOT_DIR)
    if not backend_exe:
        backend_exe = discover_backend_exe(ROOT_DIR)

    if not backend_exe:
        print_error("Backend executable/source tidak dapat disiapkan.")
        handle_exit(False, "Failed to resolve backend executable.")

    print("\n[2/6] Auto-detecting & Preparing Frontend...")
    frontend_server = prepare_and_build_nextjs(ROOT_DIR)
    if not frontend_server:
        matches = discover_frontend_standalone(ROOT_DIR)
        if matches:
            frontend_server = prompt_frontend_choice(matches, ROOT_DIR)

    if not frontend_server:
        print_error("Next.js standalone build/server.js tidak dapat disiapkan.")
        handle_exit(False, "Failed to resolve Next.js standalone server.")

    print("\n[3/6] Detecting Runtimes...")
    node_bin = ensure_node_js()
    if not node_bin:
        print_error("Node.js runtime tidak ditemukan di environment PATH.")
        handle_exit(False, "Node.js is required to run Next.js standalone server.")
    print_success(f"Node.js runtime: {node_bin}")

    print("\n[4/6] Service Naming...")
    backend_svc = prompt_service_name_with_existence_check("backend", nssm_bin, "")
    frontend_svc = prompt_service_name_with_existence_check("frontend", nssm_bin, "", opposite_service_name=backend_svc)

    print("\n[5/6] Configuring Services...")
    if not configure_nssm_service(nssm_bin, backend_svc, str(backend_exe), str(backend_exe.parent), log_prefix="backend"):
        handle_exit(False, f"Failed to configure backend service '{backend_svc}'.")

    node_args = f'"{str(frontend_server)}"'
    if not configure_nssm_service(nssm_bin, frontend_svc, node_bin, str(frontend_server.parent), args=node_args, log_prefix="frontend"):
        handle_exit(False, f"Failed to configure frontend service '{frontend_svc}'.")

    print("\n[6/6] Starting & Verifying Services...")
    if not start_and_verify_service(nssm_bin, backend_svc):
        run_service_error_analysis(backend_svc, "backend", ROOT_DIR)
        handle_exit(False, f"Backend service '{backend_svc}' failed to start.")

    if not start_and_verify_service(nssm_bin, frontend_svc):
        run_service_error_analysis(frontend_svc, "frontend", ROOT_DIR)
        handle_exit(False, f"Frontend service '{frontend_svc}' failed to start.")

    backend_meta = get_file_metadata(backend_exe)
    frontend_meta = get_file_metadata(frontend_server)

    save_state({
        "backend_service_name": backend_svc,
        "frontend_service_name": frontend_svc,
        "backend_executable": str(backend_exe),
        "frontend_server": str(frontend_server),
        "backend_modified_time": backend_meta["mtime"],
        "backend_size": backend_meta["size"],
        "frontend_modified_time": frontend_meta["mtime"],
        "frontend_size": frontend_meta["size"]
    })

    handle_exit(True, f"Backend Service  ✓ {backend_svc} (RUNNING)\nFrontend Service ✓ {frontend_svc} (RUNNING)")

def run_update_repair_workflow():
    print("\n========================================")
    print("          UPDATE / REPAIR SERVICE       ")
    print("========================================")

    state = load_state()
    backend_svc = state.get("backend_service_name")
    frontend_svc = state.get("frontend_service_name")

    if not backend_svc or not frontend_svc:
        print_error("No previous installation state found (installer_state.json missing).")
        print_info("Please use Install New first.")
        handle_exit(False, "Missing installation state.")

    nssm_bin = ensure_nssm(ROOT_DIR)
    if not nssm_bin:
        print_error("NSSM executable tidak ditemukan.")
        handle_exit(False, "NSSM is required.")

    print_info(f"Loaded backend service  : {backend_svc}")
    print_info(f"Loaded frontend service : {frontend_svc}")

    b_status = get_service_status(nssm_bin, backend_svc)
    f_status = get_service_status(nssm_bin, frontend_svc)

    if b_status == "NOT_INSTALLED" or f_status == "NOT_INSTALLED":
        print_error("One or both services are not installed in Windows Service Manager.")
        handle_exit(False, "Target services do not exist for update.")

    print("\nStopping services before file replacement...")
    if not stop_service_safely(nssm_bin, backend_svc):
        print_error(f"Failed to stop backend service '{backend_svc}'.")
        handle_exit(False, "Cannot stop backend service.")

    if not stop_service_safely(nssm_bin, frontend_svc):
        print_error(f"Failed to stop frontend service '{frontend_svc}'.")
        handle_exit(False, "Cannot stop frontend service.")

    print("\n========================================")
    print("     SERVICES STOPPED SUCCESSFULLY      ")
    print("========================================")
    print(f"Backend service  : {backend_svc}")
    print(f"Frontend service : {frontend_svc}")
    print("\nThe services are now stopped.")
    print("You can now replace the old project/deployment folder with the newer version.")
    print("Please move/copy the newer project files into the installer directory.")
    input("\nPress ENTER after you have finished replacing the files...")

    while True:
        print("\nScanning for newer deployment files...")
        backend_exe = discover_backend_exe(ROOT_DIR)
        frontend_matches = discover_frontend_standalone(ROOT_DIR)
        frontend_server = frontend_matches[0] if frontend_matches else None

        b_meta = get_file_metadata(backend_exe) if backend_exe else {"mtime": 0, "size": 0}
        f_meta = get_file_metadata(frontend_server) if frontend_server else {"mtime": 0, "size": 0}

        old_b_mtime = state.get("backend_modified_time", 0)
        old_b_size = state.get("backend_size", 0)
        old_f_mtime = state.get("frontend_modified_time", 0)
        old_f_size = state.get("frontend_size", 0)

        newer_b = (b_meta["mtime"] > old_b_mtime) or (b_meta["size"] != old_b_size)
        newer_f = (f_meta["mtime"] > old_f_mtime) or (f_meta["size"] != old_f_size)

        go_dir = discover_go_project(ROOT_DIR)
        next_dir = discover_nextjs_project(ROOT_DIR)

        if not newer_b and not newer_f:
            print("\n========================================")
            print("        NO NEWER FILES DETECTED         ")
            print("========================================")
            print("The deployment files appear unchanged.")
            print("Please replace the old project with the newer version before continuing.")
            print("\n[R] Rescan")
            print("[X] Cancel")
            ch = input("\nPilih option [R/X]: ").strip().upper()
            if ch == 'R':
                continue
            else:
                print("\nUpdate cancelled by user.")
                print("[R] Restart existing services")
                print("[X] Exit with services stopped")
                exit_ch = input("\nPilih option [R/X]: ").strip().upper()
                if exit_ch == 'R':
                    start_and_verify_service(nssm_bin, backend_svc)
                    start_and_verify_service(nssm_bin, frontend_svc)
                sys.exit(0)
        else:
            print("\n========================================")
            print("        NEWER DEPLOYMENT DETECTED       ")
            print("========================================")
            print(f"Backend : {'✓ Newer files detected' if newer_b else '- Unchanged'}")
            print(f"Frontend: {'✓ Newer files detected' if newer_f else '- Unchanged'}")
            print("\nContinue with Update / Repair?")
            print("[U] Continue")
            print("[X] Cancel")
            ch = input("\nPilih option [U/X]: ").strip().upper()
            if ch == 'U':
                break
            else:
                print("\nUpdate cancelled by user.")
                print("[R] Restart existing services")
                print("[X] Exit with services stopped")
                exit_ch = input("\nPilih option [R/X]: ").strip().upper()
                if exit_ch == 'R':
                    start_and_verify_service(nssm_bin, backend_svc)
                    start_and_verify_service(nssm_bin, frontend_svc)
                sys.exit(0)

    print("\nPreparing & Building updated backend if needed...")
    updated_backend_exe = prepare_and_build_go(ROOT_DIR)
    if not updated_backend_exe:
        updated_backend_exe = discover_backend_exe(ROOT_DIR)

    if not updated_backend_exe:
        print_error("Backend executable/source missing after update.")
        handle_exit(False, "Backend resolution failed.")

    print("\nPreparing & Building updated frontend if needed...")
    updated_frontend_server = prepare_and_build_nextjs(ROOT_DIR)
    if not updated_frontend_server:
        matches = discover_frontend_standalone(ROOT_DIR)
        if matches:
            updated_frontend_server = prompt_frontend_choice(matches, ROOT_DIR)

    if not updated_frontend_server:
        print_error("Next.js standalone build/server.js missing after update.")
        handle_exit(False, "Frontend resolution failed.")

    node_bin = ensure_node_js()
    if not node_bin:
        handle_exit(False, "Node.js runtime required.")

    print("\nUpdating NSSM service configurations...")
    if not configure_nssm_service(nssm_bin, backend_svc, str(updated_backend_exe), str(updated_backend_exe.parent), log_prefix="backend"):
        handle_exit(False, "Failed to update backend service configuration.")

    node_args = f'"{str(updated_frontend_server)}"'
    if not configure_nssm_service(nssm_bin, frontend_svc, node_bin, str(updated_frontend_server.parent), args=node_args, log_prefix="frontend"):
        handle_exit(False, "Failed to update frontend service configuration.")

    print("\nRestarting & Verifying services...")
    if not start_and_verify_service(nssm_bin, backend_svc):
        run_service_error_analysis(backend_svc, "backend", ROOT_DIR)
        handle_exit(False, f"Backend service '{backend_svc}' failed to start after update.")

    if not start_and_verify_service(nssm_bin, frontend_svc):
        run_service_error_analysis(frontend_svc, "frontend", ROOT_DIR)
        handle_exit(False, f"Frontend service '{frontend_svc}' failed to start after update.")

    backend_meta = get_file_metadata(updated_backend_exe)
    frontend_meta = get_file_metadata(updated_frontend_server)

    save_state({
        "backend_service_name": backend_svc,
        "frontend_service_name": frontend_svc,
        "backend_executable": str(updated_backend_exe),
        "frontend_server": str(updated_frontend_server),
        "backend_modified_time": backend_meta["mtime"],
        "backend_size": backend_meta["size"],
        "frontend_modified_time": frontend_meta["mtime"],
        "frontend_size": frontend_meta["size"]
    })

    handle_exit(True, f"Backend Service  ✓ {backend_svc} (RUNNING)\nFrontend Service ✓ {frontend_svc} (RUNNING)")

# ==========================================
# 11. CLI INTERFACE
# ==========================================

def main():
    run_elevated()

    os.system("cls" if os.name == "nt" else "clear")
    print("========================================")
    print("     GENERIC APPLICATION INSTALLER      ")
    print("========================================")
    print(f"Root Directory: {ROOT_DIR}\n")

    print("Choose operation mode:")
    print("[I] Install New Service")
    print("[U] Update / Repair Existing Service")
    print("[X] Exit")

    choice = input("\nPilih option [I/U/X]: ").strip().upper()

    if choice == 'I':
        run_install_new_workflow()
    elif choice == 'U':
        run_update_repair_workflow()
    else:
        print("\nInstaller exited.")
        sys.exit(0)

if __name__ == "__main__":
    main()
