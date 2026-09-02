import os
import sys
import time
import json
import uuid
import socket
import getpass
import logging
import threading
import sqlite3
import re
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler

import requests
from pynput import mouse

from pywinauto import Application, Desktop
from pywinauto.controls.uiawrapper import UIAWrapper


# ============================================================
# CONSTANTS & CONFIGURATION
# ============================================================

APP_NAME = "B7_3WS"
AGENT_VERSION = "1.0.0"

# Fallback ONLY.
# Kalau config.json punya server_url, nilai config.json yang dipakai.
DEFAULT_SERVER_URL = "http://localhost:2005"

HEARTBEAT_INTERVAL = 30
EXTRACTION_INTERVAL = 1.0
QUEUE_FLUSH_INTERVAL = 5.0

TARGET_PROCESS_NAMES = {
    "3ws.exe",
    "3ws.net.exe",
}

TARGET_WINDOW_TITLE_KEYWORDS = [
    "Penimbangan FG",
]

MAX_TREE_DEPTH = 12

# Safety guard.
MAX_CONTROLS = 3000

# Diagnostic interval.
EXTRACTION_DIAGNOSTIC_INTERVAL = 5.0

# Slow extraction threshold.
EXTRACTION_SLOW_THRESHOLD = 3.0

# Proven V1 automation IDs.
# Semantic extraction tetap primary.
# ID ini hanya fallback kalau semantic gagal.
V1_AUTOMATION_IDS = {
    "1705480": "work_order",
    "395160": "formula",
    "1050396": "batch",
    "btnIncompleteMB": "incomplete_mb",
    "btnLastMB": "last_mb",
}


# ============================================================
# USER DATA DIRECTORY
# ============================================================

APPDATA_DIR = os.path.join(
    os.environ.get(
        "APPDATA",
        os.path.expanduser("~")
    ),
    APP_NAME
)

os.makedirs(
    APPDATA_DIR,
    exist_ok=True
)

CONFIG_PATH = os.path.join(
    APPDATA_DIR,
    "config.json"
)

DB_PATH = os.path.join(
    APPDATA_DIR,
    "agent_queue.db"
)

LOG_PATH = os.path.join(
    APPDATA_DIR,
    "diagnostic.log"
)

BATCH_HISTORY_PATH = os.path.join(
    APPDATA_DIR,
    "batch_history.json"
)


# ============================================================
# LOGGER
# ============================================================

def setup_logger():

    logger_obj = logging.getLogger(
        "B7CaptureAgent"
    )

    if logger_obj.handlers:
        return logger_obj

    logger_obj.setLevel(
        logging.INFO
    )

    formatter = logging.Formatter(
        "%(asctime)s - [%(levelname)s] - %(message)s"
    )

    console_handler = logging.StreamHandler(
        sys.stdout
    )

    console_handler.setLevel(
        logging.INFO
    )

    console_handler.setFormatter(
        formatter
    )

    file_handler = RotatingFileHandler(
        LOG_PATH,
        maxBytes=2 * 1024 * 1024,
        backupCount=2,
        encoding="utf-8"
    )

    file_handler.setLevel(
        logging.INFO
    )

    file_handler.setFormatter(
        formatter
    )

    logger_obj.addHandler(
        console_handler
    )

    logger_obj.addHandler(
        file_handler
    )

    return logger_obj


logger = setup_logger()


# ============================================================
# TEXT HELPERS
# ============================================================

def normalize_text(value):

    if value is None:
        return ""

    try:
        value = str(value)
    except Exception:
        return ""

    value = value.replace(
        "\r",
        " "
    )

    value = value.replace(
        "\n",
        " "
    )

    value = re.sub(
        r"\s+",
        " ",
        value
    )

    return value.strip()


def clean_value(value):

    return normalize_text(
        value
    )


def lower_text(value):

    return normalize_text(
        value
    ).lower()


# ============================================================
# BATCH HISTORY
# ============================================================

def update_batch_history(
    batch_identity_key,
    batch_data
):

    try:

        history = []

        if os.path.exists(
            BATCH_HISTORY_PATH
        ):

            try:

                with open(
                    BATCH_HISTORY_PATH,
                    "r",
                    encoding="utf-8"
                ) as f:

                    history = json.load(f)

                if not isinstance(
                    history,
                    list
                ):
                    history = []

            except Exception:

                history = []

        existing_index = -1

        for idx, item in enumerate(
            history
        ):

            if item.get(
                "identity"
            ) == batch_identity_key:

                existing_index = idx
                break

        now = datetime.now(
            timezone.utc
        ).isoformat()

        if existing_index >= 0:

            history[
                existing_index
            ]["updated_at"] = now

            history[
                existing_index
            ]["data"] = batch_data

        else:

            history.append({
                "identity": batch_identity_key,
                "created_at": now,
                "updated_at": now,
                "data": batch_data
            })

        history.sort(
            key=lambda x: x.get(
                "updated_at",
                ""
            )
        )

        if len(history) > 5:
            history = history[-5:]

        with open(
            BATCH_HISTORY_PATH,
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                history,
                f,
                indent=2,
                ensure_ascii=False
            )

    except Exception as e:

        logger.error(
            "BATCH HISTORY ERROR: "
            f"{type(e).__name__}: {e}"
        )


# ============================================================
# CONFIGURATION
# ============================================================

def load_or_create_config():

    config = {
        "agent_id": str(
            uuid.uuid4()
        ),
        "server_url": DEFAULT_SERVER_URL
    }

    if os.path.exists(
        CONFIG_PATH
    ):

        try:

            with open(
                CONFIG_PATH,
                "r",
                encoding="utf-8"
            ) as f:

                saved_config = json.load(f)

            if isinstance(
                saved_config,
                dict
            ):

                config["agent_id"] = saved_config.get(
                    "agent_id",
                    config["agent_id"]
                )

                config["server_url"] = saved_config.get(
                    "server_url",
                    config["server_url"]
                )

        except Exception as e:

            logger.error(
                "CONFIG READ ERROR: "
                f"{type(e).__name__}: {e}"
            )

    try:

        with open(
            CONFIG_PATH,
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                config,
                f,
                indent=2
            )

    except Exception as e:

        logger.error(
            "CONFIG WRITE ERROR: "
            f"{type(e).__name__}: {e}"
        )

    return config


# ============================================================
# SQLITE OFFLINE QUEUE
# ============================================================

class SQLiteQueue:

    def __init__(
        self,
        db_path
    ):

        self.db_path = db_path

        self._init_db()

    def _get_connection(self):

        return sqlite3.connect(
            self.db_path,
            timeout=10
        )

    def _init_db(self):

        with self._get_connection() as conn:

            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS queue_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT UNIQUE NOT NULL,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    created_at TEXT NOT NULL,
                    sent_at TEXT,
                    attempt_count INTEGER DEFAULT 0,
                    last_error TEXT
                )
            """)

            conn.commit()

    def enqueue(
        self,
        event_id,
        event_type,
        payload
    ):

        payload_str = json.dumps(
            payload,
            ensure_ascii=False
        )

        now_iso = datetime.now(
            timezone.utc
        ).isoformat()

        try:

            with self._get_connection() as conn:

                cursor = conn.cursor()

                cursor.execute("""
                    INSERT INTO queue_events (
                        event_id,
                        event_type,
                        payload_json,
                        status,
                        created_at
                    )
                    VALUES (?, ?, ?, 'PENDING', ?)
                """, (
                    event_id,
                    event_type,
                    payload_str,
                    now_iso
                ))

                conn.commit()

            logger.info(
                f"QUEUE INSERTED: "
                f"{event_id} [{event_type}]"
            )

            return True

        except sqlite3.IntegrityError:

            logger.warning(
                f"QUEUE DUPLICATE EVENT: {event_id}"
            )

            return False

        except Exception as e:

            logger.error(
                "QUEUE INSERT ERROR: "
                f"{type(e).__name__}: {e}"
            )

            return False

    def get_pending_events(self):

        events = []

        try:

            with self._get_connection() as conn:

                cursor = conn.cursor()

                cursor.execute("""
                    SELECT
                        id,
                        event_id,
                        event_type,
                        payload_json,
                        attempt_count
                    FROM queue_events
                    WHERE status = 'PENDING'
                    ORDER BY id ASC
                """)

                rows = cursor.fetchall()

                for row in rows:

                    try:

                        payload = json.loads(
                            row[3]
                        )

                    except Exception:

                        payload = {}

                    events.append({
                        "id": row[0],
                        "event_id": row[1],
                        "event_type": row[2],
                        "payload": payload,
                        "attempt_count": row[4]
                    })

        except Exception as e:

            logger.error(
                "QUEUE READ ERROR: "
                f"{type(e).__name__}: {e}"
            )

        return events

    def mark_sent(
        self,
        event_id
    ):

        now_iso = datetime.now(
            timezone.utc
        ).isoformat()

        try:

            with self._get_connection() as conn:

                cursor = conn.cursor()

                cursor.execute("""
                    UPDATE queue_events
                    SET
                        status = 'SENT',
                        sent_at = ?
                    WHERE event_id = ?
                """, (
                    now_iso,
                    event_id
                ))

                conn.commit()

        except Exception as e:

            logger.error(
                "QUEUE MARK SENT ERROR: "
                f"{type(e).__name__}: {e}"
            )

    def increment_attempt(
        self,
        event_id,
        error_msg
    ):

        try:

            with self._get_connection() as conn:

                cursor = conn.cursor()

                cursor.execute("""
                    UPDATE queue_events
                    SET
                        attempt_count = attempt_count + 1,
                        last_error = ?
                    WHERE event_id = ?
                """, (
                    str(error_msg),
                    event_id
                ))

                conn.commit()

        except Exception as e:

            logger.error(
                "QUEUE ATTEMPT ERROR: "
                f"{type(e).__name__}: {e}"
            )


# ============================================================
# HTTP API CLIENT
# ============================================================

class APIClient:

    def __init__(
        self,
        base_url,
        agent_id
    ):

        self.base_url = base_url.rstrip(
            "/"
        )

        self.agent_id = agent_id

        self.hostname = socket.gethostname()

        self.username = getpass.getuser()

    def register(self):

        url = (
            f"{self.base_url}"
            "/api/agent/register"
        )

        payload = {
            "agent_id": self.agent_id,
            "hostname": self.hostname,
            "username": self.username,
            "agent_version": AGENT_VERSION
        }

        try:

            response = requests.post(
                url,
                json=payload,
                timeout=5
            )

            if response.status_code == 200:

                logger.info(
                    "AGENT REGISTERED SUCCESSFULLY"
                )

                return True

            logger.warning(
                "REGISTRATION STATUS: "
                f"HTTP {response.status_code} - "
                f"{response.text}"
            )

        except Exception as e:

            logger.error(
                "REGISTRATION FAILED: "
                f"{type(e).__name__}: {e}"
            )

        return False

    def send_heartbeat(self):

        url = (
            f"{self.base_url}"
            "/api/agent/heartbeat"
        )

        payload = {
            "agent_id": self.agent_id,
            "hostname": self.hostname,
            "agent_version": AGENT_VERSION
        }

        try:

            response = requests.post(
                url,
                json=payload,
                timeout=5
            )

            return response.status_code == 200

        except Exception:

            return False

    def send_event(
        self,
        payload
    ):

        url = (
            f"{self.base_url}"
            "/api/agent/events"
        )

        try:

            response = requests.post(
                url,
                json=payload,
                timeout=5
            )

            if response.status_code == 200:

                return True, ""

            return (
                False,
                f"HTTP {response.status_code}: "
                f"{response.text}"
            )

        except Exception as e:

            return False, str(e)


# ============================================================
# DATA NORMALIZATION
# ============================================================

def parse_nomor_mb(
    mb_str
):

    if not mb_str:
        return 0

    clean_str = re.sub(
        r"[^\d]",
        "",
        str(mb_str)
    )

    if clean_str.isdigit():

        return int(
            clean_str
        )

    return 0


def parse_pallet_suffix(
    pallet_str
):

    if not pallet_str:
        return 0

    value = normalize_text(
        pallet_str
    )

    match = re.search(
        r"(?:^|[-_/])(\d+)$",
        value
    )

    if match:

        try:

            return int(
                match.group(1)
            )

        except Exception:

            pass

    parts = value.split(
        "-"
    )

    if parts:

        last_part = re.sub(
            r"[^\d]",
            "",
            parts[-1]
        )

        if last_part.isdigit():

            return int(
                last_part
            )

    return 0


def parse_master_box(
    mb_str
):

    if not mb_str:
        return 0

    clean_str = re.sub(
        r"[^\d]",
        "",
        str(mb_str)
    )

    if clean_str.isdigit():

        return int(
            clean_str
        )

    return 0


# ============================================================
# UIA VALUE READER
# ============================================================

def get_element_value(
    element
):

    # --------------------------------------------------------
    # 1. UIA ValuePattern
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
    # 2. pywinauto texts()
    # --------------------------------------------------------

    try:

        texts = element.texts()

        if texts:

            values = []

            for text in texts:

                text = normalize_text(
                    text
                )

                if text:
                    values.append(
                        text
                    )

            if values:

                return " | ".join(
                    values
                )

    except Exception:
        pass

    # --------------------------------------------------------
    # 3. Legacy IAccessible
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

    # --------------------------------------------------------
    # 4. window_text
    # --------------------------------------------------------

    try:

        value = normalize_text(
            element.window_text()
        )

        if value:
            return value

    except Exception:
        pass

    return ""


# ============================================================
# UIA CONTROL COLLECTION
# ============================================================

def collect_controls(
    root,
    controls=None,
    depth=0
):

    if controls is None:
        controls = []

    if depth > MAX_TREE_DEPTH:
        return controls

    if len(controls) >= MAX_CONTROLS:
        return controls

    try:

        info = root.element_info

        name = normalize_text(
            getattr(
                info,
                "name",
                ""
            )
        )

        control_type = normalize_text(
            getattr(
                info,
                "control_type",
                ""
            )
        ).lower()

        class_name = normalize_text(
            getattr(
                info,
                "class_name",
                ""
            )
        )

        automation_id = normalize_text(
            getattr(
                info,
                "automation_id",
                ""
            )
        )

        framework_id = normalize_text(
            getattr(
                info,
                "framework_id",
                ""
            )
        )

        value = ""

        readable_types = {
            "edit",
            "document",
            "text",
            "button",
            "combo box",
            "list item",
            "custom"
        }

        if control_type in readable_types:

            value = get_element_value(
                root
            )

        # ----------------------------------------------------
        # Ancestor context
        # ----------------------------------------------------

        ancestor_text = []

        try:

            parent = root.parent()

            for _ in range(5):

                if not parent:
                    break

                try:

                    parent_info = parent.element_info

                    parent_name = normalize_text(
                        getattr(
                            parent_info,
                            "name",
                            ""
                        )
                    )

                    parent_value = ""

                    parent_type = normalize_text(
                        getattr(
                            parent_info,
                            "control_type",
                            ""
                        )
                    ).lower()

                    if parent_type in readable_types:

                        parent_value = get_element_value(
                            parent
                        )

                    combined_parent = " ".join(
                        x
                        for x in [
                            parent_name,
                            parent_value
                        ]
                        if x
                    )

                    if combined_parent:

                        ancestor_text.append(
                            combined_parent
                        )

                except Exception:
                    pass

                try:

                    parent = parent.parent()

                except Exception:

                    break

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
            "ancestor_text": " | ".join(
                ancestor_text
            )
        })

    except Exception as e:

        logger.warning(
            "UIA CONTROL READ ERROR: "
            f"depth={depth}, "
            f"controls={len(controls)}, "
            f"{type(e).__name__}: {e}"
        )

        return controls

    # --------------------------------------------------------
    # Children
    # --------------------------------------------------------

    if len(controls) >= MAX_CONTROLS:

        logger.warning(
            "UIA TREE LIMIT REACHED: "
            f"{MAX_CONTROLS} controls"
        )

        return controls

    try:

        children = root.children()

        for child in children:

            if len(controls) >= MAX_CONTROLS:

                logger.warning(
                    "UIA TREE LIMIT REACHED: "
                    f"{MAX_CONTROLS} controls"
                )

                break

            collect_controls(
                child,
                controls,
                depth + 1
            )

    except Exception as e:

        logger.warning(
            "UIA CHILDREN ERROR: "
            f"depth={depth}, "
            f"controls={len(controls)}, "
            f"{type(e).__name__}: {e}"
        )

    return controls


# ============================================================
# CONTROL CONTEXT
# ============================================================

def control_context(
    control
):

    return " ".join([
        lower_text(
            control.get(
                "name",
                ""
            )
        ),
        lower_text(
            control.get(
                "value",
                ""
            )
        ),
        lower_text(
            control.get(
                "ancestor_text",
                ""
            )
        )
    ])


# ============================================================
# LABEL/VALUE CLEANERS
# ============================================================

def strip_label(
    value,
    labels
):

    value = normalize_text(
        value
    )

    if not value:
        return ""

    for label in labels:

        pattern = (
            r"^\s*"
            + re.escape(label)
            + r"\s*:?\s*"
        )

        cleaned = re.sub(
            pattern,
            "",
            value,
            flags=re.IGNORECASE
        ).strip()

        if cleaned != value:

            return cleaned

    return value


def extract_work_order_value(
    value
):

    return strip_label(
        value,
        ["Work Order"]
    )


def extract_formula_value(
    value
):

    return strip_label(
        value,
        ["Formula"]
    )


def extract_batch_value(
    value
):

    return strip_label(
        value,
        [
            "Nomor Batch",
            "Batch"
        ]
    )


def extract_pallet_value(
    value
):

    return strip_label(
        value,
        [
            "Nomor Pallet",
            "Pallet"
        ]
    )


def extract_nomor_mb_value(
    value
):

    value = normalize_text(
        value
    )

    value = strip_label(
        value,
        [
            "Nomor MB",
            "No MB"
        ]
    )

    match = re.search(
        r"\b(\d{1,8})\b",
        value
    )

    if match:

        return match.group(1)

    return value


def extract_master_box_value(
    value
):

    value = normalize_text(
        value
    )

    value = strip_label(
        value,
        ["Master Box"]
    )

    match = re.search(
        r"\b(\d{1,8})\b",
        value
    )

    if match:

        return match.group(1)

    return value


# ============================================================
# SEMANTIC SCORING
# ============================================================

def score_work_order(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    if control.get("control_type") not in {
        "edit",
        "text",
        "document",
        "combo box",
        "custom"
    }:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

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
        and
        "informasi work order" in context
    ):
        score += 50

    if re.search(r"\d", value):
        score += 20

    if re.search(r"[-/]", value):
        score += 15

    return score


def score_product(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    if control.get("control_type") not in {
        "edit",
        "text",
        "document",
        "combo box",
        "custom"
    }:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    keywords = [
        "kode produk",
        "code produk",
        "product code",
        "product",
        "kode material",
        "material code",
        "material"
    ]

    score = 0

    for keyword in keywords:

        if keyword in name:
            score += 200

        if keyword in context:
            score += 100

    if "informasi work order" in context:
        score += 40

    return score


def score_formula(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    if control.get("control_type") not in {
        "edit",
        "text",
        "document",
        "combo box",
        "custom"
    }:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    score = 0

    if "formula" in name:
        score += 240

    if "formula" in context:
        score += 160

    if "informasi work order" in context:
        score += 40

    if re.fullmatch(
        r"[A-Za-z0-9._/-]+",
        value
    ):
        score += 20

    return score


def score_batch(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    if control.get("control_type") not in {
        "edit",
        "text",
        "document",
        "combo box",
        "custom"
    }:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

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

    if re.search(r"[A-Za-z]", value):
        score += 20

    if re.search(r"\d", value):
        score += 20

    return score


def score_machine(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    score = 0

    if "penimbang" in name:
        score += 200

    if "penimbang" in context:
        score += 130

    if "machine" in name:
        score += 180

    if "mesin" in name:
        score += 180

    return score


def score_packer(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    score = 0

    if "pengepak" in name:
        score += 300

    if "pengepak" in context:
        score += 220

    if "packer" in name:
        score += 250

    if "packer" in context:
        score += 180

    return score


def score_scale(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    score = 0

    if "timbangan" in name:
        score += 300

    if "timbangan" in context:
        score += 220

    if "scale" in name:
        score += 250

    if "scale" in context:
        score += 180

    return score


def score_pallet(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    control_type = control.get(
        "control_type",
        ""
    )

    if control_type not in {
        "edit",
        "text",
        "document",
        "combo box",
        "list item",
        "custom"
    }:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    score = 0

    if name == "nomor pallet":
        score += 500

    if "nomor pallet" in name:
        score += 450

    if "nomor pallet" in context:
        score += 250

    if "pallet" in name:
        score += 200

    if "pallet" in context:
        score += 100

    if re.fullmatch(
        r"[A-Za-z]+(?:-[A-Za-z0-9]+)+",
        value
    ):
        score += 40

    if re.search(r"\d", value):
        score += 20

    return score


def score_nomor_mb(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    control_type = control.get(
        "control_type",
        ""
    )

    if control_type not in {
        "edit",
        "text",
        "document",
        "combo box",
        "list item",
        "custom"
    }:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    score = 0

    if name == "nomor mb":
        score += 600

    if "nomor mb" in name:
        score += 550

    if "nomor mb" in context:
        score += 350

    if "no mb" in name:
        score += 500

    if "no mb" in context:
        score += 300

    if "master box" in name:
        score -= 500

    if (
        "master box" in context
        and
        "nomor mb" not in context
    ):
        score -= 300

    if re.search(r"\d", value):
        score += 50

    return max(
        score,
        0
    )


def score_master_box(control):

    value = normalize_text(
        control.get("value", "")
    )

    if not value:
        return 0

    control_type = control.get(
        "control_type",
        ""
    )

    if control_type not in {
        "edit",
        "text",
        "document",
        "combo box",
        "list item",
        "button",
        "custom"
    }:
        return 0

    name = lower_text(
        control.get("name", "")
    )

    context = control_context(
        control
    )

    score = 0

    if name == "master box":
        score += 600

    if "master box" in name:
        score += 500

    if "master box" in context:
        score += 350

    if re.fullmatch(
        r"\d+",
        value
    ):
        score += 100

    elif re.search(
        r"\d",
        value
    ):
        score += 40

    return max(
        score,
        0
    )


# ============================================================
# GENERIC BEST-CANDIDATE SELECTOR
# ============================================================

def select_best(
    controls,
    scorer,
    field_name=""
):

    candidates = []

    for control in controls:

        try:

            score = scorer(
                control
            )

            if score > 0:

                candidates.append({
                    "score": score,
                    "control": control
                })

        except Exception:

            continue

    candidates.sort(
        key=lambda x: x["score"],
        reverse=True
    )

    if not candidates:

        if field_name:

            logger.warning(
                f"CANDIDATE EMPTY: {field_name}"
            )

        return None

    best = candidates[0]["control"]

    if field_name:

        logger.info(
            f"CANDIDATE {field_name}: "
            f"score={candidates[0]['score']} | "
            f"name={best.get('name')!r} | "
            f"value={best.get('value')!r} | "
            f"type={best.get('control_type')!r} | "
            f"automation_id="
            f"{best.get('automation_id')!r}"
        )

    return best


# ============================================================
# BUTTON SCORING
# ============================================================

def score_button(
    control,
    keywords
):

    if control.get(
        "control_type"
    ) != "button":

        return 0

    name = lower_text(
        control.get("name", "")
    )

    value = lower_text(
        control.get("value", "")
    )

    context = control_context(
        control
    )

    score = 0

    for keyword in keywords:

        keyword = keyword.lower()

        if keyword == name:

            score += 500

        elif keyword in name:

            score += 350

        elif keyword in value:

            score += 300

        elif keyword in context:

            score += 200

    return score


def find_best_button(
    controls,
    keywords
):

    candidates = []

    for control in controls:

        try:

            score = score_button(
                control,
                keywords
            )

            if score > 0:

                candidates.append({
                    "score": score,
                    "control": control
                })

        except Exception:

            continue

    candidates.sort(
        key=lambda x: x["score"],
        reverse=True
    )

    if not candidates:
        return None

    return candidates[0]["control"]


def button_state(
    button
):

    if not button:

        return {
            "exists": False,
            "enabled": False
        }

    try:

        return {
            "exists": True,
            "enabled": bool(
                button[
                    "element"
                ].is_enabled()
            )
        }

    except Exception as e:

        logger.warning(
            "BUTTON STATE ERROR: "
            f"{type(e).__name__}: {e}"
        )

        return {
            "exists": True,
            "enabled": False
        }


# ============================================================
# V1 AUTOMATION ID FALLBACK
# ============================================================

def find_v1_control(
    controls,
    automation_id
):

    for control in controls:

        if normalize_text(
            control.get(
                "automation_id",
                ""
            )
        ) == automation_id:

            return control

    return None


def apply_v1_fallback(
    controls,
    data,
    selected_controls
):

    fallback_used = []

    for automation_id, field_name in V1_AUTOMATION_IDS.items():

        control = find_v1_control(
            controls,
            automation_id
        )

        if not control:
            continue

        value = normalize_text(
            control.get(
                "value",
                ""
            )
        )

        if field_name == "work_order":

            if not data["work_order"] and value:

                data["work_order"] = (
                    extract_work_order_value(
                        value
                    )
                )

                fallback_used.append(
                    "work_order"
                )

        elif field_name == "formula":

            if not data["formula"] and value:

                data["formula"] = (
                    extract_formula_value(
                        value
                    )
                )

                fallback_used.append(
                    "formula"
                )

        elif field_name == "batch":

            if not data["batch"] and value:

                data["batch"] = (
                    extract_batch_value(
                        value
                    )
                )

                fallback_used.append(
                    "batch"
                )

        elif field_name == "incomplete_mb":

            selected_controls[
                "incomplete_button"
            ] = control

        elif field_name == "last_mb":

            selected_controls[
                "last_mb_button"
            ] = control

    if fallback_used:

        logger.warning(
            "V1 FALLBACK USED: "
            + ", ".join(
                fallback_used
            )
        )

    return data


# ============================================================
# UIA EXTRACTION ENGINE
# ============================================================

class UIAExtractor:

    def __init__(self):

        self.app = None

        self.target_window = None

        self.target_pid = None

        self.target_hwnd = None

        self.last_control_snapshot = []

        self.last_extraction_log = 0

        self.last_tree_count = 0

        self.extraction_cycle = 0

        self.last_data_fingerprint = None

    # --------------------------------------------------------
    # FIND 3WS WINDOW
    # --------------------------------------------------------

    def find_3ws_window(
        self
    ):

        search_started = time.monotonic()

        logger.debug(
            "3WS SEARCH START"
        )

        # ----------------------------------------------------
        # UIA
        # ----------------------------------------------------

        try:

            desktop = Desktop(
                backend="uia"
            )

            windows = desktop.windows(
                title_re=".*Penimbangan FG.*",
                visible_only=True
            )

            logger.debug(
                f"3WS UIA WINDOWS CANDIDATES: "
                f"{len(windows)}"
            )

            for win in windows:

                try:

                    pid = (
                        win.element_info.process_id
                    )

                    if self._is_target_process(
                        pid
                    ):

                        self.target_window = win

                        self.target_pid = pid

                        try:

                            self.target_hwnd = win.handle

                        except Exception:

                            self.target_hwnd = None

                        elapsed = (
                            time.monotonic()
                            - search_started
                        )

                        logger.debug(
                            "3WS UIA WINDOW MATCHED: "
                            f"pid={pid}, "
                            f"hwnd={self.target_hwnd}, "
                            f"{elapsed:.3f}s"
                        )

                        return True

                except Exception as e:

                    logger.debug(
                        "3WS UIA WINDOW CHECK ERROR: "
                        f"{type(e).__name__}: {e}"
                    )

        except Exception as e:

            logger.warning(
                "3WS UIA SEARCH ERROR: "
                f"{type(e).__name__}: {e}"
            )

        # ----------------------------------------------------
        # Win32 fallback
        # ----------------------------------------------------

        try:

            desktop = Desktop(
                backend="win32"
            )

            windows = desktop.windows(
                title_re=".*Penimbangan FG.*",
                visible_only=True
            )

            logger.debug(
                f"3WS WIN32 WINDOWS CANDIDATES: "
                f"{len(windows)}"
            )

            for win in windows:

                try:

                    pid = (
                        win.element_info.process_id
                    )

                    if not self._is_target_process(
                        pid
                    ):
                        continue

                    hwnd = win.handle

                    app = Application(
                        backend="uia"
                    )

                    app.connect(
                        handle=hwnd
                    )

                    uia_win = app.window(
                        handle=hwnd
                    )

                    self.app = app

                    self.target_window = uia_win

                    self.target_pid = pid

                    self.target_hwnd = hwnd

                    logger.info(
                        "3WS FOUND VIA WIN32 -> UIA: "
                        f"pid={pid}, hwnd={hwnd}"
                    )

                    return True

                except Exception as e:

                    logger.debug(
                        "3WS WIN32 CANDIDATE ERROR: "
                        f"{type(e).__name__}: {e}"
                    )

        except Exception as e:

            logger.warning(
                "3WS WIN32 SEARCH ERROR: "
                f"{type(e).__name__}: {e}"
            )

        self.target_window = None

        self.target_pid = None

        self.target_hwnd = None

        return False

    # --------------------------------------------------------
    # PROCESS VALIDATION
    # --------------------------------------------------------

    def _is_target_process(
        self,
        pid
    ):

        if not pid:
            return False

        try:

            import psutil

            process = psutil.Process(
                pid
            )

            process_name = (
                process.name()
                .strip()
                .lower()
            )

            return (
                process_name
                in TARGET_PROCESS_NAMES
            )

        except Exception:

            # Title sudah cocok.
            # Kalau psutil tidak tersedia,
            # fallback tetap izinkan.
            return True

    # --------------------------------------------------------
    # WINDOW VALIDATION
    #
    # IMPORTANT:
    # UIAWrapper pada environment ini TIDAK punya .exists().
    #
    # Jangan panggil:
    #     self.target_window.exists()
    #
    # Kita validasi dengan akses ke element_info,
    # process_id, dan handle.
    # --------------------------------------------------------

    def _validate_window(
        self
    ):

        logger.info(
            "WINDOW VALIDATION START"
        )

        if self.target_window is None:

            logger.warning(
                "WINDOW VALIDATION FAILED: "
                "target_window is None"
            )

            return False

        try:

            # Jangan gunakan .exists().
            info = self.target_window.element_info

            if info is None:

                logger.warning(
                    "WINDOW VALIDATION FAILED: "
                    "element_info is None"
                )

                return False

            pid = getattr(
                info,
                "process_id",
                None
            )

            if not pid:

                logger.warning(
                    "WINDOW VALIDATION FAILED: "
                    "process_id unavailable"
                )

                return False

            # Refresh stored PID.
            self.target_pid = pid

            # Handle boleh gagal pada wrapper tertentu,
            # jadi tidak dianggap fatal kalau tidak tersedia.
            try:

                handle = self.target_window.handle

                if handle:
                    self.target_hwnd = handle

            except Exception as e:

                logger.warning(
                    "WINDOW HANDLE READ WARNING: "
                    f"{type(e).__name__}: {e}"
                )

            # Validasi process target.
            if not self._is_target_process(pid):

                logger.warning(
                    "WINDOW VALIDATION FAILED: "
                    f"PID {pid} is not target process"
                )

                self.target_window = None
                self.target_pid = None
                self.target_hwnd = None

                return False

            logger.info(
                "WINDOW VALIDATION OK: "
                f"pid={self.target_pid}, "
                f"hwnd={self.target_hwnd}"
            )

            return True

        except Exception as e:

            logger.exception(
                "WINDOW VALIDATION EXCEPTION: "
                f"{type(e).__name__}: {e}"
            )

            self.target_window = None
            self.target_pid = None
            self.target_hwnd = None

            return False

    # --------------------------------------------------------
    # EXTRACT DATA
    # --------------------------------------------------------

    def extract_data(
        self
    ):

        self.extraction_cycle += 1

        extraction_started = time.monotonic()

        logger.info(
            "=================================================="
        )

        logger.info(
            "EXTRACTION START: "
            f"cycle={self.extraction_cycle}"
        )

        # ----------------------------------------------------
        # Window
        # ----------------------------------------------------

        if not self._validate_window():

            logger.warning(
                "EXTRACTION ABORT: invalid 3WS window"
            )

            logger.error(
                "EXTRACTION RETURNED NONE: "
                "WINDOW VALIDATION"
            )

            return None

        # ----------------------------------------------------
        # Tree scan
        # ----------------------------------------------------

        logger.info(
            "UIA TREE SCAN START"
        )

        tree_started = time.monotonic()

        try:

            controls = collect_controls(
                self.target_window
            )

        except Exception as e:

            logger.exception(
                "UIA TREE SCAN EXCEPTION: "
                f"{type(e).__name__}: {e}"
            )

            logger.error(
                "EXTRACTION RETURNED NONE: "
                "TREE SCAN EXCEPTION"
            )

            return None

        tree_elapsed = (
            time.monotonic()
            - tree_started
        )

        self.last_control_snapshot = controls

        self.last_tree_count = len(
            controls
        )

        logger.info(
            "UIA TREE SCAN DONE: "
            f"controls={len(controls)}, "
            f"time={tree_elapsed:.3f}s"
        )

        if tree_elapsed >= EXTRACTON_SLOW_THRESHOLD if False else False:
            pass

        if tree_elapsed >= EXTRACTION_SLOW_THRESHOLD:

            logger.warning(
                "UIA TREE SCAN SLOW: "
                f"{tree_elapsed:.3f}s"
            )

        if not controls:

            logger.error(
                "UIA EXTRACTION FAILED: "
                "TREE RETURNED ZERO CONTROLS"
            )

            return None

        # ----------------------------------------------------
        # Candidate selection
        # ----------------------------------------------------

        logger.info(
            "CANDIDATE SELECTION START"
        )

        candidate_started = time.monotonic()

        try:

            work_order_control = select_best(
                controls,
                score_work_order,
                "WORK_ORDER"
            )

            product_control = select_best(
                controls,
                score_product,
                "PRODUCT"
            )

            formula_control = select_best(
                controls,
                score_formula,
                "FORMULA"
            )

            batch_control = select_best(
                controls,
                score_batch,
                "BATCH"
            )

            machine_control = select_best(
                controls,
                score_machine,
                "MACHINE"
            )

            packer_control = select_best(
                controls,
                score_packer,
                "PACKER"
            )

            scale_control = select_best(
                controls,
                score_scale,
                "SCALE"
            )

            pallet_control = select_best(
                controls,
                score_pallet,
                "PALLET"
            )

            nomor_mb_control = select_best(
                controls,
                score_nomor_mb,
                "NOMOR_MB"
            )

            master_box_control = select_best(
                controls,
                score_master_box,
                "MASTER_BOX"
            )

            incomplete_button = find_best_button(
                controls,
                [
                    "INCOMPLETE MB"
                ]
            )

            last_mb_button = find_best_button(
                controls,
                [
                    "MASTER BOX TERAKHIR",
                    "LAST MB"
                ]
            )

            if incomplete_button:

                logger.info(
                    "BUTTON FOUND: INCOMPLETE MB | "
                    f"name={incomplete_button.get('name')!r} | "
                    f"automation_id="
                    f"{incomplete_button.get('automation_id')!r}"
                )

            else:

                logger.warning(
                    "BUTTON NOT FOUND: INCOMPLETE MB"
                )

            if last_mb_button:

                logger.info(
                    "BUTTON FOUND: MASTER BOX TERAKHIR / LAST MB | "
                    f"name={last_mb_button.get('name')!r} | "
                    f"automation_id="
                    f"{last_mb_button.get('automation_id')!r}"
                )

            else:

                logger.warning(
                    "BUTTON NOT FOUND: "
                    "MASTER BOX TERAKHIR / LAST MB"
                )

        except Exception as e:

            logger.exception(
                "CANDIDATE SELECTION EXCEPTION: "
                f"{type(e).__name__}: {e}"
            )

            return None

        candidate_elapsed = (
            time.monotonic()
            - candidate_started
        )

        logger.info(
            "CANDIDATE SELECTION DONE: "
            f"time={candidate_elapsed:.3f}s"
        )

        # ----------------------------------------------------
        # Build state
        # ----------------------------------------------------

        logger.info(
            "DATA BUILD START"
        )

        data = {
            "work_order": "",
            "product_code": "",
            "formula": "",
            "batch": "",
            "machine": "",
            "packer": "",
            "scale": "",
            "pallet": "",
            "nomor_mb": "",
            "master_box": "",
            "incomplete_mb": "",
            "last_mb": ""
        }

        selected_controls = {
            "incomplete_button": incomplete_button,
            "last_mb_button": last_mb_button
        }

        # ----------------------------------------------------
        # Work Order
        # ----------------------------------------------------

        if work_order_control:

            data["work_order"] = (
                extract_work_order_value(
                    work_order_control.get(
                        "value",
                        ""
                    )
                )
            )

        # ----------------------------------------------------
        # Product
        # ----------------------------------------------------

        if product_control:

            data["product_code"] = clean_value(
                product_control.get(
                    "value",
                    ""
                )
            )

        # ----------------------------------------------------
        # Formula
        # ----------------------------------------------------

        if formula_control:

            data["formula"] = (
                extract_formula_value(
                    formula_control.get(
                        "value",
                        ""
                    )
                )
            )

        # ----------------------------------------------------
        # Batch
        # ----------------------------------------------------

        if batch_control:

            data["batch"] = (
                extract_batch_value(
                    batch_control.get(
                        "value",
                        ""
                    )
                )
            )

        # ----------------------------------------------------
        # Machine
        # ----------------------------------------------------

        if machine_control:

            data["machine"] = clean_value(
                machine_control.get(
                    "value",
                    ""
                )
            )

        # ----------------------------------------------------
        # Packer
        # ----------------------------------------------------

        if packer_control:

            data["packer"] = clean_value(
                packer_control.get(
                    "value",
                    ""
                )
            )

        # ----------------------------------------------------
        # Scale
        # ----------------------------------------------------

        if scale_control:

            data["scale"] = clean_value(
                scale_control.get(
                    "value",
                    ""
                )
            )

        # ----------------------------------------------------
        # Pallet
        # ----------------------------------------------------

        if pallet_control:

            data["pallet"] = (
                extract_pallet_value(
                    pallet_control.get(
                        "value",
                        ""
                    )
                )
            )

        # ----------------------------------------------------
        # Nomor MB
        # ----------------------------------------------------

        if nomor_mb_control:

            data["nomor_mb"] = (
                extract_nomor_mb_value(
                    nomor_mb_control.get(
                        "value",
                        ""
                    )
                )
            )

        # ----------------------------------------------------
        # Master Box
        # ----------------------------------------------------

        if master_box_control:

            data["master_box"] = (
                extract_master_box_value(
                    master_box_control.get(
                        "value",
                        ""
                    )
                )
            )

        # ----------------------------------------------------
        # V1 fallback
        # ----------------------------------------------------

        data = apply_v1_fallback(
            controls,
            data,
            selected_controls
        )

        incomplete_button = (
            selected_controls[
                "incomplete_button"
            ]
        )

        last_mb_button = (
            selected_controls[
                "last_mb_button"
            ]
        )

        # ----------------------------------------------------
        # Button state
        # ----------------------------------------------------

        incomplete_state = button_state(
            incomplete_button
        )

        last_mb_state = button_state(
            last_mb_button
        )

        data["incomplete_mb"] = (
            "enabled"
            if incomplete_state["enabled"]
            else
            "disabled"
            if incomplete_state["exists"]
            else
            ""
        )

        data["last_mb"] = (
            "enabled"
            if last_mb_state["enabled"]
            else
            "disabled"
            if last_mb_state["exists"]
            else
            ""
        )

        logger.info(
            "DATA BUILD DONE"
        )

        # ----------------------------------------------------
        # Identity validation
        # ----------------------------------------------------

        primary_data = bool(
            data["work_order"]
            and (
                data["batch"]
                or data["formula"]
                or data["product_code"]
            )
        )

        elapsed = (
            time.monotonic()
            - extraction_started
        )

        if primary_data:

            fingerprint = (
                data["work_order"],
                data["product_code"],
                data["formula"],
                data["batch"],
                data["pallet"],
                data["nomor_mb"],
                data["master_box"]
            )

            if fingerprint != self.last_data_fingerprint:

                logger.info(
                    "UIA DATA CHANGED:\n"
                    f"WO={data['work_order']}\n"
                    f"PRODUCT={data['product_code']}\n"
                    f"FORMULA={data['formula']}\n"
                    f"BATCH={data['batch']}\n"
                    f"PALLET={data['pallet']}\n"
                    f"NOMOR_MB={data['nomor_mb']}\n"
                    f"MASTER_BOX={data['master_box']}\n"
                    f"INCOMPLETE_MB={data['incomplete_mb']}\n"
                    f"LAST_MB={data['last_mb']}"
                )

                self.last_data_fingerprint = fingerprint

            logger.info(
                "UIA EXTRACTION OK: "
                f"time={elapsed:.3f}s"
            )

        else:

            logger.warning(
                "UIA EXTRACTION INVALID: "
                "primary identity incomplete"
            )

            logger.warning(
                "EXTRACTION RESULT: "
                f"WO={data['work_order']!r}, "
                f"PRODUCT={data['product_code']!r}, "
                f"FORMULA={data['formula']!r}, "
                f"BATCH={data['batch']!r}, "
                f"PALLET={data['pallet']!r}, "
                f"NOMOR_MB={data['nomor_mb']!r}, "
                f"MASTER_BOX={data['master_box']!r}"
            )

            self._log_extraction_diagnostic(
                controls
            )

        if elapsed >= EXTRACTION_SLOW_THRESHOLD:

            logger.warning(
                "EXTRACTION SLOW: "
                f"{elapsed:.3f}s"
            )

        return data

    # --------------------------------------------------------
    # EXTRACTION DIAGNOSTIC
    # --------------------------------------------------------

    def _log_extraction_diagnostic(
        self,
        controls
    ):

        logger.warning(
            "UIA DIAGNOSTIC: "
            f"scanned_controls={len(controls)}"
        )

        interesting = []

        keywords = [
            "work order",
            "formula",
            "batch",
            "pallet",
            "master box",
            "nomor mb",
            "material",
            "produk",
            "pengepak",
            "penimbang",
            "timbangan"
        ]

        for control in controls:

            value = normalize_text(
                control.get(
                    "value",
                    ""
                )
            )

            name = normalize_text(
                control.get(
                    "name",
                    ""
                )
            )

            context = normalize_text(
                control.get(
                    "ancestor_text",
                    ""
                )
            )

            combined = (
                f"{name} "
                f"{value} "
                f"{context}"
            ).lower()

            if any(
                keyword in combined
                for keyword in keywords
            ):

                interesting.append({
                    "name": name,
                    "value": value,
                    "control_type": control.get(
                        "control_type",
                        ""
                    ),
                    "automation_id": control.get(
                        "automation_id",
                        ""
                    ),
                    "framework_id": control.get(
                        "framework_id",
                        ""
                    ),
                    "ancestor_text": context
                })

        interesting = interesting[:60]

        if interesting:

            try:

                logger.info(
                    "UIA CANDIDATE DIAGNOSTIC:\n"
                    + json.dumps(
                        interesting,
                        indent=2,
                        ensure_ascii=False
                    )
                )

            except Exception:

                pass


# ============================================================
# SESSION ENGINE
# ============================================================

class SessionEngine:

    def __init__(
        self,
        queue,
        agent_id
    ):

        self.queue = queue

        self.agent_id = agent_id

        self.current_identity = None

        self.session_active = False

        self.has_start_event = False

        self.last_extracted_data = {}

        self.pending_end_trigger = False

        self.end_click_timestamp = None

        self.end_type_label = ""

    # --------------------------------------------------------
    # PROCESS EXTRACTION
    # --------------------------------------------------------

    def process_extraction(
        self,
        data
    ):

        logger.info(
            "SESSION PROCESS START"
        )

        if not data:

            logger.warning(
                "SESSION PROCESS ABORT: "
                "no extracted data"
            )

            return

        work_order = (
            data.get(
                "work_order",
                ""
            ).strip()
        )

        batch = (
            data.get(
                "batch",
                ""
            ).strip()
        )

        formula = (
            data.get(
                "formula",
                ""
            ).strip()
        )

        product_code = (
            data.get(
                "product_code",
                ""
            ).strip()
        )

        if not work_order or not (
            batch
            or formula
            or product_code
        ):

            logger.warning(
                "SESSION PROCESS ABORT: "
                "IDENTITY INVALID | "
                f"WO={work_order!r} | "
                f"PRODUCT={product_code!r} | "
                f"FORMULA={formula!r} | "
                f"BATCH={batch!r}"
            )

            return

        logger.info(
            "IDENTITY VALID: "
            f"WO={work_order} | "
            f"BATCH={batch} | "
            f"FORMULA={formula} | "
            f"PRODUCT={product_code}"
        )

        identity = (
            f"{work_order}|"
            f"{batch}|"
            f"{formula}"
        )

        now_iso = datetime.now(
            timezone.utc
        ).isoformat()

        # ----------------------------------------------------
        # CASE 1: New session
        # ----------------------------------------------------

        if not self.session_active:

            self.session_active = True

            self.current_identity = identity

            self.last_extracted_data = data

            logger.info(
                "NEW SESSION CREATED: "
                f"{identity}"
            )

            # ------------------------------------------------
            # Direct START
            # ------------------------------------------------

            if self._check_start_condition(
                data
            ):

                logger.info(
                    "START CONDITION TRUE "
                    "(DIRECT START): "
                    f"{identity}"
                )

                self.has_start_event = True

                self._emit_event(
                    event_type="START",
                    start_type="start process",
                    end_type="",
                    data=data,
                    timestamp=now_iso
                )

            # ------------------------------------------------
            # MID PROCESS
            # ------------------------------------------------

            else:

                logger.info(
                    "MID PROCESS DETECTED: "
                    f"{identity}"
                )

                self.has_start_event = False

                self._emit_event(
                    event_type="MID_PROCESS",
                    start_type="mid process",
                    end_type="",
                    data=data,
                    timestamp=now_iso
                )

            update_batch_history(
                self.current_identity,
                data
            )

            return

        # ----------------------------------------------------
        # CASE 2: Same active identity
        # ----------------------------------------------------

        if (
            self.session_active
            and
            self.current_identity == identity
        ):

            self.last_extracted_data = data

            logger.debug(
                "ACTIVE SESSION UPDATE: "
                f"{identity}"
            )

            # ------------------------------------------------
            # MID -> START
            # ------------------------------------------------

            if (
                not self.has_start_event
                and
                self._check_start_condition(
                    data
                )
            ):

                logger.info(
                    "START DETECTED "
                    "(MID -> START): "
                    f"{identity}"
                )

                self.has_start_event = True

                self._emit_event(
                    event_type="START",
                    start_type="start process",
                    end_type="",
                    data=data,
                    timestamp=now_iso
                )

            # ------------------------------------------------
            # END
            # ------------------------------------------------

            if self.pending_end_trigger:

                end_time = (
                    self.end_click_timestamp
                    or
                    now_iso
                )

                logger.info(
                    "END DETECTED: "
                    f"[{self.end_type_label}] "
                    f"{identity}"
                )

                self._emit_event(
                    event_type="END",
                    start_type=(
                        "start process"
                        if self.has_start_event
                        else
                        "mid process"
                    ),
                    end_type=self.end_type_label,
                    data=data,
                    timestamp=end_time
                )

                self._reset_session()

                return

            update_batch_history(
                self.current_identity,
                data
            )

            return

        # ----------------------------------------------------
        # CASE 3: Identity changed while active
        # ----------------------------------------------------

        if (
            self.session_active
            and
            self.current_identity != identity
        ):

            logger.warning(
                "IDENTITY CHANGED WHILE ACTIVE: "
                f"LOCKED={self.current_identity} | "
                f"CURRENT_UI={identity}"
            )

            if self.pending_end_trigger:

                end_time = (
                    self.end_click_timestamp
                    or
                    now_iso
                )

                logger.info(
                    "END DETECTED DURING UI IDENTITY SHIFT: "
                    f"{self.current_identity}"
                )

                self._emit_event(
                    event_type="END",
                    start_type=(
                        "start process"
                        if self.has_start_event
                        else
                        "mid process"
                    ),
                    end_type=self.end_type_label,
                    data=self.last_extracted_data,
                    timestamp=end_time
                )

                self._reset_session()

    # --------------------------------------------------------
    # END TRIGGER
    # --------------------------------------------------------

    def trigger_end_click(
        self,
        label
    ):

        if self.session_active:

            self.pending_end_trigger = True

            self.end_click_timestamp = (
                datetime.now(
                    timezone.utc
                ).isoformat()
            )

            self.end_type_label = label

            logger.info(
                "END CLICK ARMED: "
                f"{label}"
            )

        else:

            logger.info(
                "END CLICK IGNORED: "
                "NO ACTIVE SESSION"
            )

    # --------------------------------------------------------
    # START CONDITION
    # --------------------------------------------------------

    def _check_start_condition(
        self,
        data
    ):

        pallet_suffix = parse_pallet_suffix(
            data.get(
                "pallet",
                ""
            )
        )

        nomor_mb = parse_nomor_mb(
            data.get(
                "nomor_mb",
                ""
            )
        )

        master_box = parse_master_box(
            data.get(
                "master_box",
                ""
            )
        )

        is_start = (
            pallet_suffix == 1
            and
            nomor_mb == 2
            and
            master_box == 1
        )

        logger.info(
            "START CHECK: "
            f"pallet='{data.get('pallet', '')}', "
            f"pallet_suffix={pallet_suffix}, "
            f"nomor_mb='{data.get('nomor_mb', '')}', "
            f"nomor_mb_numeric={nomor_mb}, "
            f"master_box='{data.get('master_box', '')}', "
            f"master_box_numeric={master_box}, "
            f"RESULT={'TRUE' if is_start else 'FALSE'}"
        )

        return is_start

    # --------------------------------------------------------
    # EVENT EMITTER
    # --------------------------------------------------------

    def _emit_event(
        self,
        event_type,
        start_type,
        end_type,
        data,
        timestamp
    ):

        logger.info(
            "EVENT BUILD START: "
            f"type={event_type}"
        )

        unique_event_id = str(
            uuid.uuid4()
        )

        payload = {
            "event_id": unique_event_id,
            "agent_id": self.agent_id,
            "event_type": event_type,
            "timestamp": timestamp,

            "work_order": data.get(
                "work_order",
                ""
            ),

            "product_code": data.get(
                "product_code",
                ""
            ),

            "formula": data.get(
                "formula",
                ""
            ),

            "batch": data.get(
                "batch",
                ""
            ),

            "pallet": data.get(
                "pallet",
                ""
            ),

            "nomor_mb": data.get(
                "nomor_mb",
                ""
            ),

            "master_box": data.get(
                "master_box",
                ""
            ),

            "start_type": start_type,

            "end_type": end_type
        }

        logger.info(
            "EVENT EMIT: "
            f"type={event_type}, "
            f"WO={payload['work_order']}, "
            f"BATCH={payload['batch']}, "
            f"PALLET={payload['pallet']}, "
            f"NOMOR_MB={payload['nomor_mb']}, "
            f"MASTER_BOX={payload['master_box']}"
        )

        queued = self.queue.enqueue(
            unique_event_id,
            event_type,
            payload
        )

        if queued:

            logger.info(
                "EVENT QUEUED SUCCESSFULLY: "
                f"{unique_event_id} "
                f"[{event_type}]"
            )

        else:

            logger.error(
                "EVENT QUEUE FAILED: "
                f"{unique_event_id} "
                f"[{event_type}]"
            )

    # --------------------------------------------------------
    # RESET
    # --------------------------------------------------------

    def _reset_session(
        self
    ):

        logger.info(
            "SESSION RESET"
        )

        self.session_active = False

        self.current_identity = None

        self.has_start_event = False

        self.last_extracted_data = {}

        self.pending_end_trigger = False

        self.end_click_timestamp = None

        self.end_type_label = ""


# ============================================================
# END MOUSE DETECTOR
# ============================================================

class MouseEndDetector:

    def __init__(
        self,
        session_engine,
        uia_extractor
    ):

        self.session_engine = session_engine

        self.uia_extractor = uia_extractor

        self.listener = None

    def start(
        self
    ):

        self.listener = mouse.Listener(
            on_click=self.on_click
        )

        self.listener.daemon = True

        self.listener.start()

        logger.info(
            "MOUSE END DETECTOR STARTED"
        )

    def on_click(
        self,
        x,
        y,
        button,
        pressed
    ):

        if (
            not pressed
            or
            button != mouse.Button.left
        ):

            return

        if not self.session_engine.session_active:

            return

        win = (
            self.uia_extractor.target_window
        )

        if not win:

            return

        try:

            # =================================================
            # IMPORTANT:
            # UIAWrapper tidak punya .exists()
            # Jadi JANGAN gunakan win.exists().
            #
            # Cukup validasi object + element_info + PID.
            # =================================================

            info = win.element_info

            if info is None:

                return

            window_pid = getattr(
                info,
                "process_id",
                None
            )

            target_pid = (
                self.uia_extractor.target_pid
            )

            if (
                window_pid
                and
                target_pid
                and
                window_pid != target_pid
            ):

                logger.warning(
                    "MOUSE END IGNORED: "
                    f"PID mismatch "
                    f"window={window_pid}, "
                    f"target={target_pid}"
                )

                return

            rect = win.rectangle()

            if not (
                rect.left <= x <= rect.right
                and
                rect.top <= y <= rect.bottom
            ):

                return

            target_buttons = [
                "INCOMPLETE MB",
                "MASTER BOX TERAKHIR",
                "LAST MB"
            ]

            logger.debug(
                "MOUSE CLICK INSIDE 3WS WINDOW: "
                f"({x}, {y})"
            )

            for elem in win.descendants(
                control_type="Button"
            ):

                try:

                    btn_text = normalize_text(
                        get_element_value(
                            elem
                        )
                    )

                    btn_text_upper = (
                        btn_text.upper()
                    )

                    if not any(
                        target in btn_text_upper
                        for target in target_buttons
                    ):

                        continue

                    btn_rect = elem.rectangle()

                    if (
                        btn_rect.left <= x <= btn_rect.right
                        and
                        btn_rect.top <= y <= btn_rect.bottom
                    ):

                        logger.info(
                            "MOUSE CLICK MATCHED END BUTTON: "
                            f"'{btn_text_upper}' "
                            f"at ({x}, {y})"
                        )

                        self.session_engine.trigger_end_click(
                            label=btn_text_upper
                        )

                        break

                except Exception as e:

                    logger.debug(
                        "END BUTTON CHECK ERROR: "
                        f"{type(e).__name__}: {e}"
                    )

                    continue

        except Exception as e:

            logger.warning(
                "MOUSE END DETECTOR ERROR: "
                f"{type(e).__name__}: {e}"
            )


# ============================================================
# HEARTBEAT WORKER
# ============================================================

def heartbeat_worker(
    api_client,
    stop_event
):

    logger.info(
        "Heartbeat worker started."
    )

    server_offline_logged = False

    while not stop_event.is_set():

        success = (
            api_client.send_heartbeat()
        )

        if not success:

            if not server_offline_logged:

                logger.warning(
                    "SERVER OFFLINE "
                    "(Heartbeat failed)"
                )

                server_offline_logged = True

        else:

            if server_offline_logged:

                logger.info(
                    "SERVER ONLINE "
                    "(Heartbeat restored)"
                )

                server_offline_logged = False

        stop_event.wait(
            HEARTBEAT_INTERVAL
        )


# ============================================================
# QUEUE FLUSH WORKER
# ============================================================

def queue_flush_worker(
    queue,
    api_client,
    stop_event
):

    logger.info(
        "Queue flush worker started."
    )

    server_was_offline = False

    while not stop_event.is_set():

        pending_events = (
            queue.get_pending_events()
        )

        if pending_events:

            logger.info(
                "QUEUE FLUSH: "
                f"{len(pending_events)} pending event(s)"
            )

            for event in pending_events:

                event_id = event[
                    "event_id"
                ]

                payload = event[
                    "payload"
                ]

                success, err_msg = (
                    api_client.send_event(
                        payload
                    )
                )

                if success:

                    queue.mark_sent(
                        event_id
                    )

                    logger.info(
                        "SERVER SENT: "
                        f"{event_id} "
                        f"[{event['event_type']}]"
                    )

                    if server_was_offline:

                        logger.info(
                            "SERVER ONLINE - "
                            "QUEUE FLUSHED"
                        )

                        server_was_offline = False

                else:

                    queue.increment_attempt(
                        event_id,
                        err_msg
                    )

                    if not server_was_offline:

                        logger.warning(
                            "SERVER OFFLINE / RETRY: "
                            f"{err_msg}"
                        )

                        server_was_offline = True

                    break

        stop_event.wait(
            QUEUE_FLUSH_INTERVAL
        )


# ============================================================
# MAIN
# ============================================================

def main():

    logger.info(
        "=================================================="
    )

    logger.info(
        "AGENT STARTED - "
        f"B7CaptureAgent v{AGENT_VERSION}"
    )

    logger.info(
        f"PROCESS PID: {os.getpid()}"
    )

    logger.info(
        "=================================================="
    )

    # --------------------------------------------------------
    # Config
    # --------------------------------------------------------

    config = load_or_create_config()

    agent_id = config[
        "agent_id"
    ]

    server_url = config[
        "server_url"
    ]

    logger.info(
        f"Agent ID: {agent_id}"
    )

    logger.info(
        f"Server URL: {server_url}"
    )

    logger.info(
        f"Config Path: {CONFIG_PATH}"
    )

    # --------------------------------------------------------
    # API + Queue
    # --------------------------------------------------------

    api_client = APIClient(
        server_url,
        agent_id
    )

    queue = SQLiteQueue(
        DB_PATH
    )

    # --------------------------------------------------------
    # Register
    # --------------------------------------------------------

    api_client.register()

    # --------------------------------------------------------
    # Engines
    # --------------------------------------------------------

    session_engine = SessionEngine(
        queue,
        agent_id
    )

    uia_extractor = UIAExtractor()

    mouse_detector = MouseEndDetector(
        session_engine,
        uia_extractor
    )

    mouse_detector.start()

    # --------------------------------------------------------
    # Workers
    # --------------------------------------------------------

    stop_event = threading.Event()

    heartbeat_thread = threading.Thread(
        target=heartbeat_worker,
        args=(
            api_client,
            stop_event
        ),
        daemon=True
    )

    heartbeat_thread.start()

    queue_thread = threading.Thread(
        target=queue_flush_worker,
        args=(
            queue,
            api_client,
            stop_event
        ),
        daemon=True
    )

    queue_thread.start()

    # --------------------------------------------------------
    # Main extraction loop
    # --------------------------------------------------------

    ws_found_logged = False

    logger.info(
        "MAIN EXTRACTION LOOP STARTED"
    )

    try:

        while True:

            cycle_started = time.monotonic()

            try:

                # ------------------------------------------------
                # FIND 3WS
                # ------------------------------------------------

                found = (
                    uia_extractor.find_3ws_window()
                )

                if not found:

                    if ws_found_logged:

                        logger.warning(
                            "3WS NOT FOUND"
                        )

                        ws_found_logged = False

                    time.sleep(
                        EXTRACTION_INTERVAL
                    )

                    continue

                if not ws_found_logged:

                    logger.info(
                        "3WS FOUND"
                    )

                    ws_found_logged = True

                # ------------------------------------------------
                # EXTRACT
                # ------------------------------------------------

                extracted_data = (
                    uia_extractor.extract_data()
                )

                if extracted_data is None:

                    logger.error(
                        "EXTRACTION RETURNED NONE"
                    )

                else:

                    logger.info(
                        "EXTRACTION RETURNED DATA"
                    )

                    # ------------------------------------------------
                    # SESSION
                    # ------------------------------------------------

                    session_engine.process_extraction(
                        extracted_data
                    )

                    logger.info(
                        "SESSION PROCESS DONE"
                    )

            except Exception as e:

                logger.exception(
                    "MAIN EXTRACTION LOOP ERROR: "
                    f"{type(e).__name__}: {e}"
                )

                # Paksa rediscovery cycle berikutnya.
                uia_extractor.target_window = None

                uia_extractor.target_pid = None

                uia_extractor.target_hwnd = None

                ws_found_logged = False

            cycle_elapsed = (
                time.monotonic()
                - cycle_started
            )

            if cycle_elapsed >= EXTRACTION_SLOW_THRESHOLD:

                logger.warning(
                    "FULL EXTRACTION CYCLE SLOW: "
                    f"{cycle_elapsed:.3f}s"
                )

            else:

                logger.debug(
                    "EXTRACTION CYCLE DONE: "
                    f"{cycle_elapsed:.3f}s"
                )

            time.sleep(
                EXTRACTION_INTERVAL
            )

    except KeyboardInterrupt:

        logger.info(
            "STOPPING AGENT..."
        )

        stop_event.set()

    except Exception as e:

        logger.exception(
            "FATAL MAIN ERROR: "
            f"{type(e).__name__}: {e}"
        )

        stop_event.set()


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    main()
