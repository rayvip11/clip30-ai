# Clip30 AI — Starter

Aplikasi web mobile untuk memotong video menjadi klip berurutan berdurasi 15/30/45/60 detik. Pemrosesan dilakukan di browser memakai FFmpeg.wasm.

## Fitur yang sudah tersedia
- Pilih video dari perangkat dan pratinjau metadata.
- Pemotongan otomatis berdasarkan durasi; klip terakhir dapat lebih pendek.
- Pilihan rasio 9:16, 16:9, 1:1 atau rasio asli.
- Pilihan batas resolusi.
- Unduh klip satu per satu atau sebagai ZIP.
- Antarmuka responsif untuk Android.

## Penting tentang fitur AI
Versi starter ini **belum memilih momen viral menggunakan AI**. Ia membagi video berurutan berdasarkan durasi. Pemilihan highlight otomatis memerlukan pipeline tambahan, misalnya transkripsi ucapan (ASR), deteksi adegan, analisis audio, dan penilaian segmen dengan model lokal. Prompt dan UI menyebutkan batasan ini dengan sengaja agar tidak menjanjikan kemampuan yang belum dibuat.

## Persyaratan
- Node.js 20+ direkomendasikan
- Koneksi internet saat pertama kali mengunduh dependensi dan FFmpeg core

## Jalankan lokal
```bash
npm install
npm run dev
```
Buka URL yang dicetak Vite, atau uji di HP yang berada pada jaringan Wi-Fi yang sama menggunakan alamat LAN yang ditampilkan.

## Build
```bash
npm run build
npm run preview
```
Output produksi berada di folder `dist`.

## Deploy Cloudflare Pages
1. Unggah folder proyek ini ke repositori GitHub.
2. Di Cloudflare Dashboard, buka **Workers & Pages** lalu buat aplikasi Pages yang terhubung ke repositori.
3. Atur:
   - Framework preset: **Vite** (atau None)
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Deploy, lalu tes URL `*.pages.dev`.

## Batasan / catatan teknis
- Browser HP memiliki batas memori. Video besar dapat lambat atau gagal; mulai dengan klip pendek untuk pengujian.
- FFmpeg core dimuat dari unpkg saat tombol proses digunakan. Untuk deployment produksi yang lebih tangguh, pin versi core yang cocok dan host file core/wasm dari aset aplikasi sendiri.
- Eksekusi FFmpeg WebAssembly memerlukan browser modern dan dukungan SharedArrayBuffer/worker sesuai konfigurasi browser. Bila gagal memuat, periksa console browser dan konfigurasi header keamanan/COOP/COEP yang berlaku untuk versi FFmpeg.
- Pemrosesan memakai encoding ulang agar batas klip lebih konsisten, sehingga proses lebih berat dan kualitas dapat sedikit berubah.
- Belum ada backend, akun pengguna, atau API AI berbayar.
- Jangan menganggap klaim “viral” dapat dijamin; performa klip bergantung pada isi video dan preferensi penonton.

## Stack
React, Vite, FFmpeg.wasm, JSZip, Lucide.
