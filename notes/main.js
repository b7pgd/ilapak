package main

import (
	"bufio"
	"fmt"
	"net"
	"strings"
)

func main() {
	port := "9100"
	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		fmt.Printf("Gagal menjalankan Mock Printer: %v\n", err)
		return
	}
	defer listener.Close()

	fmt.Printf("==================================================\n")
	fmt.Printf("   ZEBRA PRINTER EMULATOR (PORT %s) RUNNING...\n", port)
	fmt.Printf("   [100%% Standalone - Di Luar Project Utama]\n")
	fmt.Printf("==================================================\n")
	fmt.Printf("Menunggu koneksi dari aplikasi ZDPU lu...\n\n")

	for {
		conn, err := listener.Accept()
		if err != nil {
			fmt.Printf("Koneksi error: %v\n", err)
			continue
		}
		go handleConnection(conn)
	}
}

func handleConnection(conn net.Conn) {
	defer conn.Close()
	fmt.Printf("[+] Aplikasi Terhubung dari: %s\n", conn.RemoteAddr().String())

	reader := bufio.NewReader(conn)
	buffer := make([]byte, 4096)

	for {
		n, err := reader.Read(buffer)
		if err != nil {
			fmt.Printf("[-] Aplikasi Terputus\n\n")
			return
		}

		received := string(buffer[:n])
		fmt.Printf("\n--- DATA ZPL DITERIMA ---\n%s-------------------------\n", received)

		// Otomatis merespons jika aplikasi mengirim perintah cek status (~HS)
		if strings.Contains(received, "~HS") {
			// Mengirim balik response status Zebra normal (Paper OK, Ribbon OK, Ready)
			mockStatus := "\x02030,0,0,0800,000,0,0,0,000,0,0,0\x03\r\n"
			conn.Write([]byte(mockStatus))
			fmt.Println("[>] Membalas status printer simulator (~HS) ke aplikasi.")
		}
	}
}
