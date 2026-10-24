const MODEL = "gemini-2.5-flash";

export async function onRequestPost({ request, env }) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };

  try {
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "Secret GEMINI_API_KEY belum dipasang di Cloudflare." }), { status: 500, headers: cors });
    }

    const body = await request.json();
    const duration = Number(body.duration);
    const clipDuration = Number(body.clipDuration);
    const frames = Array.isArray(body.frames) ? body.frames : [];

    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(clipDuration) || clipDuration <= 0) {
      return new Response(JSON.stringify({ error: "Durasi video tidak valid." }), { status: 400, headers: cors });
    }
    if (frames.length < 2 || frames.length > 18) {
      return new Response(JSON.stringify({ error: "Jumlah frame sampel harus 2–18." }), { status: 400, headers: cors });
    }
    if (frames.some(f => typeof f.data !== "string" || f.data.length > 600000)) {
      return new Response(JSON.stringify({ error: "Sampel gambar terlalu besar. Coba video lain." }), { status: 413, headers: cors });
    }

    const parts = [{
      text: `Kamu adalah editor video pendek profesional untuk YouTube Shorts, Instagram Reels, dan TikTok.
Video berdurasi ${duration.toFixed(2)} detik. Durasi target setiap klip maksimal ${clipDuration} detik.
Di bawah ini ada frame gambar yang diambil dari video. Setiap gambar diberi timestamp dalam detik. Gunakan timestamp ini untuk memperkirakan momen yang paling kuat.
Cari hingga 5 segmen yang berpotensi menarik berdasarkan hook visual, aksi, emosi yang terlihat, perubahan adegan, kejutan, demonstrasi, atau cerita yang mudah dipahami. Jangan mengarang kejadian yang tidak tampak pada sampel. Sebarkan pilihan sepanjang video jika ada momen yang bagus; hindari memilih segmen yang hampir sama. Setiap segmen harus mulai sebelum akhir video dan memiliki panjang minimal 3 detik, maksimal ${clipDuration} detik, serta tidak melewati ${duration.toFixed(2)} detik.
Nilai score 0-100 adalah perkiraan kualitas hook visual, bukan prediksi viral yang pasti. Buat reason singkat dalam bahasa Indonesia dan hook berupa ide teks pembuka pendek.
Balas HANYA JSON valid dengan format: {"highlights":[{"start":12.0,"end":42.0,"score":88,"reason":"Aksi utama terlihat jelas","hook":"Tunggu sampai bagian ini"}]}. Timestamp harus angka detik.`
    }];

    for (const frame of frames) {
      const timestamp = Math.max(0, Math.min(duration, Number(frame.timestamp) || 0));
      parts.push({ text: `Frame pada timestamp ${timestamp.toFixed(2)} detik:` });
      parts.push({ inline_data: { mime_type: "image/jpeg", data: frame.data } });
    }

    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              highlights: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    start: { type: "NUMBER" },
                    end: { type: "NUMBER" },
                    score: { type: "INTEGER" },
                    reason: { type: "STRING" },
                    hook: { type: "STRING" }
                  },
                  required: ["start", "end", "score", "reason", "hook"]
                }
              }
            },
            required: ["highlights"]
          }
        }
      })
    });

    const result = await upstream.json();
    if (!upstream.ok) {
      const message = result?.error?.message || `Gemini API gagal (HTTP ${upstream.status}).`;
      return new Response(JSON.stringify({ error: message }), { status: upstream.status === 429 ? 429 : 502, headers: cors });
    }

    const text = result?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: "Gemini mengirim jawaban yang tidak terbaca sebagai JSON. Coba lagi." }), { status: 502, headers: cors });
    }

    const highlights = (Array.isArray(parsed.highlights) ? parsed.highlights : [])
      .map(h => ({
        start: Math.max(0, Math.min(duration - 0.1, Number(h.start) || 0)),
        end: Math.max(0, Math.min(duration, Number(h.end) || 0)),
        score: Math.max(0, Math.min(100, Math.round(Number(h.score) || 0))),
        reason: String(h.reason || "").slice(0, 240),
        hook: String(h.hook || "").slice(0, 120)
      }))
      .filter(h => h.end > h.start && h.end - h.start >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return new Response(JSON.stringify({ highlights }), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Terjadi kesalahan saat analisis AI." }), { status: 500, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}
