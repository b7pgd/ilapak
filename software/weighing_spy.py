"""
===============================================================================
WEIGHING SPY - Windows Diagnostic Recorder (Pure Python Standard Library)
===============================================================================
Target Platform : Windows 10 / 11
Python Version   : 3.14.x (Standard Library Only)
Dependencies     : None (ctypes, queue, threading, json, time, etc.)
===============================================================================
"""

import sys
import os
import time
import json
import queue
import threading
import traceback
import ctypes
from ctypes import (
    wintypes, Structure, POINTER, c_void_p, c_int, c_uint, c_long, c_ulong,
    c_wchar, c_wchar_p, c_ubyte, sizeof, byref, HRESULT,
    cast, OleDLL, WinDLL, WINFUNCTYPE
)

# Mandatory Check
if sys.platform != 'win32':
    print("[FATAL] weighing_spy.py only runs on Microsoft Windows.")
    sys.exit(1)

# =============================================================================
# 1. WINDOWS API BINDINGS & STRUCTURES (ctypes)
# =============================================================================

# Win32 Constants
WM_LBUTTONDOWN = 0x0201
WM_RBUTTONDOWN = 0x0204
WM_MBUTTONDOWN = 0x0207
WM_KEYDOWN     = 0x0100
WM_SYSKEYDOWN  = 0x0104
WM_QUIT        = 0x0012

WH_MOUSE_LL    = 14
WH_KEYBOARD_LL = 13

VK_RETURN      = 0x0D
VK_TAB         = 0x09
VK_ESCAPE      = 0x1B
VK_BACK        = 0x08
VK_SPACE       = 0x20
VK_LEFT        = 0x25
VK_UP          = 0x26
VK_RIGHT       = 0x27
VK_DOWN        = 0x28

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

# Win32 Structures
class POINT(Structure):
    _fields_ = [("x", c_long), ("y", c_long)]

class MSLLHOOKSTRUCT(Structure):
    _fields_ = [
        ("pt", POINT),
        ("mouseData", c_ulong),
        ("flags", c_ulong),
        ("time", c_ulong),
        ("dwExtraInfo", POINTER(c_ulong))
    ]

class KBDLLHOOKSTRUCT(Structure):
    _fields_ = [
        ("vkCode", c_ulong),
        ("scanCode", c_ulong),
        ("flags", c_ulong),
        ("time", c_ulong),
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

# Win32 Function Prototypes Definition
user32 = WinDLL('user32', use_last_error=True)
kernel32 = WinDLL('kernel32', use_last_error=True)

# USER32 Bindings
user32.GetForegroundWindow.restype = c_void_p
user32.GetForegroundWindow.argtypes = []

user32.GetWindowThreadProcessId.restype = c_ulong
user32.GetWindowThreadProcessId.argtypes = [c_void_p, POINTER(c_ulong)]

user32.GetWindowTextLengthW.restype = c_int
user32.GetWindowTextLengthW.argtypes = [c_void_p]

user32.GetWindowTextW.restype = c_int
user32.GetWindowTextW.argtypes = [c_void_p, c_wchar_p, c_int]

user32.GetClassNameW.restype = c_int
user32.GetClassNameW.argtypes = [c_void_p, c_wchar_p, c_int]

user32.GetCursorPos.restype = c_int
user32.GetCursorPos.argtypes = [POINTER(POINT)]

user32.WindowFromPoint.restype = c_void_p
user32.WindowFromPoint.argtypes = [POINT]

HOOKPROC = WINFUNCTYPE(c_long, c_int, c_void_p, c_void_p)

user32.SetWindowsHookExW.restype = c_void_p
user32.SetWindowsHookExW.argtypes = [c_int, HOOKPROC, c_void_p, c_ulong]

user32.UnhookWindowsHookEx.restype = c_int
user32.UnhookWindowsHookEx.argtypes = [c_void_p]

user32.CallNextHookEx.restype = c_long
user32.CallNextHookEx.argtypes = [c_void_p, c_int, c_void_p, c_void_p]

user32.GetMessageW.restype = c_int
user32.GetMessageW.argtypes = [POINTER(MSG), c_void_p, c_uint, c_uint]

user32.TranslateMessage.restype = c_int
user32.TranslateMessage.argtypes = [POINTER(MSG)]

user32.DispatchMessageW.restype = c_long
user32.DispatchMessageW.argtypes = [POINTER(MSG)]

user32.PostThreadMessageW.restype = c_int
user32.PostThreadMessageW.argtypes = [c_ulong, c_uint, c_void_p, c_void_p]

# KERNEL32 Bindings
kernel32.OpenProcess.restype = c_void_p
kernel32.OpenProcess.argtypes = [c_ulong, c_int, c_ulong]

kernel32.CloseHandle.restype = c_int
kernel32.CloseHandle.argtypes = [c_void_p]

kernel32.QueryFullProcessImageNameW.restype = c_int
kernel32.QueryFullProcessImageNameW.argtypes = [c_void_p, c_ulong, c_wchar_p, POINTER(c_ulong)]

kernel32.IsWow64Process.restype = c_int
kernel32.IsWow64Process.argtypes = [c_void_p, POINTER(c_int)]

kernel32.GetCurrentThreadId.restype = c_ulong
kernel32.GetCurrentThreadId.argtypes = []

# OLE32 / OLEAUT32 COM Initialization & BSTR handling
ole32 = OleDLL('ole32', use_last_error=True)
oleaut32 = OleDLL('oleaut32', use_last_error=True)

ole32.CoInitializeEx.restype = HRESULT
ole32.CoInitializeEx.argtypes = [c_void_p, c_ulong]

ole32.CoUninitialize.restype = None
ole32.CoUninitialize.argtypes = []

oleaut32.SysFreeString.restype = None
oleaut32.SysFreeString.argtypes = [c_void_p]

oleaut32.SysStringLen.restype = c_uint
oleaut32.SysStringLen.argtypes = [c_void_p]

# =============================================================================
# 2. UI AUTOMATION COM INTERACTION (ctypes)
# =============================================================================

# Correct C-compatible GUID Structure (BYTE Data4[8])
class GUID(Structure):
    _fields_ = [
        ("Data1", c_ulong),
        ("Data2", c_uint),
        ("Data3", c_uint),
        ("Data4", c_ubyte * 8)
    ]
    def __init__(self, l, w1, w2, b1, b2, b3, b4, b5, b6, b7, b8):
        self.Data1 = l
        self.Data2 = w1
        self.Data3 = w2
        self.Data4 = (c_ubyte * 8)(b1, b2, b3, b4, b5, b6, b7, b8)

# CLSID & IID Definitions
CLSID_CUIAutomation = GUID(0xff4384a0, 0x9e5c, 0x11d3, 0xa8, 0x60, 0x00, 0x10, 0x5a, 0x03, 0xb8, 0x3d)
IID_IUIAutomation   = GUID(0x30cbe57d, 0xd9d0, 0x452a, 0xab, 0x13, 0x7a, 0xc5, 0xac, 0x48, 0x25, 0xee)

# UIA ControlType IDs
UIA_ButtonControlTypeId   = 50000
UIA_CalendarControlTypeId = 50001
UIA_CheckBoxControlTypeId = 50002
UIA_ComboBoxControlTypeId = 50003
UIA_EditControlTypeId     = 50004
UIA_HyperlinkControlTypeId= 50005
UIA_ImageControlTypeId    = 50006
UIA_ListItemControlTypeId = 50007
UIA_ListControlTypeId     = 50008
UIA_MenuControlTypeId     = 50009
UIA_MenuBarControlTypeId  = 50010
UIA_MenuItemControlTypeId = 50011
UIA_ProgressBarControlTypeId = 50012
UIA_RadioButtonControlTypeId = 50013
UIA_ScrollBarControlTypeId = 50014
UIA_SliderControlTypeId   = 50015
UIA_SpinnerControlTypeId  = 50016
UIA_StatusBarControlTypeId= 50017
UIA_TabControlTypeId      = 50018
UIA_TabItemControlTypeId  = 50019
UIA_TextControlTypeId     = 50020
UIA_ToolBarControlTypeId  = 50021
UIA_ToolTipControlTypeId  = 50022
UIA_TreeControlTypeId     = 50023
UIA_TreeItemControlTypeId = 50024
UIA_CustomControlTypeId   = 50025
UIA_GroupControlTypeId    = 50026
UIA_ThumbControlTypeId    = 50027
UIA_DataGridControlTypeId = 50028
UIA_DataItemControlTypeId = 50029
UIA_DocumentControlTypeId = 50030
UIA_PaneControlTypeId     = 50033
UIA_WindowControlTypeId   = 50032

UIA_CONTROL_TYPE_MAP = {
    UIA_ButtonControlTypeId: "Button",
    UIA_CheckBoxControlTypeId: "CheckBox",
    UIA_ComboBoxControlTypeId: "ComboBox",
    UIA_EditControlTypeId: "Edit/Input",
    UIA_ImageControlTypeId: "Image",
    UIA_ListControlTypeId: "List",
    UIA_ListItemControlTypeId: "ListItem",
    UIA_MenuControlTypeId: "Menu",
    UIA_MenuItemControlTypeId: "MenuItem",
    UIA_PaneControlTypeId: "Pane",
    UIA_RadioButtonControlTypeId: "RadioButton",
    UIA_TextControlTypeId: "Text",
    UIA_WindowControlTypeId: "Window",
    UIA_CustomControlTypeId: "Custom"
}

UIA_ValuePatternId = 10002

def bstr_to_str(bstr_ptr):
    """Converts a BSTR pointer to Python string and frees the BSTR memory."""
    if not bstr_ptr:
        return ""
    length = oleaut32.SysStringLen(bstr_ptr)
    if length == 0:
        oleaut32.SysFreeString(bstr_ptr)
        return ""
    raw_str = ctypes.string_at(bstr_ptr, length * 2)
    val = raw_str.decode('utf-16le', errors='replace')
    oleaut32.SysFreeString(bstr_ptr)
    return val

# COM Interfaces using ctypes
class IUnknown(Structure):
    pass

IUnknown._fields_ = [("lpVtbl", POINTER(c_void_p))]

class IUIAutomationElement(Structure):
    pass

class IUIAutomationElementVtbl(Structure):
    _fields_ = [
        ("QueryInterface", c_void_p),
        ("AddRef", c_void_p),
        ("Release", WINFUNCTYPE(c_ulong, POINTER(IUIAutomationElement))),
        # Basic Properties
        ("SetFocus", c_void_p),
        ("GetRuntimeId", c_void_p),
        ("FindFirst", c_void_p),
        ("FindAll", c_void_p),
        ("FindFirstBuildCache", c_void_p),
        ("FindAllBuildCache", c_void_p),
        ("BuildUpdatedCache", c_void_p),
        ("GetCurrentPropertyValue", c_void_p),
        ("GetCurrentPropertyValueEx", c_void_p),
        ("GetCachedPropertyValue", c_void_p),
        ("GetCachedPropertyValueEx", c_void_p),
        ("GetCurrentPatternAs", c_void_p),
        ("GetCachedPatternAs", c_void_p),
        ("GetCurrentPattern", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), c_int, POINTER(POINTER(IUnknown)))),
        ("GetCachedPattern", c_void_p),
        ("GetCachedParent", c_void_p),
        ("GetCachedChildren", c_void_p),
        # Direct Property Getters
        ("get_CurrentProcessId", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_int))),
        ("get_CurrentControlType", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_int))),
        ("get_CurrentLocalizedControlType", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_void_p))),
        ("get_CurrentName", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_void_p))),
        ("get_CurrentAutomationId", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_void_p))),
        ("get_CurrentClassName", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_void_p))),
        ("get_CurrentHelpText", c_void_p),
        ("get_CurrentCulture", c_void_p),
        ("get_CurrentIsControlElement", c_void_p),
        ("get_CurrentIsContentElement", c_void_p),
        ("get_CurrentIsPassword", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_int))),
        ("get_CurrentNativeWindowHandle", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_void_p))),
        ("get_CurrentItemType", c_void_p),
        ("get_CurrentIsOffscreen", c_void_p),
        ("get_CurrentOrientation", c_void_p),
        ("get_CurrentFrameworkId", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_void_p))),
        ("get_CurrentHasKeyboardFocus", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationElement), POINTER(c_int))),
    ]

IUIAutomationElement._fields_ = [("lpVtbl", POINTER(IUIAutomationElementVtbl))]

class IUIAutomationValuePattern(Structure):
    pass

class IUIAutomationValuePatternVtbl(Structure):
    _fields_ = [
        ("QueryInterface", c_void_p),
        ("AddRef", c_void_p),
        ("Release", WINFUNCTYPE(c_ulong, POINTER(IUIAutomationValuePattern))),
        ("SetValue", c_void_p),
        ("get_CurrentValue", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationValuePattern), POINTER(c_void_p))),
        ("get_CurrentIsReadOnly", WINFUNCTYPE(HRESULT, POINTER(IUIAutomationValuePattern), POINTER(c_int))),
    ]

IUIAutomationValuePattern._fields_ = [("lpVtbl", POINTER(IUIAutomationValuePatternVtbl))]

class IUIAutomation(Structure):
    pass

class IUIAutomationVtbl(Structure):
    _fields_ = [
        ("QueryInterface", c_void_p),
        ("AddRef", c_void_p),
        ("Release", WINFUNCTYPE(c_ulong, POINTER(IUIAutomation))),
        ("Compare", c_void_p),
        ("CompareElements", c_void_p),
        ("GetRootElement", c_void_p),
        ("ElementFromHandle", c_void_p),
        ("ElementFromPoint", WINFUNCTYPE(HRESULT, POINTER(IUIAutomation), POINT, POINTER(POINTER(IUIAutomationElement)))),
        ("GetFocusedElement", WINFUNCTYPE(HRESULT, POINTER(IUIAutomation), POINTER(POINTER(IUIAutomationElement)))),
    ]

IUIAutomation._fields_ = [("lpVtbl", POINTER(IUIAutomationVtbl))]

# Initialize UIAutomation COM instance safely
_uia_instance = None

def get_uia_instance():
    global _uia_instance
    if _uia_instance is None:
        try:
            ole32.CoInitializeEx(None, 0x0) # COINIT_APARTMENTTHREADED
            uia_ptr = POINTER(IUIAutomation)()
            hr = ole32.CoCreateInstance(
                byref(CLSID_CUIAutomation),
                None,
                1, # CLSCTX_INPROC_SERVER
                byref(IID_IUIAutomation),
                byref(uia_ptr)
            )
            if hr == 0 and uia_ptr:
                _uia_instance = uia_ptr
        except Exception:
            _uia_instance = None
    return _uia_instance


# =============================================================================
# 3. LOGGER (THREAD-SAFE TXT & JSON)
# =============================================================================

class DiagnosticLogger:
    def __init__(self, txt_filename="weighing_spy_log.txt", json_filename="weighing_spy_log.json"):
        self.txt_filename = txt_filename
        self.json_filename = json_filename
        self.lock = threading.Lock()
        self.json_data = []
        
        # Initialize log files
        try:
            with open(self.txt_filename, "a", encoding="utf-8") as f:
                f.write(f"\n=== WEIGHING SPY SESSION STARTED: {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        except Exception as e:
            print(f"[WARNING] Could not write to TXT log file: {e}")

    def log_event(self, record: dict):
        with self.lock:
            # Console Output
            ts = record.get("timestamp_str", "")
            event_type = record.get("event_type", "EVENT")
            event_id = record.get("event_id", 0)
            
            print(f"\n[{ts}] [EVENT #{event_id:04d}] [{event_type}]")
            
            if "coordinate" in record:
                pt = record["coordinate"]
                print(f"  Coordinate    : X={pt.get('x')} Y={pt.get('y')}")
            
            if "process" in record:
                pr = record["process"]
                print(f"  Process       : {pr.get('name')} (PID: {pr.get('pid')})")
                print(f"  Architecture  : {pr.get('architecture')}")
                if pr.get("technology_heuristic"):
                    tech = pr["technology_heuristic"]
                    print(f"  Technology    : {tech.get('possible_tech')} (Confidence: {tech.get('confidence')})")

            if "active_window" in record:
                aw = record["active_window"]
                print(f"  Active Window : '{aw.get('title')}' (Class: {aw.get('class')})")

            if "target_control" in record:
                tc = record["target_control"]
                print(f"  Target Control: Type={tc.get('type')}, Name='{tc.get('name')}', AutomationID='{tc.get('automation_id')}'")
                if tc.get("value") is not None:
                    print(f"  Value         : {tc.get('value')}")

            if "observed_state_change" in record:
                sc = record["observed_state_change"]
                print(f"  [OBSERVED STATE CHANGE] -> {sc.get('description')}")
                if "details" in sc:
                    for d in sc["details"]:
                        print(f"    * {d}")

            if "warning" in record:
                print(f"  [WARNING] {record['warning']}")

            # File Writes (Fail-safe)
            try:
                with open(self.txt_filename, "a", encoding="utf-8") as f:
                    f.write(f"[{ts}] [EVENT #{event_id:04d}] [{event_type}]\n")
                    f.write(json.dumps(record, indent=2, default=str) + "\n" + ("-"*50) + "\n")
            except Exception as e:
                print(f"[WARNING] TXT Logging failed: {e}")

            try:
                self.json_data.append(record)
                with open(self.json_filename, "w", encoding="utf-8") as f:
                    json.dump(self.json_data, f, indent=2, default=str)
            except Exception as e:
                print(f"[WARNING] JSON Logging failed: {e}")

    def log_warning(self, msg: str):
        print(f"[WARNING] {msg}")


# =============================================================================
# 4. PROCESS & WINDOW INSPECTORS
# =============================================================================

class ProcessInspector:
    @staticmethod
    def inspect_process(pid: int) -> dict:
        if not pid:
            return {
                "pid": 0,
                "name": "Unknown",
                "path": "Unknown",
                "architecture": "Unknown",
                "technology_heuristic": {"possible_tech": "UNKNOWN", "confidence": "Unknown"}
            }

        # Open process handle with limited query information
        h_process = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h_process:
            return {
                "pid": pid,
                "name": "Access Denied / Unknown",
                "path": "Access Denied",
                "architecture": "Unknown",
                "technology_heuristic": {"possible_tech": "UNKNOWN", "confidence": "Unknown"}
            }

        try:
            buf = (c_wchar * 1024)()
            size = c_ulong(1024)
            # Query full process image name from kernel32.dll
            if kernel32.QueryFullProcessImageNameW(h_process, 0, buf, byref(size)):
                exe_path = buf.value
                exe_name = os.path.basename(exe_path)
            else:
                exe_path = "Unknown"
                exe_name = "Unknown"

            # Architecture Detection
            is_wow64 = c_int(0)
            if kernel32.IsWow64Process(h_process, byref(is_wow64)):
                arch = "x86 (32-bit)" if is_wow64.value else "x64 (64-bit)"
            else:
                arch = "Unknown"

            return {
                "pid": pid,
                "name": exe_name,
                "path": exe_path,
                "architecture": arch,
                "technology_heuristic": ProcessInspector._heuristic_tech(exe_name, exe_path)
            }
        except Exception:
            return {
                "pid": pid,
                "name": "Error During Inspection",
                "path": "Unknown",
                "architecture": "Unknown",
                "technology_heuristic": {"possible_tech": "UNKNOWN", "confidence": "Unknown"}
            }
        finally:
            kernel32.CloseHandle(h_process)

    @staticmethod
    def _heuristic_tech(exe_name: str, exe_path: str) -> dict:
        """Heuristic evaluation based on observable process artifacts."""
        exe_lower = exe_name.lower()
        
        if any(k in exe_lower for k in ["javaw.exe", "java.exe"]):
            return {"possible_tech": "POSSIBLE Java Swing/AWT/FX", "confidence": "High"}
        
        if any(k in exe_lower for k in ["python.exe", "pythonw.exe"]):
            return {"possible_tech": "POSSIBLE Python (Tkinter/PyQt)", "confidence": "High"}

        return {"possible_tech": "POSSIBLE Win32 / Native / .NET / Delphi", "confidence": "Low"}


class WindowInspector:
    @staticmethod
    def get_window_info(hwnd) -> dict:
        if not hwnd:
            return {"hwnd": 0, "title": "N/A", "class": "N/A", "pid": 0}

        try:
            # Get Title
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = (c_wchar * (length + 1))()
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value
            else:
                title = "<No Title>"

            # Get Class Name
            class_buf = (c_wchar * 256)()
            user32.GetClassNameW(hwnd, class_buf, 256)
            class_name = class_buf.value

            # Get PID
            pid = c_ulong()
            user32.GetWindowThreadProcessId(hwnd, byref(pid))

            return {
                "hwnd": int(hwnd),
                "title": title,
                "class": class_name,
                "pid": pid.value
            }
        except Exception:
            return {"hwnd": int(hwnd) if hwnd else 0, "title": "Unknown", "class": "Unknown", "pid": 0}

    @staticmethod
    def detect_technology_from_class(class_name: str) -> dict:
        """Heuristic detection based on Window Class Name."""
        cn = class_name.upper()
        
        if cn.startswith("TFORM") or cn.startswith("TAPPLICATION") or "DELPHI" in cn:
            return {"possible_tech": "POSSIBLE Delphi / C++Builder", "confidence": "High"}
        if "WINDOWSFORMS" in cn:
            return {"possible_tech": "POSSIBLE .NET WinForms", "confidence": "High"}
        if "WPF" in cn or "HwndWrapper" in cn:
            return {"possible_tech": "POSSIBLE .NET WPF", "confidence": "High"}
        if cn.startswith("QT") or "QWIDGET" in cn:
            return {"possible_tech": "POSSIBLE Qt", "confidence": "High"}
        if "SUNAWT" in cn:
            return {"possible_tech": "POSSIBLE Java AWT/Swing", "confidence": "High"}
        if cn in ["BUTTON", "EDIT", "STATIC", "COMBOBOX", "LISTBOX", "#32770"]:
            return {"possible_tech": "POSSIBLE Standard Win32 Controls", "confidence": "Medium"}

        return {"possible_tech": "POSSIBLE Native Win32 / Custom UI", "confidence": "Low"}


# =============================================================================
# 5. UI AUTOMATION INSPECTOR (FAIL-SAFE COM)
# =============================================================================

class UIAutomationInspector:
    @staticmethod
    def extract_element_info(elem_ptr) -> dict:
        if not elem_ptr:
            return {"status": "unavailable", "reason": "Null Pointer"}

        res = {"status": "available"}
        try:
            elem = elem_ptr.contents

            # 1. Control Type
            ctype = c_int()
            if elem.lpVtbl.contents.get_CurrentControlType(elem_ptr, byref(ctype)) == 0:
                res["type_id"] = ctype.value
                res["type"] = UIA_CONTROL_TYPE_MAP.get(ctype.value, f"Custom ({ctype.value})")
            else:
                res["type"] = "Unknown"

            # 2. Name
            bstr_name = c_void_p()
            if elem.lpVtbl.contents.get_CurrentName(elem_ptr, byref(bstr_name)) == 0:
                res["name"] = bstr_to_str(bstr_name)
            else:
                res["name"] = "N/A"

            # 3. Automation ID
            bstr_autoid = c_void_p()
            if elem.lpVtbl.contents.get_CurrentAutomationId(elem_ptr, byref(bstr_autoid)) == 0:
                res["automation_id"] = bstr_to_str(bstr_autoid)
            else:
                res["automation_id"] = "N/A"

            # 4. Class Name
            bstr_class = c_void_p()
            if elem.lpVtbl.contents.get_CurrentClassName(elem_ptr, byref(bstr_class)) == 0:
                res["class_name"] = bstr_to_str(bstr_class)
            else:
                res["class_name"] = "N/A"

            # 5. Is Password
            is_pw = c_int()
            if elem.lpVtbl.contents.get_CurrentIsPassword(elem_ptr, byref(is_pw)) == 0:
                res["is_password"] = bool(is_pw.value)
            else:
                res["is_password"] = False

            # 6. Has Focus
            has_focus = c_int()
            if elem.lpVtbl.contents.get_CurrentHasKeyboardFocus(elem_ptr, byref(has_focus)) == 0:
                res["has_focus"] = bool(has_focus.value)

            # 7. Value Pattern (Read Value)
            if res.get("is_password"):
                res["value"] = "[REDACTED]"
            else:
                pattern_ptr = POINTER(IUnknown)()
                hr = elem.lpVtbl.contents.GetCurrentPattern(elem_ptr, UIA_ValuePatternId, byref(pattern_ptr))
                if hr == 0 and pattern_ptr:
                    val_pattern = cast(pattern_ptr, POINTER(IUIAutomationValuePattern))
                    bstr_val = c_void_p()
                    if val_pattern.contents.lpVtbl.contents.get_CurrentValue(val_pattern, byref(bstr_val)) == 0:
                        res["value"] = bstr_to_str(bstr_val)
                    val_pattern.contents.lpVtbl.contents.Release(val_pattern)

            return res
        except Exception as e:
            return {"status": "unavailable", "reason": f"Exception: {str(e)}"}
        finally:
            try:
                elem_ptr.contents.lpVtbl.contents.Release(elem_ptr)
            except Exception:
                pass

    @staticmethod
    def get_element_from_point(x: int, y: int) -> dict:
        uia = get_uia_instance()
        if not uia:
            return {"status": "unavailable", "reason": "COM UIA Instance Not Available"}

        try:
            pt = POINT(x, y)
            elem_ptr = POINTER(IUIAutomationElement)()
            hr = uia.contents.lpVtbl.contents.ElementFromPoint(uia, pt, byref(elem_ptr))
            if hr == 0 and elem_ptr:
                return UIAutomationInspector.extract_element_info(elem_ptr)
            return {"status": "unavailable", "reason": f"ElementFromPoint Failed (HR={hr})"}
        except Exception as e:
            return {"status": "unavailable", "reason": str(e)}

    @staticmethod
    def get_focused_element() -> dict:
        uia = get_uia_instance()
        if not uia:
            return {"status": "unavailable", "reason": "COM UIA Instance Not Available"}

        try:
            elem_ptr = POINTER(IUIAutomationElement)()
            hr = uia.contents.lpVtbl.contents.GetFocusedElement(uia, byref(elem_ptr))
            if hr == 0 and elem_ptr:
                return UIAutomationInspector.extract_element_info(elem_ptr)
            return {"status": "unavailable", "reason": f"GetFocusedElement Failed (HR={hr})"}
        except Exception as e:
            return {"status": "unavailable", "reason": str(e)}


# =============================================================================
# 6. WORKER THREAD & EVENT RECORDER
# =============================================================================

class DiagnosticWorker(threading.Thread):
    def __init__(self, event_queue: queue.Queue, logger: DiagnosticLogger):
        super().__init__(daemon=True)
        self.event_queue = event_queue
        self.logger = logger
        self.running = True

    def run(self):
        while self.running:
            try:
                event = self.event_queue.get(timeout=0.2)
            except queue.Empty:
                continue

            try:
                self._process_event(event)
            except Exception as e:
                # Exception Boundary
                self.logger.log_warning(f"Worker Exception on event process: {e}\n{traceback.format_exc()}")
            finally:
                self.event_queue.task_done()

    def stop(self):
        self.running = False

    def _process_event(self, raw_event: dict):
        event_type = raw_event["event_type"]
        timestamp_str = time.strftime("%H:%M:%S", time.localtime(raw_event["timestamp"])) + f".{int((raw_event['timestamp'] % 1) * 1000):03d}"
        
        record = {
            "event_id": raw_event["event_id"],
            "timestamp": raw_event["timestamp"],
            "timestamp_str": timestamp_str,
            "event_type": event_type,
        }

        # Active Window
        hwnd_fg = user32.GetForegroundWindow()
        active_win = WindowInspector.get_window_info(hwnd_fg)
        record["active_window"] = active_win

        # Process Details
        proc_info = ProcessInspector.inspect_process(active_win["pid"])
        # Merge class tech heuristic
        tech = WindowInspector.detect_technology_from_class(active_win["class"])
        if tech["confidence"] == "High" or proc_info["technology_heuristic"]["confidence"] == "Low":
            proc_info["technology_heuristic"] = tech
        record["process"] = proc_info

        if "MOUSE" in event_type:
            x, y = raw_event["x"], raw_event["y"]
            record["coordinate"] = {"x": x, "y": y}

            # BEFORE SNAPSHOT (Immediate inspection)
            target_control = UIAutomationInspector.get_element_from_point(x, y)
            
            # Fallback Win32 if UI Automation fails
            if target_control.get("status") != "available":
                pt = POINT(x, y)
                hwnd_target = user32.WindowFromPoint(pt)
                target_win = WindowInspector.get_window_info(hwnd_target)
                target_control = {
                    "status": "fallback_win32",
                    "type": "Win32 Window/Control",
                    "name": target_win["title"],
                    "class_name": target_win["class"],
                    "automation_id": "N/A",
                    "hwnd": target_win["hwnd"]
                }
            
            record["target_control"] = target_control

            # Write event log immediately
            self.logger.log_event(record)

            # AFTER SNAPSHOT (Delayed comparison for observable state change)
            time.sleep(0.3) # 300ms delay for UI response
            after_target = UIAutomationInspector.get_element_from_point(x, y)
            after_focused = UIAutomationInspector.get_focused_element()

            state_changes = []
            
            # Compare target value change
            before_val = target_control.get("value")
            after_val = after_target.get("value")
            if before_val is not None and after_val is not None and before_val != after_val:
                state_changes.append(f"Target Value Changed: '{before_val}' -> '{after_val}'")

            # Check if focus shifted
            if after_focused.get("status") == "available":
                focus_name = after_focused.get("name", "N/A")
                focus_type = after_focused.get("type", "N/A")
                state_changes.append(f"Current Focus: {focus_type} ('{focus_name}')")

            if state_changes:
                change_record = {
                    "event_id": raw_event["event_id"] + 10000, # Correlated change event
                    "timestamp": time.time(),
                    "timestamp_str": time.strftime("%H:%M:%S"),
                    "event_type": "OBSERVED STATE CHANGE",
                    "correlated_to_event_id": raw_event["event_id"],
                    "observed_state_change": {
                        "description": "UI State transition detected post-click",
                        "details": state_changes
                    }
                }
                self.logger.log_event(change_record)

        elif "KEYBOARD" in event_type:
            vk_code = raw_event["vk_code"]
            key_name = raw_event["key_name"]
            record["keyboard"] = {"vk_code": vk_code, "key_name": key_name}

            # Field Focus Observation
            focused_elem = UIAutomationInspector.get_focused_element()
            if focused_elem.get("status") == "available":
                record["focused_field"] = {
                    "type": focused_elem.get("type"),
                    "name": focused_elem.get("name"),
                    "automation_id": focused_elem.get("automation_id"),
                    "value": focused_elem.get("value", "UNAVAILABLE")
                }

            self.logger.log_event(record)


# =============================================================================
# 7. HOOK THREAD (WH_MOUSE_LL & WH_KEYBOARD_LL)
# =============================================================================

class HookThread(threading.Thread):
    def __init__(self, event_queue: queue.Queue):
        super().__init__(daemon=True)
        self.event_queue = event_queue
        self.win32_thread_id = 0
        self.h_mouse_hook = None
        self.h_kbd_hook = None
        self.event_counter = 0
        
        # Keep callbacks alive in memory to avoid Garbage Collection crash!
        self._mouse_proc = HOOKPROC(self._mouse_hook_proc)
        self._kbd_proc = HOOKPROC(self._kbd_hook_proc)

    def run(self):
        # Capture explicit Windows Thread ID
        self.win32_thread_id = kernel32.GetCurrentThreadId()

        # Set Hooks
        self.h_mouse_hook = user32.SetWindowsHookExW(WH_MOUSE_LL, self._mouse_proc, None, 0)
        self.h_kbd_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._kbd_proc, None, 0)

        if not self.h_mouse_hook or not self.h_kbd_hook:
            print("[FATAL ERROR] Failed to initialize Low-Level Windows Hooks.")
            return

        # Windows Message Loop (Mandatory for Low-Level Hooks)
        msg = MSG()
        while user32.GetMessageW(byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(byref(msg))
            user32.DispatchMessageW(byref(msg))

        # Cleanup hooks on exit
        if self.h_mouse_hook:
            user32.UnhookWindowsHookEx(self.h_mouse_hook)
        if self.h_kbd_hook:
            user32.UnhookWindowsHookEx(self.h_kbd_hook)

    def stop(self):
        if self.win32_thread_id:
            user32.PostThreadMessageW(self.win32_thread_id, WM_QUIT, 0, 0)

    # ---------------------------------------------------------
    # Exception-Safe Hook Callbacks (Ultra Lightweight)
    # ---------------------------------------------------------
    def _mouse_hook_proc(self, nCode, wParam, lParam):
        try:
            if nCode >= 0:
                if wParam in (WM_LBUTTONDOWN, WM_RBUTTONDOWN, WM_MBUTTONDOWN):
                    ms = cast(lParam, POINTER(MSLLHOOKSTRUCT)).contents
                    self.event_counter += 1
                    
                    btn_map = {WM_LBUTTONDOWN: "LEFT CLICK", WM_RBUTTONDOWN: "RIGHT CLICK", WM_MBUTTONDOWN: "MIDDLE CLICK"}
                    
                    raw_event = {
                        "event_id": self.event_counter,
                        "timestamp": time.time(),
                        "event_type": f"MOUSE {btn_map.get(wParam, 'CLICK')}",
                        "x": ms.pt.x,
                        "y": ms.pt.y
                    }
                    self.event_queue.put(raw_event)
        except Exception:
            pass # Zero crash tolerance inside hook
        return user32.CallNextHookEx(self.h_mouse_hook, nCode, wParam, lParam)

    def _kbd_hook_proc(self, nCode, wParam, lParam):
        try:
            if nCode >= 0 and wParam in (WM_KEYDOWN, WM_SYSKEYDOWN):
                kb = cast(lParam, POINTER(KBDLLHOOKSTRUCT)).contents
                vk = kb.vkCode

                # Filter key events to target navigation & diagnostic keys
                if vk in (VK_RETURN, VK_TAB, VK_ESCAPE, VK_BACK, VK_SPACE) or (VK_LEFT <= vk <= VK_DOWN):
                    self.event_counter += 1
                    key_names = {
                        VK_RETURN: "ENTER", VK_TAB: "TAB", VK_ESCAPE: "ESCAPE",
                        VK_BACK: "BACKSPACE", VK_SPACE: "SPACE",
                        VK_LEFT: "LEFT_ARROW", VK_UP: "UP_ARROW", VK_RIGHT: "RIGHT_ARROW", VK_DOWN: "DOWN_ARROW"
                    }
                    
                    raw_event = {
                        "event_id": self.event_counter,
                        "timestamp": time.time(),
                        "event_type": f"KEYBOARD {key_names.get(vk, 'KEY')}",
                        "vk_code": vk,
                        "key_name": key_names.get(vk, "OTHER")
                    }
                    self.event_queue.put(raw_event)
        except Exception:
            pass # Zero crash tolerance inside hook
        return user32.CallNextHookEx(self.h_kbd_hook, nCode, wParam, lParam)


# =============================================================================
# 8. DIAGNOSTIC RECORDER MANAGER
# =============================================================================

class DiagnosticRecorder:
    def __init__(self):
        self.logger = DiagnosticLogger()
        self.event_queue = queue.Queue()
        self.worker = None
        self.hook_thread = None
        self.is_recording = False
        self.lock = threading.Lock()

    def start(self):
        with self.lock:
            if self.is_recording:
                print("\n[!] Recording is already active.")
                return

            self.event_queue = queue.Queue()
            self.worker = DiagnosticWorker(self.event_queue, self.logger)
            self.hook_thread = HookThread(self.event_queue)

            self.worker.start()
            self.hook_thread.start()
            self.is_recording = True
            print("\n[>>>] RECORDING STARTED. High-speed diagnostic hook is live.")

    def stop(self):
        with self.lock:
            if not self.is_recording:
                print("\n[!] Recording is not active.")
                return

            if self.hook_thread:
                self.hook_thread.stop()
            if self.worker:
                self.worker.stop()

            self.is_recording = False
            print("\n[===] RECORDING STOPPED. Hooks released cleanly.")


# =============================================================================
# 9. CLI COMMAND INTERFACE
# =============================================================================

class MainCLI:
    def __init__(self):
        self.recorder = DiagnosticRecorder()

    def display_menu(self):
        print("=" * 60)
        print(" WEIGHING SPY - Windows Diagnostic Recorder")
        print("=" * 60)
        print(f" Python Version : {sys.version.split()[0]}")
        print(f" OS Platform    : Microsoft Windows")
        print(f" Recording      : {'ACTIVE' if self.recorder.is_recording else 'INACTIVE'}")
        print("=" * 60)
        print(" Commands:")
        print("  [R] Start Recording")
        print("  [S] Stop Recording")
        print("  [D] Detect Active Window")
        print("  [I] Inspect Active Window / Cursor Focus")
        print("  [C] Copy/Print Active Target Diagnostic Summary")
        print("  [L] Show Last Recorded Events")
        print("  [Q] Quit")
        print("=" * 60)

    def run(self):
        while True:
            self.display_menu()
            cmd = input("Select command > ").strip().upper()

            if cmd == "R":
                self.recorder.start()

            elif cmd == "S":
                self.recorder.stop()

            elif cmd == "D":
                print("\n--- ACTIVE WINDOW DIAGNOSTIC ---")
                hwnd = user32.GetForegroundWindow()
                win_info = WindowInspector.get_window_info(hwnd)
                proc_info = ProcessInspector.inspect_process(win_info["pid"])
                tech = WindowInspector.detect_technology_from_class(win_info["class"])

                print(f"  HWND         : {win_info['hwnd']}")
                print(f"  Title        : {win_info['title']}")
                print(f"  Class Name   : {win_info['class']}")
                print(f"  PID          : {win_info['pid']}")
                print(f"  Process Name : {proc_info['name']}")
                print(f"  Exec Path    : {proc_info['path']}")
                print(f"  Architecture : {proc_info['architecture']}")
                print(f"  Technology   : {tech['possible_tech']} (Confidence: {tech['confidence']})")
                print("--------------------------------\n")

            elif cmd == "I":
                print("\n--- CURSOR & FOCUS INSPECTOR ---")
                pt = POINT()
                user32.GetCursorPos(byref(pt))
                print(f"  Cursor Position : X={pt.x}, Y={pt.y}")

                target = UIAutomationInspector.get_element_from_point(pt.x, pt.y)
                print("  Target Under Cursor:")
                print(f"    - Type         : {target.get('type')}")
                print(f"    - Name         : {target.get('name')}")
                print(f"    - AutomationID : {target.get('automation_id')}")
                print(f"    - Class        : {target.get('class_name')}")
                print(f"    - Value        : {target.get('value', 'N/A')}")

                focused = UIAutomationInspector.get_focused_element()
                print("  Focused Element:")
                print(f"    - Type         : {focused.get('type')}")
                print(f"    - Name         : {focused.get('name')}")
                print(f"    - AutomationID : {focused.get('automation_id')}")
                print(f"    - Value        : {focused.get('value', 'N/A')}")
                print("--------------------------------\n")

            elif cmd == "C":
                hwnd = user32.GetForegroundWindow()
                win_info = WindowInspector.get_window_info(hwnd)
                proc_info = ProcessInspector.inspect_process(win_info["pid"])
                tech = WindowInspector.detect_technology_from_class(win_info["class"])

                summary = f"""
--- TARGET DIAGNOSTIC SUMMARY ---
Process Name : {proc_info['name']}
PID          : {win_info['pid']}
Executable   : {proc_info['path']}
Architecture : {proc_info['architecture']}
Window Title : {win_info['title']}
Window Class : {win_info['class']}
Technology   : {tech['possible_tech']}
Confidence   : {tech['confidence']}
---------------------------------
"""
                print(summary)

            elif cmd == "L":
                print("\n--- LAST RECORDED EVENTS ---")
                events = self.recorder.logger.json_data[-5:]
                if not events:
                    print("  No events recorded yet.")
                else:
                    for ev in events:
                        print(f"  * #{ev.get('event_id', 0):04d} [{ev.get('event_type')}] - {ev.get('timestamp_str')}")
                print("----------------------------\n")

            elif cmd == "Q":
                print("\nExiting Weighing Spy...")
                self.recorder.stop()
                sys.exit(0)

            else:
                print("\n[!] Invalid option. Try again.")


# =============================================================================
# 10. ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    try:
        app = MainCLI()
        app.run()
    except KeyboardInterrupt:
        print("\n\nSession terminated by user.")
        sys.exit(0)