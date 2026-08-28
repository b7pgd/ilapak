import os
import sys
import time
import json
import datetime
from typing import Optional, Dict, Any, Tuple

try:
    import pywinauto
    from pywinauto import Desktop, Application
    from pywinauto.controls.uiawrapper import UIAWrapper
except ImportError:
    print("[ERROR] 'pywinauto' library is not installed.")
    print("Please install it using: pip install pywinauto")
    sys.exit(1)


# ============================================================
# CONFIGURATION
# ============================================================

JSON_LOG_FILE = "capture.json"

TARGET_PROCESS_NAMES = {
    "3ws.exe",
    "3ws.net.exe",
}

TARGET_WINDOW_TITLE = "Penimbangan FG"

SEARCH_INTERVAL = 1.0
MONITOR_INTERVAL = 1.0


# ============================================================
# GENERAL HELPERS
# ============================================================

def now_string() -> str:
    return datetime.datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S.%f"
    )[:-3]


def safe_get_process_name(pid: int) -> str:
    if not pid:
        return "unknown"

    try:
        module = pywinauto.application.process_module(pid)
        if module:
            return os.path.basename(module).lower()
    except Exception:
        pass

    return "unknown"


def normalize_text(value: Any) -> str:
    if value is None:
        return ""

    return str(value).replace("\xa0", " ").strip()


# ============================================================
# WINDOW DISCOVERY
# ============================================================

def find_target_window() -> Tuple[Optional[UIAWrapper], Optional[dict]]:
    """
    Selalu melakukan discovery ulang terhadap instance 3WS yang sedang aktif.

    Tidak menggunakan PID/HWND/Automation ID yang disimpan sebelumnya
    sebagai identitas permanen.
    """

    # --------------------------------------------------------
    # UIA discovery
    # --------------------------------------------------------

    try:
        desktop = Desktop(backend="uia")

        for window in desktop.windows():
            try:
                info = window.element_info

                title = normalize_text(info.name)
                pid = info.process_id or 0
                process_name = safe_get_process_name(pid)

                title_match = (
                    TARGET_WINDOW_TITLE.lower() in title.lower()
                )

                process_match = (
                    process_name in TARGET_PROCESS_NAMES
                )

                if title_match and process_match:
                    return window, {
                        "title": title,
                        "process_name": process_name,
                        "pid": pid,
                        "hwnd": hex(window.handle) if window.handle else "0x0",
                        "attached_at": now_string(),
                    }

            except Exception:
                continue

    except Exception:
        pass

    # --------------------------------------------------------
    # Win32 fallback
    # --------------------------------------------------------

    try:
        desktop = Desktop(backend="win32")

        for window in desktop.windows():
            try:
                title = normalize_text(window.window_text())
                hwnd = window.handle
                pid = window.process_id()
                process_name = safe_get_process_name(pid)

                title_match = (
                    TARGET_WINDOW_TITLE.lower() in title.lower()
                )

                process_match = (
                    process_name in TARGET_PROCESS_NAMES
                )

                if title_match and process_match:
                    app = Application(backend="uia").connect(
                        handle=hwnd
                    )

                    uia_window = app.window(handle=hwnd)

                    return uia_window, {
                        "title": title,
                        "process_name": process_name,
                        "pid": pid,
                        "hwnd": hex(hwnd),
                        "attached_at": now_string(),
                    }

            except Exception:
                continue

    except Exception:
        pass

    return None, None


# ============================================================
# UI VALUE READING
# ============================================================

def get_element_value(element: UIAWrapper) -> str:
    """
    Membaca value tanpa bergantung pada Automation ID.
    """

    # UIA ValuePattern
    try:
        iface = getattr(element, "iface_value", None)

        if iface:
            value = normalize_text(iface.CurrentValue)

            if value:
                return value

    except Exception:
        pass

    # texts()
    try:
        texts = element.texts()

        if texts:
            values = [
                normalize_text(text)
                for text in texts
                if normalize_text(text)
            ]

            if values:
                return " | ".join(values)

    except Exception:
        pass

    # Legacy IAccessible
    try:
        iface = getattr(
            element,
            "iface_legacy_iaccessible",
            None
        )

        if iface:
            value = normalize_text(iface.CurrentValue)

            if value:
                return value

    except Exception:
        pass

    return ""


# ============================================================
# UI TREE COLLECTION
# ============================================================

def collect_controls(
    root: UIAWrapper,
    controls: Optional[list] = None,
    depth: int = 0,
    max_depth: int = 12
) -> list:

    if controls is None:
        controls = []

    if depth > max_depth:
        return controls

    try:
        info = root.element_info

        name = normalize_text(info.name)
        control_type = normalize_text(info.control_type).lower()
        class_name = normalize_text(info.class_name)
        automation_id = normalize_text(info.automation_id)
        framework_id = normalize_text(info.framework_id)

        value = ""

        if control_type in {
            "edit",
            "document",
            "text",
            "button",
            "combo box",
            "list item",
        }:
            value = get_element_value(root)

        ancestor_text = []

        try:
            parent = root.parent()

            for _ in range(4):
                if parent is None:
                    break

                parent_name = normalize_text(
                    parent.element_info.name
                )

                if parent_name:
                    ancestor_text.append(parent_name)

                parent = parent.parent()

        except Exception:
            pass

        controls.append({
            "element": root,
            "name": name,
            "value": value,
            "control_type": control_type,
            "class_name": class_name,
            "automation_id": automation_id,
            "framework_id": framework_id,
            "depth": depth,
            "ancestor_text": " | ".join(ancestor_text),
        })

        try:
            children = root.children()

            for child in children:
                collect_controls(
                    child,
                    controls,
                    depth + 1,
                    max_depth
                )

        except Exception:
            pass

    except Exception:
        pass

    return controls


# ============================================================
# SEMANTIC MATCHING
# ============================================================

def combined_context(control: dict) -> str:
    return (
        f"{control['name']} "
        f"{control['value']} "
        f"{control['ancestor_text']}"
    ).lower()


def score_work_order(control: dict) -> int:
    name = control["name"].lower()
    value = control["value"]
    context = combined_context(control)

    if control["control_type"] != "edit":
        return -1

    if not value:
        return -1

    score = 0

    if "work order" in name:
        score += 180

    if "work-order" in context:
        score += 140

    if "work order" in context:
        score += 100

    if "material" in name:
        score += 120

    if "informasi work order" in context:
        score += 80

    if any(char.isdigit() for char in value):
        score += 20

    if any(char.isalpha() for char in value):
        score += 20

    if any(char in value for char in "-/"):
        score += 15

    return score


def score_formula(control: dict) -> int:
    name = control["name"].lower()
    context = combined_context(control)
    value = control["value"]

    if control["control_type"] != "edit":
        return -1

    if not value:
        return -1

    score = 0

    if "formula" in name:
        score += 160

    if "formula" in context:
        score += 100

    if "informasi work order" in context:
        score += 40

    if any(char.isalpha() for char in value):
        score += 20

    return score


def score_batch(control: dict) -> int:
    name = control["name"].lower()
    context = combined_context(control)
    value = control["value"]

    if control["control_type"] != "edit":
        return -1

    if not value:
        return -1

    score = 0

    if "nomor batch" in name:
        score += 180

    if "batch" in name:
        score += 150

    if "nomor batch" in context:
        score += 120

    if "batch" in context:
        score += 80

    if "informasi work order" in context:
        score += 40

    if any(char.isalpha() for char in value):
        score += 20

    if any(char.isdigit() for char in value):
        score += 20

    return score


def select_best(
    controls: list,
    scorer
) -> Optional[dict]:

    candidates = []

    for control in controls:
        score = scorer(control)

        if score > 0:
            candidates.append(
                (score, control)
            )

    if not candidates:
        return None

    candidates.sort(
        key=lambda item: item[0],
        reverse=True
    )

    return candidates[0][1]


# ============================================================
# BUTTON DISCOVERY
# ============================================================

def find_button(
    controls: list,
    keywords: list
) -> dict:

    best = None
    best_score = 0

    for control in controls:

        if control["control_type"] != "button":
            continue

        name = control["name"].lower()
        value = control["value"].lower()

        score = 0

        for keyword in keywords:
            keyword = keyword.lower()

            if keyword in name:
                score += 100

            if keyword in value:
                score += 80

        if score > best_score:
            best_score = score
            best = control

    if best is None:
        return {
            "exists": False,
            "enabled": False,
        }

    enabled = False

    try:
        enabled = bool(
            best["element"].is_enabled()
        )
    except Exception:
        pass

    return {
        "exists": True,
        "enabled": enabled,
    }


# ============================================================
# FIELD EXTRACTION
# ============================================================

def extract_target_state(root: UIAWrapper) -> dict:

    controls = collect_controls(root)

    work_order_control = select_best(
        controls,
        score_work_order
    )

    formula_control = select_best(
        controls,
        score_formula
    )

    batch_control = select_best(
        controls,
        score_batch
    )

    work_order = (
        work_order_control["value"]
        if work_order_control
        else ""
    )

    formula = (
        formula_control["value"]
        if formula_control
        else ""
    )

    batch = (
        batch_control["value"]
        if batch_control
        else ""
    )

    incomplete_mb = find_button(
        controls,
        ["incomplete mb"]
    )

    last_mb = find_button(
        controls,
        [
            "master box terakhir",
            "last mb",
        ]
    )

    return {
        "work_order": work_order,
        "formula": formula,
        "batch": batch,
        "incomplete_mb": incomplete_mb,
        "last_mb": last_mb,
    }


# ============================================================
# JSON LOG
# ============================================================

def load_or_init_json_log() -> dict:

    if os.path.exists(JSON_LOG_FILE):

        try:
            with open(
                JSON_LOG_FILE,
                "r",
                encoding="utf-8"
            ) as file:

                data = json.load(file)

                if (
                    isinstance(data, dict)
                    and "captures" in data
                ):
                    return data

        except Exception:
            pass

    return {
        "tool": "capture.py",
        "target": {},
        "captures": [],
    }


def save_json_log(data: dict):

    temp_file = JSON_LOG_FILE + ".tmp"

    with open(
        temp_file,
        "w",
        encoding="utf-8"
    ) as file:

        json.dump(
            data,
            file,
            indent=2,
            ensure_ascii=False
        )

    os.replace(
        temp_file,
        JSON_LOG_FILE
    )


# ============================================================
# EVENT CREATION
# ============================================================

def create_capture_event(
    event_type: str,
    state: dict
) -> dict:

    return {
        "timestamp": now_string(),
        "event": event_type,
        "work_order": state["work_order"],
        "formula": state["formula"],
        "batch": state["batch"],
        "incomplete_mb": state["incomplete_mb"],
        "last_mb": state["last_mb"],
    }


# ============================================================
# MAIN
# ============================================================

def main():

    log_data = load_or_init_json_log()

    target_win = None
    target_info = None
    last_state = None

    try:

        while True:

            # ------------------------------------------------
            # DISCOVERY
            # ------------------------------------------------

            if target_win is None:

                target_win, target_info = (
                    find_target_window()
                )

                if target_win is None:
                    time.sleep(
                        SEARCH_INTERVAL
                    )
                    continue

                log_data["target"] = target_info

                save_json_log(log_data)

                # Instance baru harus dianggap state baru.
                last_state = None

            # ------------------------------------------------
            # MONITOR
            # ------------------------------------------------

            try:

                # Pastikan element masih hidup.
                _ = target_win.element_info.name

                current_state = (
                    extract_target_state(
                        target_win
                    )
                )

                has_valid_data = bool(
                    current_state["work_order"]
                    and (
                        current_state["formula"]
                        or current_state["batch"]
                    )
                )

                # ------------------------------------------------
                # FIRST VALID STATE
                # ------------------------------------------------

                if last_state is None:

                    if has_valid_data:

                        event = create_capture_event(
                            "activity_detected",
                            current_state
                        )

                        log_data["captures"].append(
                            event
                        )

                        save_json_log(
                            log_data
                        )

                        last_state = current_state

                # ------------------------------------------------
                # STATE CHANGED
                # ------------------------------------------------

                elif current_state != last_state:

                    event = create_capture_event(
                        "data_changed",
                        current_state
                    )

                    log_data["captures"].append(
                        event
                    )

                    save_json_log(
                        log_data
                    )

                    last_state = current_state

            except Exception:

                # Instance 3WS sudah mati / berubah.
                # Buang seluruh reference lama dan
                # lakukan discovery ulang.

                target_win = None
                target_info = None
                last_state = None

            time.sleep(
                MONITOR_INTERVAL
            )

    except KeyboardInterrupt:

        save_json_log(log_data)

        sys.exit(0)


if __name__ == "__main__":
    main()
