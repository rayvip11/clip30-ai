# Patch Clip30 AI + Gemini API

Paket ini berisi file pengganti UI dan Cloudflare Pages Function untuk analisis highlight dengan Gemini.

## Isi paket
- `src/App.jsx` — UI dan proses klip: mode Gemini AI / berurutan, analisis timestamp, pemotongan FFmpeg, unduh ZIP.
- `functions/api/analyze.js` — backend Cloudflare Pages Function yang memanggil Gemini API; API key tidak dikirim ke browser.

## Sebelum memasang
1. Buat API key resmi di https://aistudio.google.com/app/apikey
2. Di Cloudflare Dashboard, buka Workers & Pages → pilih project Clip30 AI → Settings → Variables and Secrets.
3. Tambahkan variable bertipe **Secret** dengan nama `GEMINI_API_KEY`, isi API key Gemini, lalu simpan/deploy.
4. Pastikan project yang di-deploy adalah Cloudflare **Pages** yang mendukung Functions dan terhubung ke GitHub. Folder `functions/` harus berada di root proyek, sejajar dengan `src/` dan `package.json`.

## Terapkan lewat GitHub di Android
1. Buka https://github.com/rayvip11/clip30-ai
2. Masuk ke `src/App.jsx`, tekan ikon pensil, ganti seluruh isi dengan file `src/App.jsx` dari ZIP ini, lalu Commit changes.
3. Kembali ke root repo, pilih Add file → Create new file.
4. Nama file: `functions/api/analyze.js`. Tempel seluruh isi file tersebut dari ZIP, lalu Commit changes.
5. Tunggu Cloudflare Pages selesai build/deploy.
6. Buka URL aplikasi dan uji dengan video pendek terlebih dahulu, mode Gemini AI.

## Catatan penting
- Model yang digunakan: `gemini-2.5-flash`. Jika Google mengubah ketersediaan model atau kuota, ubah konstanta `MODEL` di `functions/api/analyze.js` ke model yang tersedia di Google AI Studio.
- Analisis saat ini mengirim hingga 18 sampel gambar JPEG (bukan seluruh file video) ke Gemini. Ini adalah AI multimodal sungguhan, tetapi dapat melewatkan konteks di antara frame dan tidak menganalisis audio/transkrip. Tidak ada AI yang bisa menjamin klip viral.
- Video penuh tetap diproses lokal dengan FFmpeg di browser. Sampel gambar dikirim ke Gemini melalui backend Cloudflare.
- Gemini API memiliki kuota gratis yang terbatas dan dapat berubah. Saat kuota habis, UI akan menampilkan pesan kegagalan; tidak ada fallback otomatis yang menyamar sebagai AI.
- Jangan memasukkan API key ke `src/App.jsx`, `.env` yang di-commit, atau kode browser. Simpan hanya sebagai Cloudflare Secret.
- Untuk keamanan produksi, batasi penggunaan endpoint (rate limit / Turnstile) agar orang lain tidak dapat memakai kuota API Anda.
- Build output tetap `dist`; build command `npm run build`.
