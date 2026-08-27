import sys
import os
import time
import json
import threading
import queue
import re
from datetime import datetime
from ctypes import (
    windll, wintypes, byref, Structure, POINTER, c_ulong, c_long, c_int,
    c_void_p, c_wchar_p, sizeof, cast, WINFUNCTYPE, HRESULT,
    c_uint, c_ubyte, c_wchar
)
from ctypes.wintypes import DWORD

# Optional OCR Fallback support
try:
    import pytesseract  # type: ignore
    from PIL import ImageGrab
    HAS_OCR = True
except ImportError:
    HAS_OCR = False

# =============================================================================
# 1. WIN32 CONSTANTS & STRUCTURES
# =============================================================================

WH_MOUSE_LL = 14
WH_KEYBOARD_LL = 13
WM_LBUTTONDOWN = 0x0201
WM_KEYDOWN = 0x0100
WM_SYSKEYDOWN = 0x0104
WM_QUIT = 0x0012

VK_RETURN = 0x0D
VK_TAB = 0x09

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010

class POINT(Structure):
    _fields_ = [("x", c_long), ("y", c_long)]

class MSLLHOOKSTRUCT(Structure):
    _fields_ = [
        ("pt", POINT),
        ("mouseData", DWORD),
        ("flags", DWORD),
        ("time", DWORD),
        ("dwExtraInfo", POINTER(c_ulong))
    ]

class KBDLLHOOKSTRUCT(Structure):
    _fields_ = [
        ("vkCode", DWORD),
        ("scanCode", DWORD),
        ("flags", DWORD),
        ("time", DWORD),
        ("dwExtraInfo", POINTER(c_ulong))
    ]

class MSG(Structure):
    _fields_ = [
        ("hwnd", c_void_p),
        ("message", c_uint),
        ("wParam", c_void_p),
        ("lParam", c_void_p),
        ("time", c_ulong),
        ("pt", POINT)
    ]

class RECT(Structure):
    _fields_ = [
        ("left", c_long),
        ("top", c_long),
        ("right", c_long),
        ("bottom", c_long)
    ]

user32 = windll.user32
kernel32 = windll.kernel32
ole32 = windll.ole32
oleaut32 = windll.oleaut32

LHOOKPROC = WINFUNCTYPE(c_long, c_int, c_void_p, c_void_p)

user32.SetWindowsHookExW.argtypes = [c_int, LHOOKPROC, c_void_p, c_ulong]
user32.SetWindowsHookExW.restype = c_void_p
user32.UnhookWindowsHookEx.argtypes = [c_void_p]
user32.UnhookWindowsHookEx.restype = c_int
user32.CallNextHookEx.argtypes = [c_void_p, c_int, c_void_p, c_void_p]
user32.CallNextHookEx.restype = c_long
user32.GetMessageW.argtypes = [POINTER(MSG), c_void_p, c_uint, c_uint]
user32.GetMessageW.restype = c_int
user32.TranslateMessage.argtypes = [POINTER(MSG)]
user32.DispatchMessageW.argtypes = [POINTER(MSG)]
user32.PostThreadMessageW.argtypes = [c_ulong, c_uint, c_void_p, c_void_p]
user32.GetForegroundWindow.restype = c_void_p
user32.GetWindowTextW.argtypes = [c_void_p, c_wchar_p, c_int]
user32.GetWindowClassNameW = getattr(user32, 'GetClassNameW')
user32.GetWindowClassNameW.argtypes = [c_void_p, c_wchar_p, c_int]
user32.GetWindowThreadProcessId.argtypes = [c_void_p, POINTER(c_ulong)]
user32.GetWindowRect.argtypes = [c_void_p, POINTER(RECT)]

oleaut32.SysFreeString.argtypes = [c_void_p]
oleaut32.SysStringLen.argtypes = [c_void_p]
oleaut32.SysStringLen.restype = c_uint

# =============================================================================
# 2. UI AUTOMATION DIRECT VTABLE BINDINGS
# =============================================================================

UIA_ValuePatternId = 10002
UIA_NamePropertyId = 30005
UIA_AutomationIdPropertyId = 30011
UIA_ClassNamePropertyId = 30012

class GUID(Structure):
    _fields_ = [("Data1", c_ulong), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD), ("Data4", c_ubyte * 8)]

    @classmethod
    def from_str(cls, s):
        import uuid
        u = uuid.UUID(s)
        g = cls()
        g.Data1 = u.time_low
        g.Data2 = u.time_mid
        g.Data3 = u.time_hi_version
        g.Data4 = (c_ubyte * 8)(*u.bytes[8:])
        return g

def get_bstr_string(bstr_ptr):
    if not bstr_ptr:
        return ""
    val = cast(bstr_ptr, c_wchar_p).value
    oleaut32.SysFreeString(bstr_ptr)
    return val if val else ""

class UIAutomationManager:
    _uia_instance = None
    _lock = threading.Lock()

    @classmethod
    def get_uia(cls):
        with cls._lock:
            if cls._uia_instance is None:
                try:
                    ole32.CoInitialize(None)
                except Exception:
                    pass
                clsid = GUID.from_str("{FF48DBA4-60EF-4466-A079-AD29A360808D}")
                iid = GUID.from_str("{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}")
                ppv = c_void_p()
                res = ole32.CoCreateInstance(byref(clsid), None, 1, byref(iid), byref(ppv))
                if res == 0 and ppv:
                    cls._uia_instance = ppv
            return cls._uia_instance

    @classmethod
    def get_element_from_handle(cls, hwnd):
        uia = cls.get_uia()
        if not uia or not hwnd:
            return None
        vtbl = cast(cast(uia, POINTER(c_void_p)).contents, POINTER(c_void_p))
        proto = WINFUNCTYPE(HRESULT, c_void_p, c_void_p, POINTER(c_void_p))
        func = proto(vtbl[6])
        element = c_void_p()
        if func(uia, c_void_p(hwnd), byref(element)) == 0:
            return element
        return None

    @classmethod
    def get_element_from_point(cls, x, y):
        uia = cls.get_uia()
        if not uia:
            return None
        vtbl = cast(cast(uia, POINTER(c_void_p)).contents, POINTER(c_void_p))
        proto = WINFUNCTYPE(HRESULT, c_void_p, POINT, POINTER(c_void_p))
        func = proto(vtbl[7])
        element = c_void_p()
        pt = POINT(x, y)
        if func(uia, pt, byref(element)) == 0:
            return element
        return None

    @classmethod
    def get_element_property(cls, element, prop_id):
        if not element:
            return ""
        vtbl = cast(cast(element, POINTER(c_void_p)).contents, POINTER(c_void_p))
        if prop_id in (UIA_NamePropertyId, UIA_AutomationIdPropertyId, UIA_ClassNamePropertyId):
            method_idx = 23 if prop_id == UIA_NamePropertyId else (27 if prop_id == UIA_AutomationIdPropertyId else 28)
            proto = WINFUNCTYPE(HRESULT, c_void_p, POINTER(c_void_p))
            func = proto(vtbl[method_idx])
            bstr = c_void_p()
            if func(element, byref(bstr)) == 0:
                return get_bstr_string(bstr)
        return ""

# =============================================================================
# 3. WINDOW & PROCESS INSPECTOR
# =============================================================================

class WindowInspector:
    @staticmethod
    def get_active_window_info():
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return {"hwnd": 0, "title": "", "class": "", "pid": 0, "process_name": ""}

        buf_title = (c_wchar * 512)()
        user32.GetWindowTextW(hwnd, buf_title, 512)

        buf_class = (c_wchar * 256)()
        user32.GetWindowClassNameW(hwnd, buf_class, 256)

        pid = c_ulong()
        user32.GetWindowThreadProcessId(hwnd, byref(pid))
        proc_name = WindowInspector.get_process_name(pid.value)

        return {
            "hwnd": hwnd,
            "title": buf_title.value.strip(),
            "class": buf_class.value.strip(),
            "pid": pid.value,
            "process_name": proc_name
        }

    @staticmethod
    def get_process_name(pid):
        if not pid:
            return ""
        h_proc = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if not h_proc:
            return ""
        buf = (c_wchar * 1024)()
        size = c_ulong(1024)
        res = kernel32.QueryFullProcessImageNameW(h_proc, 0, buf, byref(size))
        kernel32.CloseHandle(h_proc)
        if res:
            return os.path.basename(buf.value)
        return ""

# =============================================================================
# 4. BUSINESS LOGGING & LIVE RETENTION MANAGER
# =============================================================================

class BusinessLogger:
    def __init__(self, txt_path="weighing_spy_log.txt", json_path="weighing_spy_log.json"):
        self.txt_path = txt_path
        self.json_path = json_path
        self.lock = threading.Lock()
        self._init_files()

    def _init_files(self):
        if not os.path.exists(self.json_path):
            with open(self.json_path, "w", encoding="utf-8") as f:
                json.dump([], f, indent=2)

    def save_or_update_session(self, session_record):
        """Live Upsert session record into TXT & JSON with 5-record retention per identity."""
        with self.lock:
            # Prepare JSON structured dictionary
            record_dict = {
                "session_id": session_record["session_id"],
                "work_order": session_record["work_order"],
                "formula": session_record["formula"],
                "nomor_batch": session_record["nomor_batch"],
                "start_timestamp": session_record["start_timestamp"],
                "start_source": session_record["start_source"],
                "end_timestamp": session_record["end_timestamp"],
                "end_trigger": session_record["end_trigger"],
                "status": session_record["status"]
            }

            try:
                with open(self.json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = []

            # Check if this exact session_id exists to update it
            existing_index = -1
            for idx, r in enumerate(data):
                if r.get("session_id") == session_record["session_id"]:
                    existing_index = idx
                    break

            if existing_index != -1:
                # Update existing record in-place
                data[existing_index] = record_dict
            else:
                # Add new record, applying Retention Policy: max 5 records per (WO + Formula + Batch)
                identity_key = f"{record_dict['work_order']}|{record_dict['formula']}|{record_dict['nomor_batch']}"
                matching_indexes = [
                    idx for idx, r in enumerate(data)
                    if f"{r.get('work_order')}|{r.get('formula')}|{r.get('nomor_batch')}" == identity_key
                ]

                if len(matching_indexes) >= 5:
                    to_remove_count = len(matching_indexes) - 4
                    indexes_to_remove = set(matching_indexes[:to_remove_count])
                    data = [r for idx, r in enumerate(data) if idx not in indexes_to_remove]

                data.append(record_dict)

            # Rewrite JSON
            with open(self.json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            # Rewrite full TXT log based on current JSON state
            self._rewrite_txt_file(data)

    def _rewrite_txt_file(self, records):
        with open(self.txt_path, "w", encoding="utf-8") as f:
            for r in records:
                txt_block = self._format_txt_block(r)
                f.write(txt_block + "\n\n")

    def _format_txt_block(self, r):
        lines = [
            "=" * 60,
            "WEIGHING SESSION",
            "=" * 60,
            f"Status       : {r.get('status')}",
            f"Work Order   : {r.get('work_order')}",
            f"Formula      : {r.get('formula')}",
            f"Nomor Batch  : {r.get('nomor_batch')}",
            "",
            f"START        : {r.get('start_timestamp')}",
            f"START SOURCE : {r.get('start_source')}",
            "",
            f"END          : {r.get('end_timestamp') if r.get('end_timestamp') else 'PENDING'}",
            f"END TRIGGER  : {r.get('end_trigger') if r.get('end_trigger') else 'PENDING'}",
            "=" * 60
        ]
        return "\n".join(lines)

# =============================================================================
# 5. WEIGHING STATE MACHINE & MONITOR
# =============================================================================

class WeighingMonitor:
    def __init__(self, logger):
        self.logger = logger
        self.current_session = None
        self.lock = threading.Lock()
        self.mode = "auto"

    def set_mode(self, mode):
        self.mode = mode

    def process_input_event(self, event_type, details):
        with self.lock:
            win_info = WindowInspector.get_active_window_info()
            if "3WS.NET.exe" not in win_info["process_name"] and win_info["process_name"] != "":
                return

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            time_only = datetime.now().strftime("%H:%M:%S.%f")[:-3]

            # 1. NORMAL START: Work Order Submit
            if "Select Work Order" in win_info["title"] or "Work Order" in win_info["title"]:
                if event_type in ("CLICK_SUBMIT", "KEY_ENTER"):
                    wo_val = details.get("captured_text", "UNKNOWN")
                    if self.mode in ("auto", "full"):
                        self.current_session = {
                            "session_id": f"SESS_{int(time.time()*1000)}",
                            "work_order": wo_val,
                            "formula": "UNKNOWN",
                            "nomor_batch": "UNKNOWN",
                            "start_timestamp": now_str,
                            "start_source": "WORK_ORDER_SUBMIT",
                            "end_timestamp": None,
                            "end_trigger": None,
                            "status": "ACTIVE",
                            "end_locked": False
                        }
                        self._log_cmd(time_only, "SESSION DETECTED (WO Submit)")
                        self.logger.save_or_update_session(self.current_session)

            # 2. END EVENT: Master Box Terakhir / INCOMPLETE MB
            elif "Penimbangan FG" in win_info["title"] and self.current_session and self.current_session["status"] == "ACTIVE":
                target_control = details.get("target_control", "").upper()
                if "MASTER BOX TERAKHIR" in target_control or "INCOMPLETE MB" in target_control:
                    trigger_type = "MASTER_BOX_TERAKHIR" if "MASTER BOX TERAKHIR" in target_control else "INCOMPLETE_MB"
                    self._trigger_end_event(now_str, time_only, trigger_type)

    def periodic_inspect(self):
        """Polling loop for state inspection and mid-session attach."""
        with self.lock:
            win_info = WindowInspector.get_active_window_info()
            if "3WS.NET.exe" not in win_info["process_name"] and win_info["process_name"] != "":
                return

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            time_only = datetime.now().strftime("%H:%M:%S.%f")[:-3]

            if "Penimbangan FG" in win_info["title"]:
                # MID-SESSION ATTACH DETECTED
                if not self.current_session or self.current_session["status"] == "COMPLETED":
                    if self.mode in ("auto", "mid"):
                        self.current_session = {
                            "session_id": f"SESS_{int(time.time()*1000)}",
                            "work_order": "UNKNOWN",
                            "formula": "UNKNOWN",
                            "nomor_batch": "UNKNOWN",
                            "start_timestamp": now_str,
                            "start_source": "MID_SESSION_ATTACH",
                            "end_timestamp": None,
                            "end_trigger": None,
                            "status": "ACTIVE",
                            "end_locked": False
                        }
                        self._log_cmd(time_only, "SESSION DETECTED (MID_SESSION_ATTACH)")

                        # Immediately try capturing data upon detection
                        self._read_fg_metadata(win_info["hwnd"])
                        self.logger.save_or_update_session(self.current_session)
                        self._log_session_summary(time_only)

                # ACTIVE SESSION: Try filling missing data
                elif self.current_session and self.current_session["status"] == "ACTIVE":
                    if any(v == "UNKNOWN" for v in [self.current_session["work_order"], self.current_session["formula"], self.current_session["nomor_batch"]]):
                        if self._read_fg_metadata(win_info["hwnd"]):
                            self.logger.save_or_update_session(self.current_session)
                            self._log_cmd(time_only, "SESSION METADATA UPDATED")
                            self._log_session_summary(time_only)

    def _read_fg_metadata(self, hwnd):
        """Reads metadata from screen via UIA or OCR Fallback."""
        updated = False
        elem = UIAutomationManager.get_element_from_handle(hwnd)

        # 1. Fallback / Regex OCR
        if HAS_OCR:
            try:
                rect = RECT()
                if user32.GetWindowRect(hwnd, byref(rect)):
                    bbox = (rect.left, rect.top, rect.right, rect.bottom)
                    img = ImageGrab.grab(bbox)
                    text = pytesseract.image_to_string(img)

                    if self.current_session["work_order"] == "UNKNOWN":
                        wo_m = re.search(r"(?:Work\s*Order|WO)\s*[:\-]\s*([A-Z0-9\-]+)", text, re.IGNORECASE)
                        if wo_m:
                            self.current_session["work_order"] = wo_m.group(1).strip()
                            updated = True

                    if self.current_session["formula"] == "UNKNOWN":
                        f_m = re.search(r"Formula\s*[:\-]\s*([A-Z0-9]+)", text, re.IGNORECASE)
                        if f_m:
                            self.current_session["formula"] = f_m.group(1).strip().upper()
                            updated = True

                    if self.current_session["nomor_batch"] == "UNKNOWN":
                        b_m = re.search(r"(?:Nomor\s*Batch|Batch)\s*[:\-]\s*([A-Z0-9\s]+)", text, re.IGNORECASE)
                        if b_m:
                            self.current_session["nomor_batch"] = b_m.group(1).strip().upper()
                            updated = True
            except Exception:
                pass

        return updated

    def _trigger_end_event(self, now_str, time_only, trigger_type):
        if not self.current_session or self.current_session.get("end_locked"):
            return

        self.current_session["end_timestamp"] = now_str
        self.current_session["end_trigger"] = trigger_type
        self.current_session["status"] = "COMPLETED"
        self.current_session["end_locked"] = True

        self._log_cmd(time_only, f"END EVENT = {trigger_type}")
        self._log_cmd(time_only, f"END TIMESTAMP = {now_str}")
        self.logger.save_or_update_session(self.current_session)
        self._log_cmd(time_only, "SESSION UPDATED -> STATUS = COMPLETED")

    def _log_cmd(self, timestamp, message):
        print(f"[{timestamp}] {message}")

    def _log_session_summary(self, time_only):
        print(f"[{time_only}] WO       = {self.current_session['work_order']}")
        print(f"[{time_only}] FORMULA  = {self.current_session['formula']}")
        print(f"[{time_only}] BATCH    = {self.current_session['nomor_batch']}")
        print(f"[{time_only}] START    = {self.current_session['start_source']}")
        print(f"[{time_only}] STATUS   = {self.current_session['status']}")
        print(f"[{time_only}] LOG SAVED LIVE")

# =============================================================================
# 6. THREADING & HOOK INFRASTRUCTURE
# =============================================================================

class HookThread(threading.Thread):
    def __init__(self, event_queue):
        super().__init__()
        self.event_queue = event_queue
        self.daemon = True
        self.win32_thread_id = None
        self.h_mouse_hook = None
        self.h_kbd_hook = None
        self._mouse_proc = LHOOKPROC(self._mouse_hook_proc)
        self._kbd_proc = LHOOKPROC(self._kbd_hook_proc)

    def run(self):
        self.win32_thread_id = kernel32.GetCurrentThreadId()
        self.h_mouse_hook = user32.SetWindowsHookExW(WH_MOUSE_LL, self._mouse_proc, None, 0)
        self.h_kbd_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._kbd_proc, None, 0)

        if not self.h_mouse_hook or not self.h_kbd_hook:
            return

        msg = MSG()
        while user32.GetMessageW(byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(byref(msg))
            user32.DispatchMessageW(byref(msg))

        if self.h_mouse_hook:
            user32.UnhookWindowsHookEx(self.h_mouse_hook)
        if self.h_kbd_hook:
            user32.UnhookWindowsHookEx(self.h_kbd_hook)

    def stop(self):
        if self.win32_thread_id:
            user32.PostThreadMessageW(self.win32_thread_id, WM_QUIT, 0, 0)

    def _mouse_hook_proc(self, nCode, wParam, lParam):
        try:
            if nCode >= 0 and wParam == WM_LBUTTONDOWN:
                ms = cast(lParam, POINTER(MSLLHOOKSTRUCT)).contents
                elem = UIAutomationManager.get_element_from_point(ms.pt.x, ms.pt.y)
                elem_name = UIAutomationManager.get_element_property(elem, UIA_NamePropertyId) if elem else ""
                target_name = elem_name.upper()
                if any(k in target_name for k in ["SUBMIT", "MASTER BOX TERAKHIR", "INCOMPLETE MB"]):
                    self.event_queue.put({
                        "event_type": "CLICK_SUBMIT" if "SUBMIT" in target_name else "CLICK_ACTION",
                        "target_control": elem_name
                    })
        except Exception:
            pass
        return user32.CallNextHookEx(self.h_mouse_hook, nCode, wParam, lParam)

    def _kbd_hook_proc(self, nCode, wParam, lParam):
        try:
            if nCode >= 0 and wParam in (WM_KEYDOWN, WM_SYSKEYDOWN):
                kb = cast(lParam, POINTER(KBDLLHOOKSTRUCT)).contents
                if kb.vkCode in (VK_RETURN, VK_TAB):
                    self.event_queue.put({
                        "event_type": "KEY_ENTER" if kb.vkCode == VK_RETURN else "KEY_TAB",
                        "target_control": ""
                    })
        except Exception:
            pass
        return user32.CallNextHookEx(self.h_kbd_hook, nCode, wParam, lParam)

# =============================================================================
# 7. WORKER & ORCHESTRATION MANAGER
# =============================================================================

class DiagnosticWorker(threading.Thread):
    def __init__(self, event_queue, monitor):
        super().__init__()
        self.event_queue = event_queue
        self.monitor = monitor
        self.daemon = True
        self.running = True

    def run(self):
        while self.running:
            try:
                event = self.event_queue.get(timeout=0.2)
                self.monitor.process_input_event(event["event_type"], event)
                self.event_queue.task_done()
            except queue.Empty:
                pass

            self.monitor.periodic_inspect()

    def stop(self):
        self.running = False

class BusinessEventRecorder:
    def __init__(self, mode="auto"):
        self.logger = BusinessLogger()
        self.monitor = WeighingMonitor(self.logger)
        self.monitor.set_mode(mode)
        self.event_queue = queue.Queue()
        self.worker = None
        self.hook_thread = None
        self.is_recording = False

    def start(self):
        if self.is_recording:
            return
        self.event_queue = queue.Queue()
        self.worker = DiagnosticWorker(self.event_queue, self.monitor)
        self.hook_thread = HookThread(self.event_queue)

        self.worker.start()
        self.hook_thread.start()
        self.is_recording = True

    def stop(self):
        if not self.is_recording:
            return
        if self.hook_thread:
            self.hook_thread.stop()
        if self.worker:
            self.worker.stop()
        self.is_recording = False

# =============================================================================
# 8. MAIN ENGINE ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    mode = "auto"
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        if "--mode=" in arg:
            mode = arg.split("=")[1]
        elif arg in ("full", "mid", "auto"):
            mode = arg

    recorder = BusinessEventRecorder(mode=mode)
    recorder.start()

    print("============================================================")
    print(f" WEIGHING SPY ENGINE STARTED (Mode: {recorder.monitor.mode.upper()})")
    print(" Press Ctrl+C to terminate.")
    print("============================================================")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping Weighing Spy Engine...")
        recorder.stop()
        sys.exit(0)