import React, { useEffect, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import JSZip from 'jszip'
import { Scissors, Upload, Sparkles, Download, Film, Clock3, LoaderCircle, ShieldCheck, CircleAlert, X } from 'lucide-react'

const fmt = (s) => {
  if (!Number.isFinite(s)) return '—'
  const n = Math.max(0, Math.floor(s))
  return `${Math.floor(n / 60).toString().padStart(2,'0')}:${(n % 60).toString().padStart(2,'0')}`
}
const bytes = (n) => n < 1024*1024 ? `${(n/1024).toFixed(0)} KB` : `${(n/1024/1024).toFixed(1)} MB`

async function sampleVideoFrames(file, duration, maxFrames = 18) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = url
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('Browser tidak dapat membaca video untuk analisis AI.'))
    })
    const count = Math.min(maxFrames, Math.max(2, Math.ceil(duration / 4)))
    const frames = []
    const canvas = document.createElement('canvas')
    canvas.width = 384
    canvas.height = 216
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    for (let i = 0; i < count; i++) {
      const timestamp = count === 1 ? 0 : (duration * i / count)
      video.currentTime = timestamp
      await new Promise((resolve, reject) => {
        video.onseeked = resolve
        video.onerror = () => reject(new Error('Gagal membaca frame video.'))
      })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({ timestamp, data: canvas.toDataURL('image/jpeg', 0.72).split(',')[1] })
    }
    return frames
  } finally {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
    video.load()
  }
}

export default function App() {
  const [file, setFile] = useState(null)
  const [duration, setDuration] = useState(30)
  const [ratio, setRatio] = useState('original')
  const [quality, setQuality] = useState('source')
  const [mode, setMode] = useState('viral')
  const [status, setStatus] = useState('Siap menerima video')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [clips, setClips] = useState([])
  const [highlights, setHighlights] = useState([])
  const [error, setError] = useState('')
  const [logs, setLogs] = useState([])
  const inputRef = useRef(null)
  const ffmpegRef = useRef(null)
  const cancelRef = useRef(false)

  useEffect(() => () => { clips.forEach(c => URL.revokeObjectURL(c.url)) }, [clips])

  function selectFile(f) {
    if (!f) return
    setError(''); setClips([]); setHighlights([]); setProgress(0)
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(f.name)) {
      setError('Pilih file video seperti MP4, MOV, atau WebM.')
      return
    }
    const url = URL.createObjectURL(f)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => setFile({ raw: f, url, name: f.name, size: f.size, duration: video.duration, width: video.videoWidth, height: video.videoHeight })
    video.onerror = () => { URL.revokeObjectURL(url); setError('Metadata video tidak dapat dibaca browser. Coba file MP4.') }
    video.src = url
  }

  async function analyzeViralMoments() {
    setStatus('Mengambil sampel gambar dari video…')
    const frames = await sampleVideoFrames(file.raw, file.duration)
    setStatus('Gemini sedang menilai momen yang menarik…')
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duration: file.duration,
        clipDuration: duration,
        frames: frames.map(f => ({ timestamp: f.timestamp, data: f.data }))
      })
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `Analisis AI gagal (HTTP ${res.status}).`)
    if (!Array.isArray(body.highlights) || !body.highlights.length) throw new Error('Gemini tidak mengembalikan rekomendasi momen. Coba lagi atau gunakan mode berurutan.')
    const clean = body.highlights
      .map((h, i) => ({
        start: Math.max(0, Math.min(Number(h.start) || 0, Math.max(0, file.duration - 0.1))),
        end: Math.max(0, Math.min(Number(h.end) || 0, file.duration)),
        score: Math.max(0, Math.min(100, Number(h.score) || 0)),
        reason: String(h.reason || 'Direkomendasikan AI'),
        hook: String(h.hook || '')
      }))
      .map(h => ({ ...h, end: Math.min(file.duration, Math.max(h.end, h.start + 1)) }))
      .filter(h => h.end > h.start)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(6, Math.ceil(file.duration / duration)))
    if (!clean.length) throw new Error('Tidak ada timestamp yang valid dari hasil Gemini.')
    setHighlights(clean)
    return clean
  }

  async function getFFmpeg() {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current
    setLoading(true); setStatus('Memuat mesin pemrosesan video…')
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
    const made = []
    let inputName = ''
    try {
      let segments
      if (mode === 'viral') {
        segments = await analyzeViralMoments()
      } else {
        segments = Array.from({ length: Math.ceil(file.duration / duration) }, (_, i) => ({
          start: i * duration, end: Math.min(file.duration, (i + 1) * duration), score: 0, reason: 'Pemotongan berurutan', hook: ''
        }))
      }
      const ffmpeg = await getFFmpeg()
      setStatus('Menyiapkan video…')
      inputName = `input_${Date.now()}.${(file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')}`
      await ffmpeg.writeFile(inputName, await fetchFile(file.raw))
      for (let i = 0; i < segments.length; i++) {
        if (cancelRef.current) throw new Error('Pemrosesan dibatalkan.')
        const seg = segments[i]
        const startAt = Math.max(0, Math.min(seg.start, file.duration - 0.05))
        const length = Math.min(duration, file.duration - startAt, Math.max(0.1, seg.end - startAt))
        if (length <= 0) continue
        setStatus(`Membuat klip ${i + 1} dari ${segments.length}…`)
        const out = `clip_${String(i + 1).padStart(3,'0')}.mp4`
        const args = ['-ss', String(startAt), '-i', inputName, '-t', String(length), '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn']
        const filters = {
          '9:16': 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2',
          '16:9': 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
          '1:1': 'scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2'
        }
        if (ratio !== 'original') args.push('-vf', filters[ratio])
        if (quality !== 'source') {
          const height = quality === '1080p' ? 1080 : quality === '720p' ? 720 : 480
          args.push('-vf', `scale=-2:min(ih\\,${height})`)
        }
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out)
        await ffmpeg.exec(args)
        const data = await ffmpeg.readFile(out)
        const blob = new Blob([data.buffer], { type: 'video/mp4' })
        made.push({ name: out, blob, url: URL.createObjectURL(blob), duration: length, size: blob.size, start: startAt, score: seg.score, reason: seg.reason, hook: seg.hook })
        setClips([...made])
        setProgress(Math.round(((i + 1) / segments.length) * 100))
        await ffmpeg.deleteFile(out)
      }
      setStatus(`Selesai — ${made.length} klip dibuat`)
    } catch (e) {
      setError(e?.message || 'Terjadi kesalahan saat memproses video.')
      setStatus('Pemrosesan belum selesai')
    } finally {
      if (inputName && ffmpegRef.current) await ffmpegRef.current.deleteFile(inputName).catch(() => {})
      setBusy(false)
    }
  }

  function cancel() { cancelRef.current = true; setStatus('Permintaan pembatalan diterima…') }
  async function downloadZip() {
    if (!clips.length) return
    setStatus('Menyiapkan file ZIP…')
    const zip = new JSZip()
    for (const c of clips) zip.file(c.name, c.blob)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'clip30-hasil.zip'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus('ZIP berhasil dibuat')
  }
  function clearAll() {
    if (busy) return
    if (file?.url) URL.revokeObjectURL(file.url)
    setFile(null); setClips([]); setHighlights([]); setProgress(0); setError(''); setStatus('Siap menerima video')
    if (inputRef.current) inputRef.current.value = ''
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark"><Scissors size={23}/></div><div><div className="brand-name">Clip30 <span>AI</span></div><div className="brand-sub">SMART VIDEO CLIPPER</div></div><div className="local-pill"><span/> Gemini AI</div></header>
    <section className="hero"><div className="eyebrow"><Sparkles size={14}/> AI VIDEO HIGHLIGHTS</div><h1>Video panjang.<br/><span>Klip siap viral.</span></h1><p>Gemini menilai sampel adegan, lalu Clip30 memotong momen yang paling menjanjikan.</p></section>
    <section className="panel upload-panel">
      <div className="section-title"><div className="icon-box"><Upload size={19}/></div><div><h2>1. Pilih video</h2><p>Frame sampel dikirim ke Gemini untuk analisis. Video penuh dipotong di browser.</p></div></div>
      <input ref={inputRef} type="file" accept="video/*,.mkv,.avi" hidden onChange={e => selectFile(e.target.files?.[0])}/>
      {!file ? <button className="dropzone" onClick={() => inputRef.current?.click()} disabled={busy}><div className="upload-icon"><Upload size={25}/></div><strong>Ketuk untuk pilih video</strong><span>MP4, MOV, WebM, MKV • mulai dengan video pendek</span></button> : <div className="file-card"><div className="file-icon"><Film size={23}/></div><div className="file-meta"><strong>{file.name}</strong><span>{bytes(file.size)} · {fmt(file.duration)} · {file.width}×{file.height}</span></div><button className="icon-button" onClick={clearAll} disabled={busy} aria-label="Hapus video"><X size={18}/></button></div>}
      {file && <video className="preview" src={file.url} controls playsInline />}
    </section>
    <section className="panel">
      <div className="section-title"><div className="icon-box"><Sparkles size={19}/></div><div><h2>2. Atur klip</h2><p>Pilih mode analisis dan format hasil.</p></div></div>
      <label className="field-label">Durasi maksimal klip</label><div className="segmented">{[15,30,45,60].map(n => <button key={n} onClick={() => setDuration(n)} className={duration===n?'active':''} disabled={busy}>{n} detik</button>)}</div>
      <label className="field-label">Mode pemotongan</label>
      <div className="mode-card"><div className="mode-symbol"><Sparkles size={19}/></div><div className="mode-copy"><strong>Gemini AI — cari momen viral</strong><p>Menilai sampel visual, menyarankan timestamp, skor potensi, dan ide hook. Skor bukan jaminan viral.</p></div><span className="mode-tag">AI</span></div>
      <div className="segmented" style={{marginTop:8}}><button className={mode==='viral'?'active':''} onClick={() => setMode('viral')} disabled={busy}>Gemini AI</button><button className={mode==='sequential'?'active':''} onClick={() => setMode('sequential')} disabled={busy}>Berurutan</button></div>
      <label className="field-label">Rasio video</label><select value={ratio} onChange={e => setRatio(e.target.value)} disabled={busy} className="select"><option value="original">Pertahankan rasio asli</option><option value="9:16">9:16 · TikTok / Reels / Shorts</option><option value="16:9">16:9 · Layar lebar</option><option value="1:1">1:1 · Persegi</option></select>
      <label className="field-label">Kualitas</label><select value={quality} onChange={e => setQuality(e.target.value)} disabled={busy} className="select"><option value="source">Standar (ikuti sumber)</option><option value="1080p">Maksimal 1080p</option><option value="720p">Maksimal 720p</option><option value="480p">Maksimal 480p</option></select>
      <button className="primary-button" onClick={start} disabled={!file || busy || loading}>{busy || loading ? <><LoaderCircle className="spin" size={19}/> Memproses…</> : <><Scissors size={19}/> {mode==='viral'?'Analisis & buat klip AI':'Buat klip berurutan'}</>}</button>
      {busy && <button className="secondary-button" onClick={cancel}>Batalkan proses</button>}
      <div className="progress-wrap"><div className="progress-heading"><span>{status}</span><strong>{progress}%</strong></div><div className="progress-track"><div className="progress-fill" style={{width:`${progress}%`}}/></div></div>
      {error && <div className="error-box"><CircleAlert size={18}/><span>{error}</span></div>}
      {highlights.length>0 && <div style={{marginTop:14}}><strong style={{fontSize:12}}>Rekomendasi Gemini</strong>{highlights.map((h,i)=><div key={`${h.start}-${i}`} className="clip-item" style={{marginTop:7}}><div className="clip-number">{h.score}</div><div className="clip-info"><strong>{fmt(h.start)}–{fmt(h.end)} · Skor potensi {h.score}/100</strong><span>{h.reason}{h.hook?` · Hook: ${h.hook}`:''}</span></div></div>)}</div>}
    </section>
    <section className="panel results-panel"><div className="section-title"><div className="icon-box"><Download size={19}/></div><div><h2>3. Hasil klip</h2><p>{clips.length ? `${clips.length} klip tersedia untuk diunduh` : 'Hasil video akan muncul di sini.'}</p></div></div>
      {clips.length === 0 ? <div className="empty-state"><div className="empty-icon"><Film size={24}/></div><strong>Belum ada hasil</strong><span>Pilih video dan mulai analisis untuk membuat klip.</span></div> : <><button className="primary-button zip-button" onClick={downloadZip}><Download size={18}/> Unduh semua sebagai ZIP</button><div className="clip-list">{clips.map((c,i)=><div className="clip-item" key={c.name}><div className="clip-number">{String(i+1).padStart(2,'0')}</div><div className="clip-info"><strong>{c.name} {mode==='viral'&&c.score?`· skor ${c.score}`:''}</strong><span><Clock3 size={13}/> Mulai {fmt(c.start)} · {fmt(c.duration)} · {bytes(c.size)}</span>{c.reason&&<span>{c.reason}</span>}</div><a className="download-link" href={c.url} download={c.name} aria-label={`Unduh ${c.name}`}><Download size={18}/></a></div>)}</div></>}
    </section>
    <div className="privacy-note"><ShieldCheck size={17}/><span><strong>Privasi.</strong> Sampel gambar dari video dikirim ke Gemini melalui Cloudflare Pages Function. Kunci API tersimpan sebagai Secret di Cloudflare, bukan di browser. Pemotongan video tetap dilakukan di perangkat.</span></div>
    <footer>Clip30 AI <span>·</span> Gemini API</footer>
    <p className="fine-print">Analisis menggunakan sampel visual, bukan jaminan performa viral. Model tidak selalu memahami audio, konteks lengkap, atau tren platform. Batas gratis Gemini dapat berubah.</p>
  </main>
}
