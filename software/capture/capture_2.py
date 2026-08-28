import os
import sys
import time
import json
import datetime
from queue import Queue, Empty
from typing import Optional, Any, Tuple

try:
    import pywinauto
    from pywinauto import Desktop, Application
    from pywinauto.controls.uiawrapper import UIAWrapper
except ImportError:
    print("[ERROR] pywinauto belum terinstall.")
    print("Install: pip install pywinauto")
    sys.exit(1)

try:
    from pynput import mouse
except ImportError:
    print("[ERROR] pynput belum terinstall.")
    print("Install: pip install pynput")
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
MONITOR_INTERVAL = 0.5
MAX_TREE_DEPTH = 12


# ============================================================
# START / END SEMANTIC KEYWORDS
# ============================================================

START_KEYWORDS = (
    "nomor mesin",
    "mesin",
    "packer",
    "pengepakan",
    "pengepak",
    "timbangan",
    "penimbang",
)

END_KEYWORDS = (
    "incomplete mb",
    "master box terakhir",
    "last mb",
)


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

    return (
        str(value)
        .replace("\xa0", " ")
        .strip()
    )


def is_target_process(process_name: str) -> bool:
    return process_name.lower() in TARGET_PROCESS_NAMES


# ============================================================
# EMPTY STATE
# ============================================================

def empty_state() -> dict:
    return {
        "work_order": "",
        "product_code": "",
        "formula": "",
        "batch": "",
        "machine": "",
        "packer": "",
        "scale": "",
        "incomplete_mb": {
            "exists": False,
            "enabled": False,
        },
        "last_mb": {
            "exists": False,
            "enabled": False,
        },
    }


# ============================================================
# WINDOW DISCOVERY
# ============================================================

def find_target_window() -> Tuple[
    Optional[UIAWrapper],
    Optional[dict]
]:

    # --------------------------------------------------------
    # UIA
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
                    TARGET_WINDOW_TITLE.lower()
                    in title.lower()
                )

                process_match = is_target_process(
                    process_name
                )

                if title_match and process_match:

                    return window, {
                        "title": title,
                        "process_name": process_name,
                        "pid": pid,
                        "hwnd": (
                            hex(window.handle)
                            if window.handle
                            else "0x0"
                        ),
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
                title = normalize_text(
                    window.window_text()
                )

                hwnd = window.handle
                pid = window.process_id()

                process_name = safe_get_process_name(pid)

                title_match = (
                    TARGET_WINDOW_TITLE.lower()
                    in title.lower()
                )

                process_match = is_target_process(
                    process_name
                )

                if not (
                    title_match
                    and process_match
                ):
                    continue

                app = Application(
                    backend="uia"
                ).connect(handle=hwnd)

                uia_window = app.window(
                    handle=hwnd
                )

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
# UI VALUE
# ============================================================

def get_element_value(
    element: UIAWrapper
) -> str:

    # --------------------------------------------------------
    # UIA ValuePattern
    # --------------------------------------------------------

    try:
        iface = getattr(
            element,
            "iface_value",
            None
        )

        if iface:
            value = normalize_text(
                iface.CurrentValue
            )

            if value:
                return value

    except Exception:
        pass

    # --------------------------------------------------------
    # texts()
    # --------------------------------------------------------

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

    # --------------------------------------------------------
    # Legacy IAccessible
    # --------------------------------------------------------

    try:
        iface = getattr(
            element,
            "iface_legacy_iaccessible",
            None
        )

        if iface:
            value = normalize_text(
                iface.CurrentValue
            )

            if value:
                return value

    except Exception:
        pass

    return ""


# ============================================================
# CONTROL COLLECTION
# ============================================================

def collect_controls(
    root: UIAWrapper,
    controls: Optional[list] = None,
    depth: int = 0
) -> list:

    if controls is None:
        controls = []

    if depth > MAX_TREE_DEPTH:
        return controls

    try:

        info = root.element_info

        name = normalize_text(
            info.name
        )

        control_type = normalize_text(
            info.control_type
        ).lower()

        class_name = normalize_text(
            info.class_name
        )

        automation_id = normalize_text(
            info.automation_id
        )

        framework_id = normalize_text(
            info.framework_id
        )

        value = ""

        if control_type in {
            "edit",
            "document",
            "text",
            "button",
            "combo box",
            "list item",
        }:

            value = get_element_value(
                root
            )

        ancestor_text = []

        try:

            parent = root.parent()

            for _ in range(5):

                if parent is None:
                    break

                parent_name = normalize_text(
                    parent.element_info.name
                )

                if parent_name:
                    ancestor_text.append(
                        parent_name
                    )

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
            "ancestor_text": (
                " | ".join(ancestor_text)
            ),
        })

        try:

            children = root.children()

            for child in children:

                collect_controls(
                    child,
                    controls,
                    depth + 1
                )

        except Exception:
            pass

    except Exception:
        pass

    return controls


# ============================================================
# SEMANTIC CONTEXT
# ============================================================

def control_context(control: dict) -> str:

    return (
        f"{control.get('name', '')} "
        f"{control.get('value', '')} "
        f"{control.get('ancestor_text', '')}"
    ).lower()


# ============================================================
# FIELD SCORING
# ============================================================

def score_work_order(
    control: dict
) -> int:

    if control["control_type"] != "edit":
        return -1

    value = control["value"]

    if not value:
        return -1

    name = control["name"].lower()
    context = control_context(control)

    score = 0

    if name == "work order:":
        score += 300

    if "work order" in name:
        score += 240

    if "work order" in context:
        score += 130

    if "informasi work order" in context:
        score += 90

    if (
        "material" in name
        and "informasi work order" in context
    ):
        score += 50

    if any(c.isdigit() for c in value):
        score += 20

    if any(c in value for c in "-/"):
        score += 15

    return score


def score_product(
    control: dict
) -> int:

    if control["control_type"] != "edit":
        return -1

    value = control["value"]

    if not value:
        return -1

    name = control["name"].lower()
    context = control_context(control)

    score = 0

    product_keywords = (
        "kode produk",
        "code produk",
        "product code",
        "product",
        "kode material",
        "material code",
        "material",
    )

    for keyword in product_keywords:

        if keyword in name:
            score += 200

        if keyword in context:
            score += 100

    if "informasi work order" in context:
        score += 40

    return score


def score_formula(
    control: dict
) -> int:

    if control["control_type"] != "edit":
        return -1

    value = control["value"]

    if not value:
        return -1

    name = control["name"].lower()
    context = control_context(control)

    score = 0

    if "formula" in name:
        score += 240

    if "formula" in context:
        score += 160

    if "informasi work order" in context:
        score += 40

    if any(c.isalpha() for c in value):
        score += 20

    return score


def score_batch(
    control: dict
) -> int:

    if control["control_type"] != "edit":
        return -1

    value = control["value"]

    if not value:
        return -1

    name = control["name"].lower()
    context = control_context(control)

    score = 0

    if name == "nomor batch":
        score += 300

    if "nomor batch" in name:
        score += 260

    if "batch" in name:
        score += 210

    if "batch" in context:
        score += 130

    if "informasi work order" in context:
        score += 40

    if any(c.isalpha() for c in value):
        score += 20

    if any(c.isdigit() for c in value):
        score += 20

    return score


def score_machine(
    control: dict
) -> int:

    if control["control_type"] not in {
        "edit",
        "combo box",
        "text",
        "list item",
    }:
        return -1

    value = control["value"]

    if not value:
        return -1

    name = control["name"].lower()
    context = control_context(control)

    score = 0

    if "nomor mesin" in name:
        score += 250

    elif "mesin" in name:
        score += 180

    if "nomor mesin" in context:
        score += 120

    return score


def score_packer(
    control: dict
) -> int:

    if control["control_type"] not in {
        "edit",
        "combo box",
        "text",
        "list item",
    }:
        return -1

    value = control["value"]

    if not value:
        return -1

    name = control["name"].lower()
    context = control_context(control)

    score = 0

    if "packer" in name:
        score += 250

    if "pengepakan" in name:
        score += 180

    if "pengepak" in name:
        score += 180

    if "packer" in context:
        score += 120

    return score


def score_scale(
    control: dict
) -> int:

    if control["control_type"] not in {
        "edit",
        "combo box",
        "text",
        "list item",
    }:
        return -1

    value = control["value"]

    if not value:
        return -1

    name = control["name"].lower()
    context = control_context(control)

    score = 0

    if "timbangan" in name:
        score += 250

    if "penimbang" in name:
        score += 180

    if "timbangan" in context:
        score += 120

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
# BUTTON MATCHING
# ============================================================

def score_button(
    control: dict,
    keywords: tuple
) -> int:

    if control["control_type"] != "button":
        return -1

    name = control["name"].lower()
    value = control["value"].lower()
    context = control_context(control)

    score = 0

    for keyword in keywords:

        keyword = keyword.lower()

        if keyword in name:
            score += 250

        if keyword in value:
            score += 180

        if keyword in context:
            score += 80

    return score


def find_best_button(
    controls: list,
    keywords: tuple
) -> Optional[dict]:

    candidates = []

    for control in controls:

        score = score_button(
            control,
            keywords
        )

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


def button_state(
    control: Optional[dict]
) -> dict:

    result = {
        "exists": control is not None,
        "enabled": False,
    }

    if control is None:
        return result

    try:
        result["enabled"] = bool(
            control["element"].is_enabled()
        )
    except Exception:
        pass

    return result


# ============================================================
# TARGET STATE EXTRACTION
# ============================================================

def extract_target_state(
    root: UIAWrapper
) -> dict:

    controls = collect_controls(root)

    work_order_control = select_best(
        controls,
        score_work_order
    )

    product_control = select_best(
        controls,
        score_product
    )

    formula_control = select_best(
        controls,
        score_formula
    )

    batch_control = select_best(
        controls,
        score_batch
    )

    machine_control = select_best(
        controls,
        score_machine
    )

    packer_control = select_best(
        controls,
        score_packer
    )

    scale_control = select_best(
        controls,
        score_scale
    )

    incomplete_control = find_best_button(
        controls,
        ("incomplete mb",)
    )

    last_mb_control = find_best_button(
        controls,
        (
            "master box terakhir",
            "last mb",
        )
    )

    return {
        "work_order": (
            work_order_control["value"]
            if work_order_control
            else ""
        ),

        "product_code": (
            product_control["value"]
            if product_control
            else ""
        ),

        "formula": (
            formula_control["value"]
            if formula_control
            else ""
        ),

        "batch": (
            batch_control["value"]
            if batch_control
            else ""
        ),

        "machine": (
            machine_control["value"]
            if machine_control
            else ""
        ),

        "packer": (
            packer_control["value"]
            if packer_control
            else ""
        ),

        "scale": (
            scale_control["value"]
            if scale_control
            else ""
        ),

        "incomplete_mb": button_state(
            incomplete_control
        ),

        "last_mb": button_state(
            last_mb_control
        ),
    }


# ============================================================
# DATA VALIDATION
# ============================================================

def state_has_data(
    state: dict
) -> bool:

    return bool(
        state.get("work_order")
        and (
            state.get("batch")
            or state.get("formula")
            or state.get("product_code")
        )
    )


def state_identity(
    state: dict
) -> Tuple[str, str, str]:

    return (
        normalize_text(
            state.get("work_order")
        ),
        normalize_text(
            state.get("batch")
        ),
        normalize_text(
            state.get("formula")
        ),
    )


# ============================================================
# MOUSE EVENT QUEUE
# ============================================================

mouse_events = Queue()


def on_mouse_click(
    x: int,
    y: int,
    button,
    pressed: bool
):

    if not pressed:
        return

    if button != mouse.Button.left:
        return

    mouse_events.put({
        "x": x,
        "y": y,
        "timestamp": now_string(),
    })


def start_mouse_listener():

    listener = mouse.Listener(
        on_click=on_mouse_click
    )

    listener.daemon = True
    listener.start()

    return listener


# ============================================================
# ELEMENT FROM SCREEN POINT
# ============================================================

def element_from_point(
    x: int,
    y: int
) -> Optional[UIAWrapper]:

    try:

        desktop = Desktop(
            backend="uia"
        )

        return desktop.from_point(
            x,
            y
        )

    except Exception:
        return None


# ============================================================
# CLICK TARGET VALIDATION
# ============================================================

def click_belongs_to_target(
    element: UIAWrapper,
    target_win: UIAWrapper
) -> bool:

    try:

        clicked_pid = (
            element.element_info.process_id
        )

        target_pid = (
            target_win.element_info.process_id
        )

        if not clicked_pid or not target_pid:
            return False

        return clicked_pid == target_pid

    except Exception:
        return False


# ============================================================
# CLICK CLASSIFICATION
# ============================================================

def classify_clicked_control(
    element: UIAWrapper
) -> Optional[str]:

    try:

        info = element.element_info

        name = normalize_text(
            info.name
        )

        value = get_element_value(
            element
        )

        parts = [
            name,
            value,
        ]

        try:

            parent = element.parent()

            for _ in range(5):

                if parent is None:
                    break

                parent_name = normalize_text(
                    parent.element_info.name
                )

                if parent_name:
                    parts.append(
                        parent_name
                    )

                parent = parent.parent()

        except Exception:
            pass

        context = " ".join(
            parts
        ).lower()

        # ----------------------------------------------------
        # END
        # ----------------------------------------------------

        for keyword in END_KEYWORDS:

            if keyword.lower() in context:
                return "end"

        # ----------------------------------------------------
        # START
        # ----------------------------------------------------

        for keyword in START_KEYWORDS:

            if keyword.lower() in context:
                return "start"

        # ----------------------------------------------------
        # Semua click lain diabaikan.
        # ----------------------------------------------------

        return None

    except Exception:
        return None


# ============================================================
# JSON
# ============================================================

def load_or_init_json_log() -> dict:

    if os.path.exists(
        JSON_LOG_FILE
    ):

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


def save_json_log(
    data: dict
):

    temp_file = (
        JSON_LOG_FILE + ".tmp"
    )

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
# CAPTURE RECORD
# ============================================================

def create_capture(
    state: dict
) -> dict:

    timestamp = now_string()

    return {
        "timestamp": timestamp,
        "event": "activity_detected",

        "work_order": state["work_order"],
        "product_code": state["product_code"],
        "formula": state["formula"],
        "batch": state["batch"],

        "machine": state["machine"],
        "packer": state["packer"],
        "scale": state["scale"],

        "start_packaging": {
            "type": "mid process",
            "timestamp": timestamp,
        },

        "end_packaging": {
            "type": "",
            "timestamp": "",
        },

        "incomplete_mb": state["incomplete_mb"],
        "last_mb": state["last_mb"],
    }


# ============================================================
# UPDATE CAPTURE WITH LATEST STATE
# ============================================================

def update_capture_state(
    capture: dict,
    state: dict
):

    fields = (
        "work_order",
        "product_code",
        "formula",
        "batch",
        "machine",
        "packer",
        "scale",
    )

    for field in fields:

        value = state.get(field, "")

        if value:
            capture[field] = value

    capture["incomplete_mb"] = (
        state["incomplete_mb"]
    )

    capture["last_mb"] = (
        state["last_mb"]
    )


# ============================================================
# CMD OUTPUT
# ============================================================

def print_session(
    capture: dict,
    action: str
):

    print()
    print("=" * 72)

    if action == "mid":
        print("PACKAGING SESSION : MID PROCESS")

    elif action == "start":
        print("PACKAGING SESSION : START PROCESS")

    elif action == "end":
        print("PACKAGING SESSION : END PROCESS")

    elif action == "new":
        print("PACKAGING SESSION : NEW BATCH")

    else:
        print("PACKAGING SESSION")

    print("=" * 72)

    print(
        f"Work Order       : "
        f"{capture.get('work_order', '')}"
    )

    print(
        f"Product Code     : "
        f"{capture.get('product_code', '')}"
    )

    print(
        f"Formula          : "
        f"{capture.get('formula', '')}"
    )

    print(
        f"Batch            : "
        f"{capture.get('batch', '')}"
    )

    if capture.get("machine"):
        print(
            f"Machine          : "
            f"{capture.get('machine')}"
        )

    if capture.get("packer"):
        print(
            f"Packer           : "
            f"{capture.get('packer')}"
        )

    if capture.get("scale"):
        print(
            f"Scale            : "
            f"{capture.get('scale')}"
        )

    print("-" * 72)

    start = capture.get(
        "start_packaging",
        {}
    )

    end = capture.get(
        "end_packaging",
        {}
    )

    start_type = (
        start.get("type")
        or "-"
    )

    start_timestamp = (
        start.get("timestamp")
        or "-"
    )

    end_type = (
        end.get("type")
        or "-"
    )

    end_timestamp = (
        end.get("timestamp")
        or "-"
    )

    print(
        f"Start Packaging  : "
        f"{start_type} "
        f"({start_timestamp})"
    )

    print(
        f"End Packaging    : "
        f"{end_type} "
        f"({end_timestamp})"
    )

    print("-" * 72)

    incomplete = capture.get(
        "incomplete_mb",
        {}
    )

    last_mb = capture.get(
        "last_mb",
        {}
    )

    print(
        "Incomplete MB     : "
        f"exists={str(incomplete.get('exists', False)).lower()} "
        f"enabled={str(incomplete.get('enabled', False)).lower()}"
    )

    print(
        "Master Box Last   : "
        f"exists={str(last_mb.get('exists', False)).lower()} "
        f"enabled={str(last_mb.get('enabled', False)).lower()}"
    )

    print("=" * 72)


# ============================================================
# SESSION HELPERS
# ============================================================

def get_active_capture(
    log_data: dict
) -> Optional[dict]:

    captures = log_data.get(
        "captures",
        []
    )

    if not captures:
        return None

    capture = captures[-1]

    end = capture.get(
        "end_packaging",
        {}
    )

    if end.get("timestamp"):
        return None

    return capture


def capture_is_ended(
    capture: Optional[dict]
) -> bool:

    if not capture:
        return False

    return bool(
        capture.get(
            "end_packaging",
            {}
        ).get("timestamp")
    )


# ============================================================
# MID PROCESS
# ============================================================

def initialize_mid_process(
    state: dict,
    log_data: dict
) -> Optional[dict]:

    if not state_has_data(state):
        return None

    capture = create_capture(
        state
    )

    log_data["captures"].append(
        capture
    )

    save_json_log(
        log_data
    )

    print_session(
        capture,
        "mid"
    )

    return capture


# ============================================================
# START PROCESS
# ============================================================

def promote_to_start_process(
    capture: dict,
    state: dict,
    click_timestamp: str,
    log_data: dict
):

    update_capture_state(
        capture,
        state
    )

    capture["start_packaging"] = {
        "type": "start process",
        "timestamp": click_timestamp,
    }

    save_json_log(
        log_data
    )

    print_session(
        capture,
        "start"
    )


# ============================================================
# END PROCESS
# ============================================================

def finish_process(
    capture: dict,
    state: dict,
    click_timestamp: str,
    log_data: dict
):

    update_capture_state(
        capture,
        state
    )

    capture["end_packaging"] = {
        "type": "end process",
        "timestamp": click_timestamp,
    }

    save_json_log(
        log_data
    )

    print_session(
        capture,
        "end"
    )


# ============================================================
# NEW BATCH
# ============================================================

def create_new_batch(
    state: dict,
    log_data: dict
) -> Optional[dict]:

    if not state_has_data(state):
        return None

    capture = create_capture(
        state
    )

    log_data["captures"].append(
        capture
    )

    save_json_log(
        log_data
    )

    print_session(
        capture,
        "new"
    )

    return capture


# ============================================================
# PROCESS START CLICK
# ============================================================

def handle_start_click(
    state: dict,
    click_timestamp: str,
    log_data: dict,
    current_capture: Optional[dict]
) -> Optional[dict]:

    if not state_has_data(state):
        return current_capture

    # --------------------------------------------------------
    # Tidak ada capture:
    # click semantic START menjadi START PROCESS.
    # --------------------------------------------------------

    if current_capture is None:

        capture = create_capture(
            state
        )

        capture["start_packaging"] = {
            "type": "start process",
            "timestamp": click_timestamp,
        }

        log_data["captures"].append(
            capture
        )

        save_json_log(
            log_data
        )

        print_session(
            capture,
            "start"
        )

        return capture

    # --------------------------------------------------------
    # Capture sudah selesai:
    # semantic START berarti batch baru.
    # --------------------------------------------------------

    if capture_is_ended(
        current_capture
    ):

        return create_new_batch(
            state,
            log_data
        )

    # --------------------------------------------------------
    # Capture masih MID PROCESS:
    # upgrade menjadi START PROCESS.
    # --------------------------------------------------------

    start = current_capture.get(
        "start_packaging",
        {}
    )

    if (
        start.get("type")
        == "mid process"
    ):

        promote_to_start_process(
            current_capture,
            state,
            click_timestamp,
            log_data
        )

    else:

        # Sudah START PROCESS.
        # Click berikutnya diabaikan.
        update_capture_state(
            current_capture,
            state
        )

        save_json_log(
            log_data
        )

    return current_capture


# ============================================================
# PROCESS END CLICK
# ============================================================

def handle_end_click(
    state: dict,
    click_timestamp: str,
    log_data: dict,
    current_capture: Optional[dict]
) -> Optional[dict]:

    if current_capture is None:
        return None

    if capture_is_ended(
        current_capture
    ):
        return current_capture

    if not state_has_data(state):
        return current_capture

    finish_process(
        current_capture,
        state,
        click_timestamp,
        log_data
    )

    return current_capture


# ============================================================
# MAIN
# ============================================================

def main():

    log_data = load_or_init_json_log()

    target_win = None
    target_info = None

    current_state = empty_state()

    current_capture = get_active_capture(
        log_data
    )

    current_identity = None

    if current_capture:

        current_identity = (
            current_capture.get("work_order", ""),
            current_capture.get("batch", ""),
            current_capture.get("formula", ""),
        )

    mouse_listener = start_mouse_listener()

    try:

        while True:

            # =================================================
            # DISCOVERY
            # =================================================

            if target_win is None:

                target_win, target_info = (
                    find_target_window()
                )

                if target_win is None:

                    time.sleep(
                        SEARCH_INTERVAL
                    )

                    continue

                log_data["target"] = (
                    target_info
                )

                save_json_log(
                    log_data
                )

                current_state = empty_state()

            # =================================================
            # REFRESH TARGET STATE
            # =================================================

            try:

                _ = (
                    target_win
                    .element_info.name
                )

                current_state = (
                    extract_target_state(
                        target_win
                    )
                )

            except Exception:

                target_win = None
                target_info = None

                current_state = empty_state()

                # ------------------------------------------------
                # Jangan hapus capture.
                #
                # Kalau 3WS restart:
                # capture batch terakhir tetap ada di JSON.
                # Discovery berikutnya akan mencari instance baru.
                # ------------------------------------------------

                time.sleep(
                    SEARCH_INTERVAL
                )

                continue

            # =================================================
            # DETECT DATA / BATCH
            # =================================================

            if state_has_data(
                current_state
            ):

                identity = state_identity(
                    current_state
                )

                # ------------------------------------------------
                # Tidak ada capture aktif.
                #
                # Jika data sudah ada saat pertama kali ditemukan,
                # ini adalah MID PROCESS.
                # ------------------------------------------------

                if current_capture is None:

                    # Jika capture terakhir sudah selesai,
                    # jangan langsung membuat batch baru hanya
                    # karena window ditemukan kembali.
                    #
                    # Batch baru hanya dibuat lewat START click.
                    last_capture = None

                    captures = log_data.get(
                        "captures",
                        []
                    )

                    if captures:
                        last_capture = captures[-1]

                    if (
                        last_capture
                        and capture_is_ended(
                            last_capture
                        )
                    ):

                        current_capture = None
                        current_identity = None

                    else:

                        current_capture = (
                            initialize_mid_process(
                                current_state,
                                log_data
                            )
                        )

                        if current_capture:
                            current_identity = identity

                # ------------------------------------------------
                # Capture aktif dan identity sama:
                # hanya update informasi terbaru.
                # TIDAK PRINT.
                # TIDAK APPEND EVENT.
                # ------------------------------------------------

                elif (
                    not capture_is_ended(
                        current_capture
                    )
                    and current_identity == identity
                ):

                    update_capture_state(
                        current_capture,
                        current_state
                    )

                    save_json_log(
                        log_data
                    )

                # ------------------------------------------------
                # Identity berubah saat session aktif.
                #
                # Jangan membuat event baru setiap perubahan UI.
                # Tunggu semantic START click untuk mengunci
                # batch baru.
                # ------------------------------------------------

                elif (
                    current_capture
                    and not capture_is_ended(
                        current_capture
                    )
                    and current_identity != identity
                ):

                    # Informasi state terbaru tetap disimpan,
                    # tetapi belum dianggap batch baru.
                    pass

            # =================================================
            # PROCESS MOUSE EVENTS
            # =================================================

            while True:

                try:

                    click = mouse_events.get_nowait()

                except Empty:
                    break

                try:

                    clicked_element = (
                        element_from_point(
                            click["x"],
                            click["y"]
                        )
                    )

                    if clicked_element is None:
                        continue

                    if not click_belongs_to_target(
                        clicked_element,
                        target_win
                    ):
                        continue

                    action = (
                        classify_clicked_control(
                            clicked_element
                        )
                    )

                    # ------------------------------------------------
                    # CLICK BIASA / CLICK WINDOW:
                    # IGNORE.
                    # ------------------------------------------------

                    if action is None:
                        continue

                    # ------------------------------------------------
                    # START
                    # ------------------------------------------------

                    if action == "start":

                        current_capture = (
                            handle_start_click(
                                current_state,
                                click["timestamp"],
                                log_data,
                                current_capture
                            )
                        )

                        if current_capture:

                            current_identity = (
                                state_identity(
                                    current_state
                                )
                            )

                    # ------------------------------------------------
                    # END
                    # ------------------------------------------------

                    elif action == "end":

                        current_capture = (
                            handle_end_click(
                                current_state,
                                click["timestamp"],
                                log_data,
                                current_capture
                            )
                        )

                except Exception:
                    continue

            # =================================================
            # MONITOR INTERVAL
            # =================================================

            time.sleep(
                MONITOR_INTERVAL
            )

    except KeyboardInterrupt:

        save_json_log(
            log_data
        )

        try:
            mouse_listener.stop()
        except Exception:
            pass

        sys.exit(0)


if __name__ == "__main__":
    main()
