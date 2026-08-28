
import os
import sys
import time
import json
import re
import datetime
import traceback
from typing import Optional, Dict, Any, List, Tuple

try:
    import pywinauto
    from pywinauto import Desktop, Application
    from pywinauto.controls.uiawrapper import UIAWrapper
except ImportError:
    print("[ERROR] 'pywinauto' library is not installed.")
    print("Please install it using: pip install pywinauto")
    sys.exit(1)


# ============================================================
# FILES
# ============================================================

JSON_LOG_FILE = "capture.json"
DEBUG_LOG_FILE = "capture_debug.json"


# ============================================================
# GENERAL CONFIG
# ============================================================

TARGET_PROCESS_NAMES = [
    "3ws.exe",
    "3ws.net.exe",
]

TARGET_WINDOW_TITLE_KEYWORDS = [
    "Penimbangan FG",
]

SEARCH_INTERVAL = 1.0
MONITOR_INTERVAL = 1.0

# Jangan menggunakan Automation ID sebagai identity.
# Automation ID hanya dicatat sebagai diagnostic evidence.
#
# Tidak ada mapping:
# 1705480 -> work_order
# 395160  -> formula
# 1050396 -> batch
#
# karena ID dapat berubah setelah restart/update/runtime.


# ============================================================
# RUNTIME DISCOVERY STATE
# ============================================================

DISCOVERY_PRINT_INTERVAL = 5.0
DEBUG_SAVE_INTERVAL = 5.0

last_discovery_debug_time = 0.0
last_debug_save_time = 0.0


# ============================================================
# TIME
# ============================================================

def now_string() -> str:
    return datetime.datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S.%f"
    )[:-3]


# ============================================================
# SAFE HELPERS
# ============================================================

def safe_str(value: Any) -> str:
    try:
        if value is None:
            return ""
        return str(value).strip()
    except Exception:
        return ""


def safe_get_process_name(pid: int) -> str:
    if not pid:
        return "unknown"

    try:
        mod = pywinauto.application.process_module(pid)
        return os.path.basename(mod).lower() if mod else "unknown"
    except Exception:
        return "unknown"


def safe_element_info(element: UIAWrapper) -> Dict[str, Any]:
    info = {}

    try:
        ei = element.element_info
    except Exception as exc:
        return {
            "error": f"element_info unavailable: {type(exc).__name__}: {exc}"
        }

    properties = [
        ("name", "name"),
        ("automation_id", "automation_id"),
        ("control_type", "control_type"),
        ("class_name", "class_name"),
        ("framework_id", "framework_id"),
    ]

    for output_key, attr_name in properties:
        try:
            info[output_key] = safe_str(getattr(ei, attr_name, ""))
        except Exception as exc:
            info[output_key] = ""
            info[f"{output_key}_error"] = (
                f"{type(exc).__name__}: {exc}"
            )

    try:
        info["process_id"] = int(ei.process_id or 0)
    except Exception:
        info["process_id"] = 0

    try:
        info["handle"] = hex(element.handle) if element.handle else "0x0"
    except Exception:
        info["handle"] = "0x0"

    return info


# ============================================================
# VALUE EXTRACTION
# ============================================================

def get_element_value_diagnostic(
    element: UIAWrapper
) -> Dict[str, Any]:
    """
    Membaca value secara hybrid.

    Urutan:
    1. ValuePattern
    2. texts()
    3. LegacyIAccessible

    Return:
    {
        "value": "...",
        "method": "...",
        "errors": [...]
    }
    """

    result = {
        "value": "",
        "method": "",
        "errors": []
    }

    # --------------------------------------------------------
    # 1. ValuePattern
    # --------------------------------------------------------

    try:
        iface_value = getattr(element, "iface_value", None)

        if iface_value:
            value = safe_str(iface_value.CurrentValue)

            if value:
                result["value"] = value
                result["method"] = "iface_value"
                return result

    except Exception as exc:
        result["errors"].append({
            "method": "iface_value",
            "error": f"{type(exc).__name__}: {exc}"
        })

    # --------------------------------------------------------
    # 2. texts()
    # --------------------------------------------------------

    try:
        texts = element.texts()

        if texts:
            filtered = [
                safe_str(text)
                for text in texts
                if safe_str(text)
            ]

            if filtered:
                result["value"] = " | ".join(filtered)
                result["method"] = "texts"
                return result

    except Exception as exc:
        result["errors"].append({
            "method": "texts",
            "error": f"{type(exc).__name__}: {exc}"
        })

    # --------------------------------------------------------
    # 3. LegacyIAccessible
    # --------------------------------------------------------

    try:
        legacy = getattr(
            element,
            "iface_legacy_iaccessible",
            None
        )

        if legacy:
            value = safe_str(legacy.CurrentValue)

            if value:
                result["value"] = value
                result["method"] = "legacy_iaccessible"
                return result

    except Exception as exc:
        result["errors"].append({
            "method": "legacy_iaccessible",
            "error": f"{type(exc).__name__}: {exc}"
        })

    return result


# ============================================================
# BUTTON STATE
# ============================================================

def get_button_state(element: UIAWrapper) -> Dict[str, Any]:
    enabled = False
    enabled_error = ""

    try:
        enabled = bool(element.is_enabled())
    except Exception as exc:
        enabled_error = f"{type(exc).__name__}: {exc}"

    return {
        "exists": True,
        "enabled": enabled,
        "enabled_error": enabled_error
    }


# ============================================================
# WINDOW DISCOVERY
# ============================================================

def window_matches(
    title: str,
    process_name: str
) -> Tuple[bool, int, str]:
    """
    Menghasilkan:
        matched
        score
        reason

    Prioritas:
        title match > process match

    Tidak menggunakan PID/HWND sebagai identity.
    """

    title_lower = safe_str(title).lower()
    process_lower = safe_str(process_name).lower()

    title_hits = [
        kw for kw in TARGET_WINDOW_TITLE_KEYWORDS
        if kw.lower() in title_lower
    ]

    process_hits = [
        proc for proc in TARGET_PROCESS_NAMES
        if proc.lower() in process_lower
    ]

    score = 0

    if title_hits:
        score += 100

    if process_hits:
        score += 50

    if title_hits and process_hits:
        return (
            True,
            score,
            f"title_match={title_hits}, process_match={process_hits}"
        )

    # Fallback hanya process match.
    # Ini menjaga kompatibilitas jika title berubah.
    if process_hits:
        return (
            True,
            score,
            f"process_match={process_hits}"
        )

    return False, 0, "no_match"


def find_target_window():
    """
    Fresh window discovery.

    Tidak menyimpan object UIA lama sebagai locator permanen.
    """

    candidates = []

    # ========================================================
    # PHASE A: UIA
    # ========================================================

    try:
        desktop_uia = Desktop(backend="uia")
        windows_uia = desktop_uia.windows()

        for win in windows_uia:
            try:
                info = safe_element_info(win)

                title = info.get("name", "")
                pid = info.get("process_id", 0)
                process_name = safe_get_process_name(pid)

                matched, score, reason = window_matches(
                    title,
                    process_name
                )

                if matched:
                    candidates.append({
                        "window": win,
                        "info": {
                            "title": title,
                            "process_name": process_name,
                            "pid": pid,
                            "hwnd": info.get("handle", "0x0")
                        },
                        "score": score,
                        "reason": reason,
                        "backend": "uia"
                    })

            except Exception:
                continue

    except Exception as exc:
        print(
            f"[DISCOVERY-UIA-ERROR] "
            f"{type(exc).__name__}: {exc}"
        )

    if candidates:
        candidates.sort(
            key=lambda item: item["score"],
            reverse=True
        )

        selected = candidates[0]

        print(
            f"[DISCOVERY] UIA candidate selected "
            f"(score={selected['score']})"
        )

        return (
            selected["window"],
            selected["info"]
        )

    # ========================================================
    # PHASE B: WIN32 FALLBACK
    # ========================================================

    try:
        desktop_win32 = Desktop(backend="win32")
        windows_win32 = desktop_win32.windows()

        win32_candidates = []

        for win in windows_win32:
            try:
                title = safe_str(win.window_text())
                hwnd = win.handle
                pid = win.process_id()
                process_name = safe_get_process_name(pid)

                matched, score, reason = window_matches(
                    title,
                    process_name
                )

                if not matched:
                    continue

                win32_candidates.append({
                    "win": win,
                    "title": title,
                    "hwnd": hwnd,
                    "pid": pid,
                    "process_name": process_name,
                    "score": score,
                    "reason": reason
                })

            except Exception:
                continue

        if win32_candidates:
            win32_candidates.sort(
                key=lambda item: item["score"],
                reverse=True
            )

            selected = win32_candidates[0]

            try:
                app = Application(
                    backend="uia"
                ).connect(
                    handle=selected["hwnd"]
                )

                uia_win = app.window(
                    handle=selected["hwnd"]
                )

                info = {
                    "title": selected["title"],
                    "process_name": selected["process_name"],
                    "pid": selected["pid"],
                    "hwnd": hex(selected["hwnd"])
                }

                print(
                    f"[DISCOVERY] Win32 fallback selected "
                    f"(score={selected['score']})"
                )

                return uia_win, info

            except Exception as exc:
                print(
                    f"[DISCOVERY-WIN32-UIA-ERROR] "
                    f"{type(exc).__name__}: {exc}"
                )

    except Exception as exc:
        print(
            f"[DISCOVERY-WIN32-ERROR] "
            f"{type(exc).__name__}: {exc}"
        )

    return None, None


# ============================================================
# FRESH WINDOW REACQUISITION
# ============================================================

def reacquire_window(target_info: Dict[str, Any]):
    """
    Jangan memakai object UIA lama.

    Gunakan metadata runtime hanya untuk mencoba mendapatkan
    wrapper baru. Jika gagal, lakukan full discovery.
    """

    if not target_info:
        return None, None

    hwnd_text = safe_str(target_info.get("hwnd"))

    try:
        if hwnd_text:
            hwnd = int(hwnd_text, 16)

            app = Application(
                backend="uia"
            ).connect(
                handle=hwnd,
                timeout=1
            )

            fresh_window = app.window(
                handle=hwnd
            )

            # Validasi object baru.
            _ = fresh_window.element_info.name

            info = safe_element_info(fresh_window)

            pid = info.get("process_id", 0)
            process_name = safe_get_process_name(pid)

            title = info.get("name", "")

            matched, _, _ = window_matches(
                title,
                process_name
            )

            if matched:
                return fresh_window, {
                    "title": title,
                    "process_name": process_name,
                    "pid": pid,
                    "hwnd": info.get(
                        "handle",
                        hwnd_text
                    )
                }

    except Exception:
        pass

    return find_target_window()


# ============================================================
# TEXT NORMALIZATION
# ============================================================

def normalize_text(value: str) -> str:
    value = safe_str(value)

    value = value.replace("\r", " ")
    value = value.replace("\n", " ")
    value = re.sub(r"\s+", " ", value)

    return value.strip().lower()


def tokenize_text(value: str) -> List[str]:
    normalized = normalize_text(value)

    if not normalized:
        return []

    return re.findall(
        r"[a-zA-Z0-9À-ÿ]+",
        normalized
    )


# ============================================================
# SEMANTIC KEYWORDS
# ============================================================

# Ini BUKAN Automation ID.
# Ini semantic vocabulary untuk membantu classification.
#
# Tidak bergantung pada format kode produk tertentu.

WORK_ORDER_WORDS = {
    "work order",
    "workorder",
    "wo",
    "order",
    "production order",
    "prod order",
}

FORMULA_WORDS = {
    "formula",
    "formulation",
    "recipe",
    "formula code",
}

BATCH_WORDS = {
    "batch",
    "batch code",
    "lot",
    "lot number",
    "lot no",
}

INCOMPLETE_WORDS = {
    "incomplete mb",
    "incomplete",
    "incomplete material box",
    "incomplete material",
}

LAST_MB_WORDS = {
    "master box terakhir",
    "last master box",
    "last mb",
    "master box",
}


# ============================================================
# GENERIC SEMANTIC SCORING
# ============================================================

def semantic_score(
    text: str,
    keywords: set
) -> int:
    normalized = normalize_text(text)

    if not normalized:
        return 0

    score = 0

    for keyword in keywords:
        key = normalize_text(keyword)

        if normalized == key:
            score += 100
        elif key in normalized:
            score += 60

    return score


# ============================================================
# VALUE CHARACTERISTICS
# ============================================================

def value_characteristics(value: str) -> Dict[str, Any]:
    value = safe_str(value)

    compact = re.sub(r"\s+", "", value)

    digit_count = sum(
        1 for c in compact
        if c.isdigit()
    )

    alpha_count = sum(
        1 for c in compact
        if c.isalpha()
    )

    separator_count = sum(
        1 for c in compact
        if c in "-_/."
    )

    return {
        "length": len(compact),
        "digit_count": digit_count,
        "alpha_count": alpha_count,
        "separator_count": separator_count,
        "has_digit": digit_count > 0,
        "has_alpha": alpha_count > 0,
        "is_numeric": compact.isdigit() if compact else False,
        "is_alphanumeric": (
            bool(compact)
            and any(c.isalpha() for c in compact)
            and any(c.isdigit() for c in compact)
        )
    }


# ============================================================
# CANDIDATE SCORING
# ============================================================

def score_work_order(candidate: Dict[str, Any]) -> Tuple[int, List[str]]:
    score = 0
    reasons = []

    context = candidate["context_text"]
    value = candidate["value"]

    score += semantic_score(
        context,
        WORK_ORDER_WORDS
    )

    if semantic_score(context, WORK_ORDER_WORDS):
        reasons.append("semantic work-order context")

    chars = value_characteristics(value)

    if chars["has_digit"]:
        score += 10
        reasons.append("value contains digits")

    if chars["has_alpha"]:
        score += 5
        reasons.append("value contains letters")

    if chars["separator_count"] > 0:
        score += 5
        reasons.append("value contains separators")

    if candidate["control_type"] == "edit":
        score += 10
        reasons.append("Edit control")

    return score, reasons


def score_formula(candidate: Dict[str, Any]) -> Tuple[int, List[str]]:
    score = 0
    reasons = []

    context = candidate["context_text"]
    value = candidate["value"]

    semantic = semantic_score(
        context,
        FORMULA_WORDS
    )

    score += semantic

    if semantic:
        reasons.append("semantic formula context")

    chars = value_characteristics(value)

    if chars["has_alpha"]:
        score += 15
        reasons.append("value contains letters")

    if candidate["control_type"] == "edit":
        score += 10
        reasons.append("Edit control")

    return score, reasons


def score_batch(candidate: Dict[str, Any]) -> Tuple[int, List[str]]:
    score = 0
    reasons = []

    context = candidate["context_text"]
    value = candidate["value"]

    semantic = semantic_score(
        context,
        BATCH_WORDS
    )

    score += semantic

    if semantic:
        reasons.append("semantic batch context")

    chars = value_characteristics(value)

    if chars["has_alpha"]:
        score += 10
        reasons.append("value contains letters")

    if chars["has_digit"]:
        score += 10
        reasons.append("value contains digits")

    if candidate["control_type"] == "edit":
        score += 10
        reasons.append("Edit control")

    return score, reasons


def score_incomplete_button(
    candidate: Dict[str, Any]
) -> Tuple[int, List[str]]:
    score = 0
    reasons = []

    text = candidate["context_text"]

    semantic = semantic_score(
        text,
        INCOMPLETE_WORDS
    )

    score += semantic

    if semantic:
        reasons.append("semantic incomplete-MB text")

    if candidate["control_type"] == "button":
        score += 20
        reasons.append("Button control")

    return score, reasons


def score_last_mb_button(
    candidate: Dict[str, Any]
) -> Tuple[int, List[str]]:
    score = 0
    reasons = []

    text = candidate["context_text"]

    semantic = semantic_score(
        text,
        LAST_MB_WORDS
    )

    score += semantic

    if semantic:
        reasons.append("semantic last-MB text")

    if candidate["control_type"] == "button":
        score += 20
        reasons.append("Button control")

    return score, reasons


# ============================================================
# UI TREE SCANNER
# ============================================================

def scan_ui_tree(
    root: UIAWrapper
) -> Dict[str, Any]:
    """
    Full fresh scan.

    Tidak menggunakan Automation ID untuk menentukan field.

    Semua control dikumpulkan sebagai candidate terlebih dahulu.
    """

    candidates = []
    errors = []

    stack = [
        (
            root,
            0,
            []
        )
    ]

    scanned = 0

    while stack:
        element, depth, ancestors = stack.pop()

        scanned += 1

        try:
            info = safe_element_info(element)

            control_type = normalize_text(
                info.get("control_type", "")
            )

            name = safe_str(
                info.get("name", "")
            )

            automation_id = safe_str(
                info.get("automation_id", "")
            )

            class_name = safe_str(
                info.get("class_name", "")
            )

            framework_id = safe_str(
                info.get("framework_id", "")
            )

            value_info = get_element_value_diagnostic(
                element
            )

            value = value_info["value"]

            ancestor_text = " | ".join(
                [
                    safe_str(x)
                    for x in ancestors
                    if safe_str(x)
                ]
            )

            context_parts = [
                name,
                value,
                ancestor_text,
            ]

            context_text = " | ".join(
                [
                    x for x in context_parts
                    if x
                ]
            )

            candidate = {
                "element": element,
                "depth": depth,
                "name": name,
                "value": value,
                "value_method": value_info["method"],
                "value_errors": value_info["errors"],
                "automation_id": automation_id,
                "control_type": control_type,
                "class_name": class_name,
                "framework_id": framework_id,
                "ancestor_text": ancestor_text,
                "context_text": context_text,
            }

            # Simpan Edit dan Button sebagai candidate.
            if (
                control_type == "edit"
                or "edit" in control_type
                or control_type == "button"
                or "button" in control_type
            ):
                candidates.append(candidate)

            # ------------------------------------------------
            # Child traversal
            # ------------------------------------------------

            try:
                children = element.children()

                next_ancestors = list(ancestors)

                if name:
                    next_ancestors.append(name)

                # Reverse supaya urutan traversal lebih stabil.
                for child in reversed(children):
                    stack.append(
                        (
                            child,
                            depth + 1,
                            next_ancestors
                        )
                    )

            except Exception as exc:
                errors.append({
                    "stage": "children",
                    "depth": depth,
                    "name": name,
                    "automation_id": automation_id,
                    "error": (
                        f"{type(exc).__name__}: {exc}"
                    )
                })

        except Exception as exc:
            errors.append({
                "stage": "element",
                "depth": depth,
                "error": (
                    f"{type(exc).__name__}: {exc}"
                ),
                "traceback": traceback.format_exc()
            })

    return {
        "scanned_controls": scanned,
        "candidate_count": len(candidates),
        "candidates": candidates,
        "errors": errors
    }


# ============================================================
# CLASSIFY CANDIDATES
# ============================================================

def classify_candidates(
    scan_result: Dict[str, Any]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    candidates = scan_result["candidates"]

    scored = {
        "work_order": [],
        "formula": [],
        "batch": [],
        "incomplete_mb": [],
        "last_mb": [],
    }

    # ========================================================
    # SCORE ALL
    # ========================================================

    for index, candidate in enumerate(candidates):

        candidate_base = {
            "index": index,
            "name": candidate["name"],
            "value": candidate["value"],
            "value_method": candidate["value_method"],
            "automation_id": candidate["automation_id"],
            "control_type": candidate["control_type"],
            "class_name": candidate["class_name"],
            "framework_id": candidate["framework_id"],
            "depth": candidate["depth"],
            "ancestor_text": candidate["ancestor_text"],
        }

        if (
            candidate["control_type"] == "edit"
            or "edit" in candidate["control_type"]
        ):
            score, reasons = score_work_order(candidate)

            scored["work_order"].append({
                **candidate_base,
                "score": score,
                "reasons": reasons,
                "element": candidate["element"],
            })

            score, reasons = score_formula(candidate)

            scored["formula"].append({
                **candidate_base,
                "score": score,
                "reasons": reasons,
                "element": candidate["element"],
            })

            score, reasons = score_batch(candidate)

            scored["batch"].append({
                **candidate_base,
                "score": score,
                "reasons": reasons,
                "element": candidate["element"],
            })

        if (
            candidate["control_type"] == "button"
            or "button" in candidate["control_type"]
        ):
            score, reasons = score_incomplete_button(
                candidate
            )

            scored["incomplete_mb"].append({
                **candidate_base,
                "score": score,
                "reasons": reasons,
                "element": candidate["element"],
            })

            score, reasons = score_last_mb_button(
                candidate
            )

            scored["last_mb"].append({
                **candidate_base,
                "score": score,
                "reasons": reasons,
                "element": candidate["element"],
            })

    # ========================================================
    # SORT
    # ========================================================

    for field in scored:
        scored[field].sort(
            key=lambda item: item["score"],
            reverse=True
        )

    # ========================================================
    # SELECT
    # ========================================================

    selected = {}

    # Field threshold sengaja tidak terlalu tinggi.
    # Semantic context akan sangat membantu bila tersedia.
    #
    # Jika tidak ada semantic label, value characteristics
    # masih dapat memberikan candidate score.

    for field in [
        "work_order",
        "formula",
        "batch",
    ]:
        ranked = scored[field]

        if ranked and ranked[0]["score"] > 0:
            selected[field] = ranked[0]

    for field in [
        "incomplete_mb",
        "last_mb",
    ]:
        ranked = scored[field]

        if ranked and ranked[0]["score"] > 0:
            selected[field] = ranked[0]

    return selected, scored


# ============================================================
# READ SELECTED FIELD
# ============================================================

def refresh_selected_value(
    selected: Dict[str, Any],
    field: str
) -> Dict[str, Any]:
    item = selected.get(field)

    if not item:
        return {
            "status": "not_found",
            "value": "",
            "exists": False,
            "enabled": False
        }

    element = item.get("element")

    if field in {
        "incomplete_mb",
        "last_mb",
    }:
        state = get_button_state(element)

        return {
            "status": "found",
            "value": "",
            "exists": state["exists"],
            "enabled": state["enabled"],
            "diagnostic": {
                "score": item["score"],
                "reasons": item["reasons"],
                "name": item["name"],
                "automation_id": item["automation_id"],
                "control_type": item["control_type"],
                "class_name": item["class_name"],
            }
        }

    value_info = get_element_value_diagnostic(
        element
    )

    value = value_info["value"]

    return {
        "status": (
            "found_value"
            if value
            else "found_empty"
        ),
        "value": value,
        "exists": True,
        "enabled": True,
        "value_method": value_info["method"],
        "diagnostic": {
            "score": item["score"],
            "reasons": item["reasons"],
            "name": item["name"],
            "automation_id": item["automation_id"],
            "control_type": item["control_type"],
            "class_name": item["class_name"],
            "ancestor_text": item["ancestor_text"],
        }
    }


# ============================================================
# EXTRACTION
# ============================================================

def extract_target_fields(
    element: UIAWrapper
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Full adaptive discovery.

    Return:
        normalized fields
        diagnostic
    """

    scan_result = scan_ui_tree(element)

    selected, scored = classify_candidates(
        scan_result
    )

    work_order = refresh_selected_value(
        selected,
        "work_order"
    )

    formula = refresh_selected_value(
        selected,
        "formula"
    )

    batch = refresh_selected_value(
        selected,
        "batch"
    )

    incomplete_mb = refresh_selected_value(
        selected,
        "incomplete_mb"
    )

    last_mb = refresh_selected_value(
        selected,
        "last_mb"
    )

    extracted = {
        "work_order": work_order.get(
            "value",
            ""
        ),
        "formula": formula.get(
            "value",
            ""
        ),
        "batch": batch.get(
            "value",
            ""
        ),
        "incomplete_mb": {
            "exists": bool(
                incomplete_mb.get(
                    "exists",
                    False
                )
            ),
            "enabled": bool(
                incomplete_mb.get(
                    "enabled",
                    False
                )
            )
        },
        "last_mb": {
            "exists": bool(
                last_mb.get(
                    "exists",
                    False
                )
            ),
            "enabled": bool(
                last_mb.get(
                    "enabled",
                    False
                )
            )
        }
    }

    diagnostic = {
        "timestamp": now_string(),
        "scanned_controls": scan_result[
            "scanned_controls"
        ],
        "candidate_count": scan_result[
            "candidate_count"
        ],
        "fields": {
            "work_order": work_order,
            "formula": formula,
            "batch": batch,
            "incomplete_mb": incomplete_mb,
            "last_mb": last_mb,
        },
        "ranked_candidates": {},
        "scan_errors": scan_result["errors"],
    }

    # ========================================================
    # Diagnostic candidate list.
    # Jangan memasukkan UIA object ke JSON.
    # ========================================================

    for field, ranked in scored.items():

        diagnostic["ranked_candidates"][field] = []

        for candidate in ranked[:10]:
            diagnostic["ranked_candidates"][field].append({
                "score": candidate["score"],
                "name": candidate["name"],
                "value": candidate["value"],
                "value_method": candidate["value_method"],
                "automation_id": candidate[
                    "automation_id"
                ],
                "control_type": candidate[
                    "control_type"
                ],
                "class_name": candidate[
                    "class_name"
                ],
                "framework_id": candidate[
                    "framework_id"
                ],
                "depth": candidate["depth"],
                "ancestor_text": candidate[
                    "ancestor_text"
                ],
                "reasons": candidate["reasons"],
            })

    return extracted, diagnostic


# ============================================================
# NORMALIZATION
# ============================================================

def normalize_target_state(
    extracted: dict
) -> dict:
    return {
        "work_order": safe_str(
            extracted.get(
                "work_order",
                ""
            )
        ),
        "formula": safe_str(
            extracted.get(
                "formula",
                ""
            )
        ),
        "batch": safe_str(
            extracted.get(
                "batch",
                ""
            )
        ),
        "incomplete_mb": extracted.get(
            "incomplete_mb",
            {
                "exists": False,
                "enabled": False
            }
        ),
        "last_mb": extracted.get(
            "last_mb",
            {
                "exists": False,
                "enabled": False
            }
        )
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
            ) as f:
                data = json.load(f)

            if (
                isinstance(data, dict)
                and "captures" in data
            ):
                return data

        except Exception as exc:
            print(
                f"[LOG-WARNING] Cannot load "
                f"{JSON_LOG_FILE}: "
                f"{type(exc).__name__}: {exc}"
            )

    return {
        "tool": "capture.py",
        "target": {},
        "captures": []
    }


def save_json_log(data: dict):
    temp_file = JSON_LOG_FILE + ".tmp"

    try:
        with open(
            temp_file,
            "w",
            encoding="utf-8"
        ) as f:
            json.dump(
                data,
                f,
                indent=2,
                ensure_ascii=False
            )

        os.replace(
            temp_file,
            JSON_LOG_FILE
        )

    except Exception as exc:
        print(
            f"[LOG-ERROR] Cannot save "
            f"{JSON_LOG_FILE}: "
            f"{type(exc).__name__}: {exc}"
        )


# ============================================================
# DEBUG LOG
# ============================================================

def save_debug_log(
    debug_data: Dict[str, Any]
):
    temp_file = DEBUG_LOG_FILE + ".tmp"

    try:
        with open(
            temp_file,
            "w",
            encoding="utf-8"
        ) as f:
            json.dump(
                debug_data,
                f,
                indent=2,
                ensure_ascii=False
            )

        os.replace(
            temp_file,
            DEBUG_LOG_FILE
        )

    except Exception as exc:
        print(
            f"[DEBUG-LOG-ERROR] "
            f"{type(exc).__name__}: {exc}"
        )


# ============================================================
# DIAGNOSTIC PRINT
# ============================================================

def print_field_diagnostic(
    field_name: str,
    result: Dict[str, Any]
):
    status = result.get(
        "status",
        "unknown"
    )

    value = result.get(
        "value",
        ""
    )

    diagnostic = result.get(
        "diagnostic",
        {}
    )

    score = diagnostic.get(
        "score",
        0
    )

    reasons = diagnostic.get(
        "reasons",
        []
    )

    if status == "not_found":
        print(
            f"  [FIELD] {field_name}: "
            f"NOT_FOUND"
        )
        return

    if status == "found_empty":
        print(
            f"  [FIELD] {field_name}: "
            f"FOUND but VALUE EMPTY "
            f"(score={score})"
        )
    else:
        print(
            f"  [FIELD] {field_name}: "
            f"FOUND "
            f"(score={score})"
        )

    if value:
        print(
            f"           value={value}"
        )

    if reasons:
        print(
            f"           reason="
            f"{', '.join(reasons)}"
        )

    if diagnostic.get("automation_id"):
        print(
            f"           automation_id="
            f"{diagnostic['automation_id']}"
        )


# ============================================================
# MAIN
# ============================================================

def main():
    global last_discovery_debug_time
    global last_debug_save_time

    log_data = load_or_init_json_log()

    # ========================================================
    # IMPORTANT:
    #
    # Jangan menyimpan UIAWrapper sebagai identity permanen.
    #
    # target_win hanya runtime object dan akan selalu
    # direacquire.
    # ========================================================

    target_win = None
    target_info = None

    last_state = None
    window_was_found = False

    last_diagnostic = {}
    previous_window_signature = None

    try:
        while True:

            # =================================================
            # 1. WINDOW ATTACH / REATTACH
            # =================================================

            if target_win is None:

                if not window_was_found:
                    print(
                        "[WAITING] "
                        "Penimbangan FG not found"
                    )

                win, info = find_target_window()

                if win is None:
                    window_was_found = False
                    time.sleep(SEARCH_INTERVAL)
                    continue

                target_win = win
                target_info = info

                current_signature = (
                    info.get("pid"),
                    info.get("hwnd")
                )

                if (
                    previous_window_signature
                    and
                    current_signature
                    != previous_window_signature
                ):
                    print(
                        "[REATTACH] 3WS window identity changed"
                    )

                    print(
                        f"  Old PID/HWND : "
                        f"{previous_window_signature}"
                    )

                    print(
                        f"  New PID/HWND : "
                        f"{current_signature}"
                    )

                previous_window_signature = (
                    current_signature
                )

                log_data["target"] = {
                    **target_info,
                    "attached_at": now_string()
                }

                save_json_log(log_data)

                print(
                    f"[FOUND] Penimbangan FG attached "
                    f"(PID: {target_info['pid']}, "
                    f"HWND: {target_info['hwnd']})"
                )

                window_was_found = True

                # Fresh attach = reset state.
                last_state = None

            # =================================================
            # 2. ALWAYS REACQUIRE FRESH UIA WINDOW
            # =================================================

            try:
                fresh_win, fresh_info = reacquire_window(
                    target_info
                )

                if fresh_win is None:
                    raise RuntimeError(
                        "Unable to reacquire target window"
                    )

                target_win = fresh_win
                target_info = fresh_info

                # Jika PID/HWND berubah, reset state.
                fresh_signature = (
                    fresh_info.get("pid"),
                    fresh_info.get("hwnd")
                )

                if (
                    previous_window_signature
                    and
                    fresh_signature
                    != previous_window_signature
                ):
                    print(
                        "[REATTACH] Runtime window changed"
                    )

                    print(
                        f"  Previous : "
                        f"{previous_window_signature}"
                    )

                    print(
                        f"  Current  : "
                        f"{fresh_signature}"
                    )

                    previous_window_signature = (
                        fresh_signature
                    )

                    last_state = None

                # =================================================
                # 3. FRESH UI TREE DISCOVERY
                # =================================================

                extracted, diagnostic = (
                    extract_target_fields(
                        target_win
                    )
                )

                last_diagnostic = diagnostic

                current_state = (
                    normalize_target_state(
                        extracted
                    )
                )

                # =================================================
                # 4. DEBUG STATUS
                # =================================================

                work_order_result = (
                    diagnostic["fields"]["work_order"]
                )

                formula_result = (
                    diagnostic["fields"]["formula"]
                )

                batch_result = (
                    diagnostic["fields"]["batch"]
                )

                incomplete_result = (
                    diagnostic["fields"]["incomplete_mb"]
                )

                last_mb_result = (
                    diagnostic["fields"]["last_mb"]
                )

                # Print diagnostic periodically OR ketika
                # field belum lengkap.

                current_time = time.time()

                data_ready = bool(
                    current_state["work_order"]
                    and (
                        current_state["formula"]
                        or
                        current_state["batch"]
                    )
                )

                should_print_debug = (
                    not data_ready
                    and (
                        current_time
                        - last_discovery_debug_time
                        >= DISCOVERY_PRINT_INTERVAL
                    )
                )

                if should_print_debug:
                    print(
                        "\n[DISCOVERY-STATUS]"
                    )

                    print(
                        f"  Controls scanned : "
                        f"{diagnostic['scanned_controls']}"
                    )

                    print(
                        f"  Candidates       : "
                        f"{diagnostic['candidate_count']}"
                    )

                    print_field_diagnostic(
                        "Work Order",
                        work_order_result
                    )

                    print_field_diagnostic(
                        "Formula",
                        formula_result
                    )

                    print_field_diagnostic(
                        "Batch",
                        batch_result
                    )

                    print_field_diagnostic(
                        "Incomplete MB",
                        incomplete_result
                    )

                    print_field_diagnostic(
                        "Master Box Terakhir",
                        last_mb_result
                    )

                    if diagnostic["scan_errors"]:
                        print(
                            f"  [SCAN ERRORS] "
                            f"{len(diagnostic['scan_errors'])}"
                        )

                    last_discovery_debug_time = (
                        current_time
                    )

                # =================================================
                # 5. SAVE DEBUG JSON
                # =================================================

                if (
                    current_time
                    - last_debug_save_time
                    >= DEBUG_SAVE_INTERVAL
                ):
                    debug_output = {
                        "tool": "capture.py",
                        "timestamp": now_string(),
                        "target": target_info,
                        "state": {
                            "work_order": current_state[
                                "work_order"
                            ],
                            "formula": current_state[
                                "formula"
                            ],
                            "batch": current_state[
                                "batch"
                            ],
                            "incomplete_mb": current_state[
                                "incomplete_mb"
                            ],
                            "last_mb": current_state[
                                "last_mb"
                            ],
                        },
                        "data_ready": data_ready,
                        "diagnostic": diagnostic
                    }

                    save_debug_log(
                        debug_output
                    )

                    last_debug_save_time = (
                        current_time
                    )

                # =================================================
                # 6. WAITING FOR DATA
                # =================================================

                if not data_ready:

                    # Jangan membuat event capture.
                    #
                    # Tetap monitor sampai user mengisi data.

                    if (
                        current_state["work_order"]
                        or current_state["formula"]
                        or current_state["batch"]
                    ):
                        print(
                            "[WAITING_FOR_DATA] "
                            "Partial data detected; "
                            "continuing discovery."
                        )

                    last_state = None

                    time.sleep(
                        MONITOR_INTERVAL
                    )

                    continue

                # =================================================
                # 7. DATA READY
                # =================================================

                if current_state != last_state:

                    timestamp = now_string()

                    if last_state is None:
                        event_type = (
                            "activity_detected"
                        )
                    else:
                        event_type = (
                            "data_changed"
                        )

                    event_entry = {
                        "timestamp": timestamp,
                        "event": event_type,
                        "work_order": current_state[
                            "work_order"
                        ],
                        "formula": current_state[
                            "formula"
                        ],
                        "batch": current_state[
                            "batch"
                        ],
                        "incomplete_mb": current_state[
                            "incomplete_mb"
                        ],
                        "last_mb": current_state[
                            "last_mb"
                        ]
                    }

                    log_data["captures"].append(
                        event_entry
                    )

                    save_json_log(
                        log_data
                    )

                    print(
                        f"\n[CAPTURE] {timestamp}"
                    )

                    print(
                        f"  Event              : "
                        f"{event_type}"
                    )

                    print(
                        f"  WO                 : "
                        f"{current_state['work_order']}"
                    )

                    print(
                        f"  Formula            : "
                        f"{current_state['formula']}"
                    )

                    print(
                        f"  Batch              : "
                        f"{current_state['batch']}"
                    )

                    print(
                        f"  Incomplete MB      : "
                        f"exists="
                        f"{str(current_state['incomplete_mb']['exists']).lower()} "
                        f"enabled="
                        f"{str(current_state['incomplete_mb']['enabled']).lower()}"
                    )

                    print(
                        f"  Master Box Terakhir: "
                        f"exists="
                        f"{str(current_state['last_mb']['exists']).lower()} "
                        f"enabled="
                        f"{str(current_state['last_mb']['enabled']).lower()}"
                    )

                    last_state = current_state

            except Exception as exc:

                print(
                    "\n[LOST] "
                    "Penimbangan FG unavailable"
                )

                print(
                    f"[LOST-REASON] "
                    f"{type(exc).__name__}: {exc}"
                )

                # Simpan diagnostic sebelum reset.
                last_diagnostic = {
                    **last_diagnostic,
                    "runtime_error": {
                        "timestamp": now_string(),
                        "error": (
                            f"{type(exc).__name__}: {exc}"
                        ),
                        "traceback": traceback.format_exc()
                    }
                }

                save_debug_log({
                    "tool": "capture.py",
                    "timestamp": now_string(),
                    "target": target_info,
                    "diagnostic": last_diagnostic
                })

                # =================================================
                # IMPORTANT:
                # Buang object UIA lama.
                # Jangan pernah dipakai lagi.
                # =================================================

                target_win = None
                target_info = None

                last_state = None
                window_was_found = False

                previous_window_signature = None

                time.sleep(
                    SEARCH_INTERVAL
                )

                continue

            time.sleep(
                MONITOR_INTERVAL
            )

    except KeyboardInterrupt:

        print(
            "\n[STOP] Capture stopped."
        )

        save_json_log(
            log_data
        )

        save_debug_log({
            "tool": "capture.py",
            "timestamp": now_string(),
            "status": "stopped",
            "target": target_info,
            "last_diagnostic": last_diagnostic
        })

        sys.exit(0)


if __name__ == "__main__":
    main()
