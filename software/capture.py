import os
import sys
import time
import json
import hashlib
import datetime

try:
    import pywinauto
    from pywinauto import Desktop, Application
    from pywinauto.controls.uiawrapper import UIAWrapper
except ImportError:
    print("[ERROR] 'pywinauto' library is not installed.")
    print("Please install it using: pip install pywinauto")
    sys.exit(1)


# File log tunggal dalam format JSON
JSON_LOG_FILE = "capture.json"

# Konfigurasi pencarian window 3WS
TARGET_PROCESS_NAMES = ["3ws.exe", "3ws.net.exe"]
TARGET_WINDOW_TITLE_KEYWORDS = ["Penimbangan FG", "3WS"]

# Interval polling (detik)
SEARCH_INTERVAL = 1.0
MONITOR_INTERVAL = 1.0


def safe_get_process_name(pid: int) -> str:
    """ PATCH 1: Menggunakan process_module bukannya process_from_module """
    if not pid:
        return "unknown"
    try:
        mod = pywinauto.application.process_module(pid)
        return os.path.basename(mod).lower() if mod else "unknown"
    except Exception:
        return "unknown"


def find_target_window():
    """
    PATCH 3 & 5: Prioritaskan Title "Penimbangan FG", cetak kandidat diagnostic,
    dan sediakan fallback ke Win32 Desktop jika UIA Desktop miss.
    """
    # Tahap A: UIA Discovery
    try:
        desktop_uia = Desktop(backend="uia")
        windows_uia = desktop_uia.windows()
        for win in windows_uia:
            try:
                info = win.element_info
                win_title = info.name or ""
                pid = info.process_id or 0
                proc_name_str = safe_get_process_name(pid)

                # PATCH 4: Print kandidat window saat diagnostic scan
                if win_title.strip():
                    print(
                        f"[WINDOW SCAN] title={win_title!r} "
                        f"pid={pid} "
                        f"hwnd={hex(win.handle) if win.handle else '0x0'} "
                        f"process={proc_name_str!r}"
                    )

                title_match = any(kw.lower() in win_title.lower() for kw in TARGET_WINDOW_TITLE_KEYWORDS)
                proc_match = any(p.lower() in proc_name_str for p in TARGET_PROCESS_NAMES)

                # Prioritas utama: Title mengandung keyword (Penimbangan FG)
                if title_match or proc_match:
                    return win, {
                        "title": win_title,
                        "process_name": proc_name_str,
                        "pid": pid,
                        "hwnd": hex(win.handle) if win.handle else "0x0"
                    }
            except Exception as e:
                # PATCH 2: Jangan telan exception saat scan
                print(f"[WINDOW SCAN ERROR] {e}")
                continue
    except Exception as e:
        print(f"[UIA ENUM ERROR] {e}")

    # Tahap B: Win32 Fallback Discovery jika UIA tidak menemukan window
    try:
        desktop_win32 = Desktop(backend="win32")
        windows_win32 = desktop_win32.windows()
        for win in windows_win32:
            try:
                win_title = win.window_text() or ""
                hwnd = win.handle
                pid = win.process_id()
                proc_name_str = safe_get_process_name(pid)

                title_match = any(kw.lower() in win_title.lower() for kw in TARGET_WINDOW_TITLE_KEYWORDS)
                proc_match = any(p.lower() in proc_name_str for p in TARGET_PROCESS_NAMES)

                if title_match or proc_match:
                    print(f"[FALLBACK WIN32 FOUND] HWND: {hex(hwnd)}, Title: {win_title!r}")
                    # Attach UIA ke HWND yang ditemukan
                    app = Application(backend="uia").connect(handle=hwnd)
                    uia_win = app.window(handle=hwnd)
                    return uia_win, {
                        "title": win_title,
                        "process_name": proc_name_str,
                        "pid": pid,
                        "hwnd": hex(hwnd)
                    }
            except Exception as e:
                print(f"[WIN32 SCAN ERROR] {e}")
                continue
    except Exception as e:
        print(f"[WIN32 ENUM ERROR] {e}")

    return None, None


def get_element_properties(element: UIAWrapper, depth: int) -> dict:
    props = {
        "depth": depth,
        "control_type": "",
        "name": "",
        "automation_id": "",
        "class_name": "",
        "framework_id": "",
        "value": "",
        "legacy_value": "",
        "is_enabled": None,
        "is_offscreen": None,
        "rectangle": None
    }

    try:
        props["control_type"] = str(element.element_info.control_type or "")
    except Exception:
        pass

    try:
        props["name"] = str(element.element_info.name or "").strip()
    except Exception:
        pass

    try:
        props["automation_id"] = str(element.element_info.automation_id or "").strip()
    except Exception:
        pass

    try:
        props["class_name"] = str(element.element_info.class_name or "").strip()
    except Exception:
        pass

    try:
        props["framework_id"] = str(element.element_info.framework_id or "").strip()
    except Exception:
        pass

    try:
        props["is_enabled"] = bool(element.is_enabled())
    except Exception:
        pass

    try:
        props["is_offscreen"] = bool(element.is_offscreen())
    except Exception:
        pass

    try:
        rect = element.rectangle()
        if rect:
            props["rectangle"] = {
                "left": rect.left,
                "top": rect.top,
                "right": rect.right,
                "bottom": rect.bottom
            }
    except Exception:
        pass

    try:
        if hasattr(element, "iface_value") and element.iface_value:
            props["value"] = str(element.iface_value.CurrentValue or "").strip()
    except Exception:
        pass

    if not props["value"]:
        try:
            texts = element.texts()
            if texts:
                filtered = [t.strip() for t in texts if t and t.strip()]
                if filtered:
                    props["value"] = " | ".join(filtered)
        except Exception:
            pass

    try:
        if hasattr(element, "iface_legacy_iaccessible") and element.iface_legacy_iaccessible:
            props["legacy_value"] = str(element.iface_legacy_iaccessible.CurrentValue or "").strip()
    except Exception:
        pass

    return props


def traverse_tree(element: UIAWrapper, depth: int = 0, elements_list: list = None) -> list:
    if elements_list is None:
        elements_list = []

    try:
        props = get_element_properties(element, depth)
        elements_list.append(props)

        children = element.children()
        for child in children:
            traverse_tree(child, depth + 1, elements_list)
    except Exception:
        pass

    return elements_list


def run_win32_fallback_inspection(hwnd_str: str):
    """ PATCH 9: Win32 text inspection fallback untuk membandingkan jika UIA kosong """
    try:
        hwnd = int(hwnd_str, 16)
        app = Application(backend="win32").connect(handle=hwnd)
        win = app.window(handle=hwnd)
        children = win.children()

        text_controls = 0
        texts_found = []
        for child in children:
            t = child.window_text().strip()
            if t:
                text_controls += 1
                texts_found.append(t)

        print("\n[WIN32 FALLBACK DIAGNOSTIC]")
        print(f"  Child Windows           : {len(children)}")
        print(f"  Text-bearing controls   : {text_controls}")
        if texts_found:
            print("  Win32 Texts Found:")
            for txt in texts_found[:20]:
                print(f"    - {txt}")
        print("-" * 50)
    except Exception as e:
        print(f"[WIN32 FALLBACK ERROR] {e}")


def compute_elements_hash(elements: list) -> str:
    hash_data = []
    for el in elements:
        hash_data.append((
            el.get("control_type"),
            el.get("name"),
            el.get("automation_id"),
            el.get("value"),
            el.get("legacy_value")
        ))
    raw_str = json.dumps(hash_data, sort_keys=True)
    return hashlib.md5(raw_str.encode("utf-8")).hexdigest()


def load_or_init_json_log() -> dict:
    if os.path.exists(JSON_LOG_FILE):
        try:
            with open(JSON_LOG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and "captures" in data:
                    return data
        except Exception:
            pass

    return {
        "tool": "capture.py",
        "target": {},
        "captures": []
    }


def save_json_log(data: dict):
    temp_file = JSON_LOG_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(temp_file, JSON_LOG_FILE)


def print_stats_and_summary(elements: list):
    total = len(elements)
    with_name = sum(1 for e in elements if e["name"])
    with_val = sum(1 for e in elements if e["value"])
    with_leg_val = sum(1 for e in elements if e["legacy_value"])
    with_auto_id = sum(1 for e in elements if e["automation_id"])

    text_list = []
    for e in elements:
        for val_key in ["name", "value", "legacy_value"]:
            txt = e.get(val_key)
            if txt and txt not in text_list:
                text_list.append(txt)

    print("\n[STATS]")
    print(f"  Total Elements        : {total}")
    print(f"  With Name             : {with_name}")
    print(f"  With Value            : {with_val}")
    print(f"  With Legacy Value     : {with_leg_val}")
    print(f"  With AutomationId     : {with_auto_id}")
    print(f"  Text-bearing Controls : {len(text_list)}")

    print("\n[UI TEXT EXTRACTED]")
    print("-" * 50)
    if text_list:
        for t in text_list[:40]:
            print(f"  - {t}")
        if len(text_list) > 40:
            print(f"  ... (+ {len(text_list) - 40} items lainnya)")
    else:
        print("  (Tidak ada teks ditemukan pada Automation Tree)")
    print("-" * 50 + "\n")


def main():
    print("=" * 60)
    print(" 3WS UI AUTOMATION CAPTURE DIAGNOSTIC TOOL")
    print("=" * 60)

    log_data = load_or_init_json_log()
    last_hash = None
    target_win = None
    target_info = None

    try:
        while True:
            # PATCH 7: TAHAP [1] WINDOW DISCOVERY
            if target_win is None:
                print(f"\n[1] WINDOW DISCOVERY")
                print(f"[WAITING] Searching for 3WS / Penimbangan FG window...")
                win, info = find_target_window()

                # PATCH 6: Validasi HWND & Print info saat ketemu
                if win is not None:
                    target_win = win
                    target_info = info
                    log_data["target"] = target_info
                    save_json_log(log_data)

                    print("\n[FOUND]")
                    print(f"Title   : {target_info['title']}")
                    print(f"PID     : {target_info['pid']}")
                    print(f"HWND    : {target_info['hwnd']}")
                    print(f"Process : {target_info['process_name']}")
                    print("=" * 60)
                else:
                    time.sleep(SEARCH_INTERVAL)
                    continue

            # PATCH 7: TAHAP [2] UI AUTOMATION ATTACH & [3] UI TREE EXTRACTION
            try:
                print("\n[2] UI AUTOMATION ATTACH")
                # Test response root window
                _ = target_win.element_info.name
                print("[SUCCESS] UIA root attached")

                print("\n[3] UI TREE EXTRACTION")
                elements = traverse_tree(target_win)
                current_hash = compute_elements_hash(elements)

                if current_hash != last_hash:
                    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                    print(f"[CAPTURE] UI tree changed ({timestamp})")
                    print(f"[CAPTURE] Elements found: {len(elements)}")

                    snapshot = {
                        "timestamp": timestamp,
                        "window": target_info,
                        "elements": elements
                    }

                    log_data["captures"].append(snapshot)
                    save_json_log(log_data)
                    print(f"[CAPTURE] Snapshot saved to {JSON_LOG_FILE}")

                    print_stats_and_summary(elements)

                    # PATCH 9: Jika UIA hanya menemukan <= 1 elemen, picu Win32 fallback diagnostic
                    if len(elements) <= 1:
                        print("[WARNING] UIA tree return empty/root-only child elements.")
                        run_win32_fallback_inspection(target_info["hwnd"])

                    last_hash = current_hash

            except Exception as e:
                print(f"[WARN] Target window lost or unreachable ({e}). Resetting search...")
                target_win = None
                target_info = None
                last_hash = None

            time.sleep(MONITOR_INTERVAL)

    except KeyboardInterrupt:
        print("\n[STOP] Capture stopped.")
        save_json_log(log_data)
        sys.exit(0)


if __name__ == "__main__":
    main()