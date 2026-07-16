@echo off
:: Menembak path absolut System32 agar Windows dijamin menemukan perintahnya
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem"

echo [~] Mendaftarkan Printer Zebra Virtual untuk Testing...
C:\Windows\System32\rundll32.exe printui.dll,PrintUIEntry /if /b "Zebra GT800 (Simulator)" /f %windir%\inf\ntprint.inf /r "LPT1:" /m "Generic / Text Only"

if %errorlevel% equ 0 (
    echo [OK] BERHASIL! Printer "Zebra GT800 (Simulator)" telah aktif.
    echo [i] Silakan jalankan Wails Dev / Exe ZDPU lu sekarang.
) else (
    echo [!] Masih gagal. Mencoba metode alternatif pendaftaran port...
    C:\Windows\System32\rundll32.exe printui.dll,PrintUIEntry /if /b "Zebra GT800 (Simulator)" /f %windir%\inf\ntprint.inf /r "FILE:" /m "Generic / Text Only"
)

pause
