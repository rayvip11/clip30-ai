import { useEffect, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

const styles = {
  page: { minHeight: '100vh', background: '#0b1020', color: '#f5f7ff', padding: '24px 14px 40px', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' },
  wrap: { maxWidth: 760, margin: '0 auto' },
  header: { textAlign: 'center', marginBottom: 24 },
  logo: { fontSize: 30, fontWeight: 850, letterSpacing: '-1px', margin: 0 },
  sub: { color: '#aab4d0', marginTop: 8, lineHeight: 1.5 },
  panel: { background: '#141b2f', border: '1px solid #29334f', borderRadius: 18, padding: 18, marginBottom: 14 },
  label: { display: 'block', fontWeight: 700, marginBottom: 8, fontSize: 14 },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 10, border: '1px solid #394765', background: '#0d1426', color: '#f5f7ff' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 12 },
  select: { width: '100%', boxSizing: 'border-box', padding: 11, borderRadius: 10, border: '1px solid #394765', background: '#0d1426', color: '#f5f7ff' },
  button: { width: '100%', border: 0, borderRadius: 12, padding: '14px 16px', fontWeight: 800, fontSize: 16, background: '#7c5cff', color: 'white', cursor: 'pointer' },
  secondary: { display: 'inline-block', borderRadius: 10, padding: '10px 13px', background: '#26324d', color: 'white', textDecoration: 'none', margin: '8px 8px 0 0', overflowWrap: 'anywhere' },
  muted: { color: '#aab4d0', fontSize: 13, lineHeight: 1.5 },
  error: { background: '#3a1724', border: '1px solid #8e3048', color: '#ffdce5', padding: 12, borderRadius: 10, marginTop: 12, overflowWrap: 'anywhere' },
  success: { background: '#123326', border: '1px solid #267b56', padding: 12, borderRadius: 10, marginTop: 12 },
  progress: { height: 10, background: '#29334f', borderRadius: 99, overflow: 'hidden', marginTop: 10 },
  progressFill: { height: '100%', background: '#7c5cff', transition: 'width .2s ease' },
  smallButton: { background: '#26324d', color: 'white', border: '1px solid #394765', borderRadius: 9, padding: '9px 12px', cursor: 'pointer' },
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function safeName(name) {
  return (name || 'video').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'video';
}


// Analisis lokal sederhana: membandingkan sampel frame untuk mencari perubahan adegan.
// Ini bukan pemahaman semantik AI, tetapi tidak membutuhkan API atau biaya tambahan.
async function findInterestingStarts(file, clipLength, duration, onProgress = () => {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('Browser tidak dapat membaca video untuk analisis momen.'));
    });

    const actualDuration = Number.isFinite(video.duration) ? video.duration : duration;
    const sampleStep = 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Browser tidak mendukung analisis frame pada perangkat ini.');

    const samples = [];
    for (let t = 0; t < actualDuration; t += sampleStep) {
      const targetTime = Math.min(t, Math.max(0, actualDuration - 0.05));
      if (Math.abs(video.currentTime - targetTime) > 0.01) {
        await new Promise((resolve, reject) => {
          let timeoutId;
          const done = () => {
            clearTimeout(timeoutId);
            resolve();
          };
          video.addEventListener('seeked', done, { once: true });
          timeoutId = setTimeout(() => {
            video.removeEventListener('seeked', done);
            reject(new Error('Analisis frame terlalu lama. Coba video yang lebih kecil.'));
          }, 8000);
          video.currentTime = targetTime;
        });
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
        gray[j] = Math.round((pixels[i] * 0.299) + (pixels[i + 1] * 0.587) + (pixels[i + 2] * 0.114));
      }
      samples.push({ time: t, gray });
      onProgress(Math.min(25, Math.round(((t + sampleStep) / actualDuration) * 25)));
    }

    if (samples.length < 2 || actualDuration <= clipLength) return [0];

    const changes = samples.map((sample, index) => {
      if (index === 0) return { time: sample.time, score: 0 };
      const prev = samples[index - 1].gray;
      let total = 0;
      for (let i = 0; i < prev.length; i++) total += Math.abs(sample.gray[i] - prev[i]);
      return { time: sample.time, score: total / (prev.length * 255) };
    });

    const maxStart = Math.max(0, actualDuration - clipLength);
    const step = 1.5;
    const candidates = [];
    for (let start = 0; start <= maxStart; start += step) {
      const end = Math.min(actualDuration, start + clipLength);
      const inside = changes.filter((change) => change.time >= start && change.time <= end);
      const sum = inside.reduce((acc, item) => acc + item.score, 0);
      const average = inside.length ? sum / inside.length : 0;
      candidates.push({ start, score: average + (sum / Math.max(1, inside.length)) });
    }

    // Divide the whole video into time regions and select the strongest candidate per region.
    // This prevents all selected clips from clustering near the beginning.
    const targetCount = Math.max(1, Math.ceil(actualDuration / clipLength));
    const regionCount = targetCount;
    const selected = [];
    for (let region = 0; region < regionCount; region++) {
      const regionStart = (actualDuration * region) / regionCount;
      const regionEnd = (actualDuration * (region + 1)) / regionCount;
      const regionCandidates = candidates.filter((candidate) =>
        candidate.start >= regionStart &&
        (candidate.start < regionEnd || region === regionCount - 1)
      );
      regionCandidates.sort((a, b) => b.score - a.score);
      if (regionCandidates.length) selected.push(regionCandidates[0].start);
    }

    const unique = [];
    for (const start of selected.sort((a, b) => a - b)) {
      if (unique.every((existing) => Math.abs(existing - start) >= Math.min(clipLength * 0.5, 5))) {
        unique.push(start);
      }
    }
    if (!unique.length) unique.push(0);
    return unique;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export default function App() {
  const ffmpegRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState('30');
  const [clipMode, setClipMode] = useState('sequential');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [ratio, setRatio] = useState('original');
  const [quality, setQuality] = useState('source');
  const [busy, setBusy] = useState(false);
  const [loadingEngine, setLoadingEngine] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Pilih video untuk memulai.');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [videoInfo, setVideoInfo] = useState(null);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function addLog(message) {
    setLogs((old) => [...old.slice(-79), message]);
  }

  async function loadFFmpeg() {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current;

    setLoadingEngine(true);
    setStatus('Memuat mesin pemrosesan video…');
    addLog('Memuat FFmpeg core dari unpkg.com');

    try {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress: value }) => {
        if (Number.isFinite(value)) setProgress(Math.max(0, Math.min(99, Math.round(value * 100))));
      });
      ffmpeg.on('log', ({ message }) => addLog(message));

      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      ffmpegRef.current = ffmpeg;
      addLog('FFmpeg berhasil dimuat.');
      return ffmpeg;
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      addLog(`GAGAL MEMUAT FFmpeg: ${detail}`);
      throw new Error(`Gagal memuat mesin FFmpeg. Pastikan koneksi internet stabil dan CDN unpkg.com tidak diblokir. Detail: ${detail}`);
    } finally {
      setLoadingEngine(false);
    }
  }

  function onChooseFile(nextFile) {
    setError('');
    setLogs([]);
    setResults([]);
    setProgress(0);
    setVideoInfo(null);
    setFile(nextFile || null);

    if (!nextFile) return;
    if (!nextFile.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(nextFile.name)) {
      setError('File yang dipilih tampaknya bukan video. Pilih file MP4, MOV, MKV, WebM, AVI, atau M4V.');
      setFile(null);
      return;
    }

    const url = URL.createObjectURL(nextFile);
    objectUrlsRef.current.push(url);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      setVideoInfo({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      URL.revokeObjectURL(url);
      objectUrlsRef.current = objectUrlsRef.current.filter((item) => item !== url);
    };
    video.onerror = () => {
      addLog('Browser tidak dapat membaca metadata video. FFmpeg masih akan mencoba memproses file.');
      URL.revokeObjectURL(url);
      objectUrlsRef.current = objectUrlsRef.current.filter((item) => item !== url);
    };
    video.src = url;
  }

  async function startProcessing() {
    if (!file || busy) return;

    setBusy(true);
    setError('');
    setResults([]);
    setProgress(0);
    setLogs([]);
    const outputUrls = [];

    try {
      if (file.size > 300 * 1024 * 1024) {
        addLog('Peringatan: file lebih besar dari 300 MB. Pemrosesan mungkin kehabisan memori di HP.');
      }

      const ffmpeg = await loadFFmpeg();
      setStatus('Menyiapkan video…');

      const inputExt = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
      const inputName = `input.${inputExt}`;
      const safeBase = safeName(file.name);
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      let filter = '';
      if (ratio === '9:16') {
        filter = 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2';
      } else if (ratio === '16:9') {
        filter = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';
      } else if (ratio === '1:1') {
        filter = 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2';
      } else if (quality === '720p') {
        filter = 'scale=-2:720:force_original_aspect_ratio=decrease';
      } else if (quality === '1080p') {
        filter = 'scale=-2:1080:force_original_aspect_ratio=decrease';
      }

      const clipLength = Number(duration);
      const totalDuration = videoInfo?.duration || clipLength;
      let starts = [];

      if (clipMode === 'auto') {
        setStatus('Menganalisis perubahan adegan untuk mencari momen…');
        addLog('Mode momen otomatis: analisis perubahan visual di browser, tanpa API.');
        starts = await findInterestingStarts(file, clipLength, totalDuration, (value) => {
          setProgress(value);
        });
        addLog(`Analisis selesai. Kandidat waktu mulai: ${starts.map((value) => value.toFixed(1)).join(', ')} detik.`);
      } else {
        for (let start = 0; start < totalDuration; start += clipLength) {
          if (start + 0.05 < totalDuration) starts.push(start);
        }
      }
      if (!starts.length) starts.push(0);

      const generated = [];
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const outName = `clip-${String(i + 1).padStart(3, '0')}.mp4`;
        setStatus(`Membuat klip ${i + 1} dari ${starts.length}…`);
        setProgress(Math.round((i / starts.length) * 100));

        const args = ['-ss', String(start), '-i', inputName, '-t', String(clipLength), '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn'];
        if (filter) args.push('-vf', filter);
        args.push(
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', quality === 'source' ? '23' : quality === '720p' ? '26' : quality === '1080p' ? '23' : '23',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-avoid_negative_ts', 'make_zero',
          outName
        );

        addLog(`Memproses ${outName}, mulai ${start.toFixed(1)} detik.`);
        const exitCode = await ffmpeg.exec(args);
        if (exitCode !== 0) throw new Error(`FFmpeg berhenti dengan kode ${exitCode} saat membuat ${outName}. Periksa log FFmpeg di bawah.`);
        const data = await ffmpeg.readFile(outName);
        if (!data || !data.length) throw new Error(`Klip ${outName} kosong. Coba video lain atau rasio Original.`);
        const blob = new Blob([data], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        outputUrls.push(url);
        generated.push({ name: `${safeBase}-clip-${String(i + 1).padStart(3, '0')}.mp4`, blob, url, size: blob.size, start });
        await ffmpeg.deleteFile(outName).catch(() => {});
      }

      await ffmpeg.deleteFile(inputName).catch(() => {});
      setResults(generated);
      setProgress(100);
      setStatus(`Selesai! ${generated.length} klip berhasil dibuat${clipMode === 'auto' ? ' dari pilihan momen otomatis' : ''}.`);
      addLog(`Selesai. Total klip: ${generated.length}.`);
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error('Clip30 AI processing error:', e);
      addLog(`ERROR: ${detail}`);
      if (e?.stack) addLog(e.stack);
      setError(detail || 'Error tidak diketahui. Periksa log FFmpeg.');
      setStatus('Pemrosesan gagal — detail tersedia di bawah.');
      outputUrls.forEach((url) => URL.revokeObjectURL(url));
    } finally {
      setBusy(false);
    }
  }

  async function downloadZip() {
    if (!results.length) return;
    try {
      setStatus('Membuat file ZIP…');
      const zip = new JSZip();
      results.forEach((item) => zip.file(item.name, item.blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName(file?.name)}-clips.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus('ZIP berhasil dibuat dan unduhan dimulai.');
    } catch (e) {
      setError(`Gagal membuat ZIP: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <header style={styles.header}>
          <p style={{ margin: '0 0 8px', color: '#9b8aff', fontWeight: 800, letterSpacing: 2 }}>VIDEO CLIP MAKER</p>
          <h1 style={styles.logo}>Clip30 <span style={{ color: '#9b8aff' }}>AI</span></h1>
          <p style={styles.sub}>Potong video panjang menjadi klip pendek langsung di browser. Video tidak diunggah ke server aplikasi.</p>
        </header>

        <section style={styles.panel}>
          <label style={styles.label} htmlFor="video-file">1. Pilih video</label>
          <input id="video-file" style={styles.input} type="file" accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v" onChange={(e) => onChooseFile(e.target.files?.[0])} disabled={busy} />
          {file && (
            <div style={{ marginTop: 12 }}>
              <strong>{file.name}</strong>
              <p style={styles.muted}>{formatBytes(file.size)}{videoInfo ? ` • ${Math.floor(videoInfo.duration)} detik • ${videoInfo.width}×${videoInfo.height}` : ' • Membaca metadata video…'}</p>
            </div>
          )}
          <p style={styles.muted}>Tips: untuk HP, mulai dengan video pendek dan ukuran file kecil. Pemrosesan video memakai memori perangkat.</p>
        </section>

        <section style={styles.panel}>
          <label style={styles.label}>2. Pengaturan klip</label>
          <div style={{ marginBottom: 14, padding: 14, borderRadius: 12, border: '1px solid #394765', background: '#0d1426' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ ...styles.label, marginBottom: 4 }} htmlFor="ai-toggle">Fitur AI / momen otomatis</label>
                <div style={styles.muted}>{aiEnabled ? 'Aktif — aplikasi akan menganalisis perubahan visual.' : 'Nonaktif — video dipotong berurutan sesuai durasi.'}</div>
              </div>
              <button
                id="ai-toggle"
                type="button"
                role="switch"
                aria-checked={aiEnabled}
                onClick={() => {
                  const next = !aiEnabled;
                  setAiEnabled(next);
                  setClipMode(next ? 'auto' : 'sequential');
                }}
                disabled={busy}
                style={{
                  flexShrink: 0,
                  minWidth: 88,
                  border: '1px solid #52607f',
                  borderRadius: 999,
                  padding: '9px 12px',
                  background: aiEnabled ? '#267b56' : '#26324d',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: busy ? 'not-allowed' : 'pointer'
                }}
              >
                {aiEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {aiEnabled && <p style={{ ...styles.muted, marginBottom: 0, marginTop: 10 }}>Mode beta: mendeteksi perubahan gambar untuk memilih bagian yang lebih dinamis. Ini belum memahami isi adegan seperti model AI multimodal.</p>}
          </div>
          <div style={styles.row}>
            <div>
              <label style={styles.label} htmlFor="clip-duration">Durasi klip</label>
              <select id="clip-duration" style={styles.select} value={duration} onChange={(e) => setDuration(e.target.value)} disabled={busy}>
                <option value="15">15 detik</option>
                <option value="30">30 detik</option>
                <option value="45">45 detik</option>
                <option value="60">60 detik</option>
              </select>
            </div>
            <div>
              <label style={styles.label} htmlFor="clip-ratio">Rasio video</label>
              <select id="clip-ratio" style={styles.select} value={ratio} onChange={(e) => setRatio(e.target.value)} disabled={busy}>
                <option value="original">Original</option>
                <option value="9:16">9:16 — Shorts/Reels/TikTok</option>
                <option value="16:9">16:9 — YouTube</option>
                <option value="1:1">1:1 — Kotak</option>
              </select>
            </div>
            <div>
              <label style={styles.label} htmlFor="clip-quality">Kualitas</label>
              <select id="clip-quality" style={styles.select} value={quality} onChange={(e) => setQuality(e.target.value)} disabled={busy}>
                <option value="source">Standar</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </div>
          </div>
          <p style={styles.muted}>AI bisa diaktifkan atau dinonaktifkan kapan saja sebelum pemrosesan. Saat OFF, klip dipotong berurutan; saat ON, aplikasi menganalisis perubahan visual untuk memilih momen yang lebih dinamis.</p>
        </section>

        <section style={styles.panel}>
          <label style={styles.label}>3. Proses video</label>
          <button type="button" style={{ ...styles.button, opacity: !file || busy ? 0.6 : 1 }} onClick={startProcessing} disabled={!file || busy}>
            {busy ? (loadingEngine ? 'Memuat mesin…' : 'Sedang memproses…') : 'Buat klip sekarang'}
          </button>
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={styles.muted}>{status}</span>
            <strong>{progress}%</strong>
          </div>
          <div style={styles.progress}><div style={{ ...styles.progressFill, width: `${progress}%` }} /></div>
          {error && (
            <div style={styles.error}>
              <strong>Detail kesalahan</strong>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, marginBottom: 0 }}>{error}</pre>
            </div>
          )}
        </section>

        {results.length > 0 && (
          <section style={styles.panel}>
            <h2 style={{ marginTop: 0 }}>Klip berhasil dibuat</h2>
            <button type="button" style={styles.button} onClick={downloadZip}>Unduh semua klip (ZIP)</button>
            {results.map((item) => (
              <div key={item.name} style={{ borderTop: '1px solid #29334f', paddingTop: 12, marginTop: 12 }}>
                <strong>{item.name}</strong>
                <p style={styles.muted}>Mulai {item.start.toFixed(1)} detik • {formatBytes(item.size)}</p>
                <video controls playsInline preload="metadata" src={item.url} style={{ width: '100%', maxHeight: 360, borderRadius: 10, background: '#000' }} />
                <a style={styles.secondary} href={item.url} download={item.name}>Unduh MP4</a>
              </div>
            ))}
          </section>
        )}

        <section style={styles.panel}>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Log teknis FFmpeg — klik jika terjadi error</summary>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button type="button" style={styles.smallButton} onClick={() => setLogs([])}>Hapus log</button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11, lineHeight: 1.5, maxHeight: 300, overflowY: 'auto', background: '#0b1020', padding: 12, borderRadius: 8 }}>{logs.length ? logs.join('\n') : 'Belum ada log.'}</pre>
          </details>
        </section>

        <p style={{ ...styles.muted, textAlign: 'center' }}>Clip30 AI • Pemrosesan lokal di browser • Tidak memerlukan API AI berbayar</p>
      </div>
    </main>
  );
}
