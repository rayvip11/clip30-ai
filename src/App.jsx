import React, { useEffect, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import JSZip from 'jszip'
import { Scissors, Upload, Sparkles, Download, Film, Clock3, LoaderCircle, Trash2, ShieldCheck, CircleAlert, Play, X } from 'lucide-react'

const fmt = (s) => {
  if (!Number.isFinite(s)) return '—'
  const n = Math.max(0, Math.floor(s))
  return `${Math.floor(n / 60).toString().padStart(2,'0')}:${(n % 60).toString().padStart(2,'0')}`
}
const bytes = (n) => n < 1024*1024 ? `${(n/1024).toFixed(0)} KB` : `${(n/1024/1024).toFixed(1)} MB`

export default function App() {
  const [file, setFile] = useState(null)
  const [duration, setDuration] = useState(30)
  const [ratio, setRatio] = useState('original')
  const [quality, setQuality] = useState('source')
  const [status, setStatus] = useState('Siap menerima video')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [clips, setClips] = useState([])
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const [mode, setMode] = useState('smart')
  const inputRef = useRef(null)
  const ffmpegRef = useRef(null)
  const cancelRef = useRef(false)

  useEffect(() => () => { clips.forEach(c => URL.revokeObjectURL(c.url)) }, [clips])

  function selectFile(f) {
    if (!f) return
    setError('')
    setClips([])
    setProgress(0)
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(f.name)) {
      setError('Pilih file video seperti MP4, MOV, atau WebM.')
      return
    }
    const url = URL.createObjectURL(f)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      setFile({ raw: f, url, name: f.name, size: f.size, duration: video.duration, width: video.videoWidth, height: video.videoHeight })
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      setError('Metadata video tidak dapat dibaca browser. Coba file MP4 yang umum.')
    }
    video.src = url
  }

  async function getFFmpeg() {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current
    setLoading(true)
    setStatus('Memuat mesin pemrosesan video…')
    try {
      const ffmpeg = new FFmpeg()
      ffmpeg.on('progress', ({ progress }) => setProgress(Math.max(0, Math.min(99, Math.round(progress * 100)))))
      ffmpeg.on('log', ({ message }) => setLogs(old => [...old.slice(-8), message]))
      const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
      })
      ffmpegRef.current = ffmpeg
      return ffmpeg
    } finally { setLoading(false) }
  }

  async function start() {
    if (!file || busy) return
    if (file.size > 700 * 1024 * 1024 && !window.confirm('Video berukuran besar (>700 MB) dapat membuat browser HP kehabisan memori. Lanjutkan?')) return
    setBusy(true); setError(''); setClips([]); setProgress(0); cancelRef.current = false
    let ffmpeg
    const made = []
    try {
      ffmpeg = await getFFmpeg()
      setStatus('Menyiapkan video…')
      const inputName = `input_${Date.now()}.${(file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')}`
      await ffmpeg.writeFile(inputName, await fetchFile(file.raw))
      const total = Math.ceil(file.duration / duration)
      for (let i = 0; i < total; i++) {
        if (cancelRef.current) throw new Error('Pemrosesan dibatalkan.')
        const startAt = i * duration
        const length = Math.min(duration, file.duration - startAt)
        if (length <= 0) continue
        setStatus(`Membuat klip ${i + 1} dari ${total}…`)
        const out = `clip_${String(i + 1).padStart(3,'0')}.mp4`
        const args = ['-ss', String(startAt), '-i', inputName, '-t', String(length), '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn']
        if (ratio !== 'original') {
          const filters = { '9:16': 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2', '16:9': 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2', '1:1': 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2' }
          args.push('-vf', filters[ratio])
        }
        if (quality !== 'source') {
          const height = quality === '1080p' ? 1080 : quality === '720p' ? 720 : 480
          args.push('-vf', `scale=-2:min(ih\\,${height})`)
        }
        // Re-encode for more reliable segment boundaries and broad MP4 compatibility.
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out)
        await ffmpeg.exec(args)
        const data = await ffmpeg.readFile(out)
        const blob = new Blob([data.buffer], { type: 'video/mp4' })
        made.push({ name: out, blob, url: URL.createObjectURL(blob), duration: length, size: blob.size })
        setClips([...made])
        setProgress(Math.round(((i + 1) / total) * 100))
        await ffmpeg.deleteFile(out)
      }
      await ffmpeg.deleteFile(inputName).catch(() => {})
      setStatus(`Selesai — ${made.length} klip dibuat`)
    } catch (e) {
      setError(e?.message || 'Terjadi kesalahan saat memproses video.')
      setStatus('Pemrosesan belum selesai')
    } finally { setBusy(false) }
  }

  function cancel() {
    cancelRef.current = true
    setStatus('Permintaan pembatalan diterima…')
  }

  async function downloadZip() {
    if (!clips.length) return
    setStatus('Menyiapkan file ZIP…')
    const zip = new JSZip()
    for (const c of clips) zip.file(c.name, c.blob)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'clip30-hasil.zip'; a.click()
    URL.revokeObjectURL(url)
    setStatus('ZIP berhasil dibuat')
  }

  function clearAll() {
    if (busy) return
    setFile(null); setClips([]); setProgress(0); setError(''); setStatus('Siap menerima video')
    if (inputRef.current) inputRef.current.value = ''
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark"><Scissors size={23}/></div>
      <div><div className="brand-name">Clip30 <span>AI</span></div><div className="brand-sub">SMART VIDEO CLIPPER</div></div>
      <div className="local-pill"><span/> Lokal</div>
    </header>

    <section className="hero">
      <div className="eyebrow"><Sparkles size={14}/> VIDEO CLIPPING, SIMPLIFIED</div>
      <h1>Video panjang.<br/><span>Klip siap dibagikan.</span></h1>
      <p>Potong video otomatis, langsung dari browser HP kamu.</p>
    </section>

    <section className="panel upload-panel">
      <div className="section-title"><div className="icon-box"><Upload size={19}/></div><div><h2>1. Pilih video</h2><p>File diproses di browser, tidak diunggah ke server.</p></div></div>
      <input ref={inputRef} type="file" accept="video/*,.mkv,.avi" hidden onChange={e => selectFile(e.target.files?.[0])}/>
      {!file ? <button className="dropzone" onClick={() => inputRef.current?.click()} disabled={busy}>
        <div className="upload-icon"><Upload size={25}/></div><strong>Ketuk untuk pilih video</strong><span>MP4, MOV, WebM, MKV • file besar mungkin lambat</span>
      </button> : <div className="file-card">
        <div className="file-icon"><Film size={23}/></div><div className="file-meta"><strong>{file.name}</strong><span>{bytes(file.size)} · {fmt(file.duration)} · {file.width}×{file.height}</span></div>
        <button className="icon-button" onClick={() => { URL.revokeObjectURL(file.url); clearAll() }} disabled={busy} aria-label="Hapus video"><X size={18}/></button>
      </div>}
      {file && <video className="preview" src={file.url} controls playsInline />}
    </section>

    <section className="panel">
      <div className="section-title"><div className="icon-box"><Sparkles size={19}/></div><div><h2>2. Atur klip</h2><p>Pilih durasi dan format output.</p></div></div>
      <label className="field-label">Durasi setiap klip</label>
      <div className="segmented">{[15,30,45,60].map(n => <button key={n} onClick={() => setDuration(n)} className={duration===n?'active':''} disabled={busy}>{n} detik</button>)}</div>
      <label className="field-label">Mode pemotongan</label>
      <div className="mode-card">
        <div className="mode-symbol"><Sparkles size={19}/></div><div className="mode-copy"><strong>Otomatis per durasi</strong><p>Membagi seluruh video berurutan menjadi klip. Pemilihan momen viral oleh AI belum diaktifkan pada versi dasar ini.</p></div><span className="mode-tag">AKTIF</span>
      </div>
      <label className="field-label">Rasio video</label>
      <select value={ratio} onChange={e => setRatio(e.target.value)} disabled={busy} className="select">
        <option value="original">Pertahankan rasio asli</option><option value="9:16">9:16 · TikTok / Reels / Shorts</option><option value="16:9">16:9 · Layar lebar</option><option value="1:1">1:1 · Persegi</option>
      </select>
      <label className="field-label">Kualitas</label>
      <select value={quality} onChange={e => setQuality(e.target.value)} disabled={busy} className="select">
        <option value="source">Standar (ikuti sumber)</option><option value="1080p">Maksimal 1080p</option><option value="720p">Maksimal 720p</option><option value="480p">Maksimal 480p</option>
      </select>
      <button className="primary-button" onClick={start} disabled={!file || busy || loading}>{busy || loading ? <><LoaderCircle className="spin" size={19}/> Memproses…</> : <><Scissors size={19}/> Buat klip sekarang</>}</button>
      {busy && <button className="secondary-button" onClick={cancel}>Batalkan proses</button>}
      <div className="progress-wrap"><div className="progress-heading"><span>{status}</span><strong>{progress}%</strong></div><div className="progress-track"><div className="progress-fill" style={{width:`${progress}%`}}/></div></div>
      {error && <div className="error-box"><CircleAlert size={18}/><span>{error}</span></div>}
    </section>

    <section className="panel results-panel">
      <div className="section-title"><div className="icon-box"><Download size={19}/></div><div><h2>3. Hasil klip</h2><p>{clips.length ? `${clips.length} klip tersedia untuk diunduh` : 'Hasil video akan muncul di sini.'}</p></div></div>
      {clips.length === 0 ? <div className="empty-state"><div className="empty-icon"><Film size={24}/></div><strong>Belum ada hasil</strong><span>Pilih video dan mulai pemrosesan untuk membuat klip.</span></div> : <>
        <button className="primary-button zip-button" onClick={downloadZip}><Download size={18}/> Unduh semua sebagai ZIP</button>
        <div className="clip-list">{clips.map((c, i) => <div className="clip-item" key={c.name}>
          <div className="clip-number">{String(i+1).padStart(2,'0')}</div><div className="clip-info"><strong>{c.name}</strong><span><Clock3 size={13}/> {fmt(c.duration)} · {bytes(c.size)}</span></div>
          <a className="download-link" href={c.url} download={c.name} aria-label={`Unduh ${c.name}`}><Download size={18}/></a>
        </div>)}</div>
      </>}
    </section>

    <div className="privacy-note"><ShieldCheck size={17}/><span><strong>Privasi diutamakan.</strong> Video diproses di browser perangkatmu. FFmpeg dan dependensinya dimuat dari internet saat pertama kali digunakan.</span></div>
    <footer>Clip30 AI <span>·</span> Versi awal · Gratis untuk dicoba</footer>
    <p className="fine-print">Catatan: pemrosesan menggunakan memori HP dan bisa lambat atau gagal pada video besar. Mode “AI memilih momen viral” belum tersedia dalam versi starter ini; aplikasi saat ini membagi video berdasarkan durasi secara otomatis.</p>
  </main>
}