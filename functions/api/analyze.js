const MODEL = "gemini-3.8-flash";
const MAX_FRAMES = 18;
const MAX_FRAME_CHARS = 600000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function extractOutputText(result) {
  if (typeof result?.output_text === "string") return result.output_text;
  const output = Array.isArray(result?.output) ? result.output : [];
  return output
    .filter(step => step?.type === "model_output")
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .filter(item => item?.type === "text" && typeof item.text === "string")
    .map(item => item.text)
    .join("\n");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: "Secret GEMINI_API_KEY belum dipasang pada environment Cloudflare Pages Production." }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Data permintaan tidak valid. Muat ulang halaman dan coba lagi." }, 400);
    }

    const duration = Number(body?.duration);
    const clipDuration = Number(body?.clipDuration);
    const frames = Array.isArray(body?.frames) ? body.frames : [];

    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(clipDuration) || clipDuration < 3) {
      return jsonResponse({ error: "Durasi video atau durasi klip tidak valid." }, 400);
    }
    if (frames.length < 2 || frames.length > MAX_FRAMES) {
      return jsonResponse({ error: `Jumlah frame sampel harus 2–${MAX_FRAMES}.` }, 400);
    }
    if (frames.some(frame => typeof frame?.data !== "string" || frame.data.length === 0 || frame.data.length > MAX_FRAME_CHARS)) {
      return jsonResponse({ error: "Sampel gambar kosong atau terlalu besar. Coba video lain yang lebih pendek." }, 413);
    }

    const content = [{
      type: "text",
      text: `Kamu adalah editor video pendek profesional untuk YouTube Shorts, Instagram Reels, dan TikTok.\nVideo berdurasi ${duration.toFixed(2)} detik. Durasi target setiap klip maksimal ${clipDuration} detik.\nDi bawah ini terdapat frame JPEG dari video; setiap frame disertai timestamp. Gunakan timestamp untuk memperkirakan lokasi momen.\nCari hingga 5 segmen yang berpotensi menarik berdasarkan hook visual, aksi, emosi yang terlihat, perubahan adegan, kejutan, demonstrasi, atau cerita yang mudah dipahami. Jangan mengarang kejadian yang tidak tampak. Sebarkan pilihan sepanjang video jika ada momen bagus dan hindari segmen yang hampir sama.\nSetiap segmen harus berdurasi minimal 3 detik, maksimal ${clipDuration} detik, dan tidak melewati ${duration.toFixed(2)} detik. Score 0–100 adalah perkiraan kualitas hook visual, bukan jaminan viral. Tulis reason singkat dalam bahasa Indonesia dan hook sebagai ide teks pembuka.\nBalas hanya JSON valid tanpa markdown dengan bentuk: {"highlights":[{"start":12.0,"end":32.0,"score":88,"reason":"Aksi utama terlihat jelas","hook":"Tunggu sampai bagian ini"}]}. Semua timestamp berupa angka detik. Pastikan end lebih besar dari start.`
    }];

    for (const frame of frames) {
      const timestamp = Math.max(0, Math.min(duration, Number(frame.timestamp) || 0));
      content.push({ type: "text", text: `Frame pada timestamp ${timestamp.toFixed(2)} detik:` });
      content.push({ type: "image", mime_type: "image/jpeg", data: frame.data });
    }

    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        input: [{ type: "user_input", content }],
        generation_config: { thinking_level: "low", max_output_tokens: 4096 },
        store: false,
      }),
    });

    let result;
    try {
      result = await upstream.json();
    } catch {
      return jsonResponse({ error: `Respons Gemini tidak valid (HTTP ${upstream.status}).` }, 502);
    }

    if (!upstream.ok) {
      const message = result?.error?.message || `Gemini API gagal (HTTP ${upstream.status}).`;
      const status = upstream.status === 429 ? 429 : (upstream.status === 401 || upstream.status === 403 ? 502 : 502);
      return jsonResponse({ error: message }, status);
    }

    const outputText = extractOutputText(result).trim();
    if (!outputText) {
      return jsonResponse({ error: "Gemini tidak mengembalikan teks hasil. Coba lagi dengan video yang lebih pendek." }, 502);
    }

    let parsed;
    try {
      const cleaned = outputText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return jsonResponse({ error: "Gemini mengirim hasil yang bukan JSON valid. Coba analisis sekali lagi." }, 502);
    }

    const highlights = (Array.isArray(parsed.highlights) ? parsed.highlights : [])
      .map(item => {
        const start = Math.max(0, Math.min(duration - 0.1, Number(item.start) || 0));
        const end = Math.max(0, Math.min(duration, Number(item.end) || 0));
        return {
          start,
          end,
          score: Math.max(0, Math.min(100, Math.round(Number(item.score) || 0))),
          reason: String(item.reason || "Momen berpotensi menarik").slice(0, 240),
          hook: String(item.hook || "Lihat momen ini").slice(0, 120),
        };
      })
      .filter(item => item.end > item.start && item.end - item.start >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!highlights.length) {
      return jsonResponse({ error: "Gemini tidak menemukan segmen valid pada sampel ini. Coba video lain atau tingkatkan durasi klip." }, 422);
    }

    return jsonResponse({ highlights, model: MODEL });
  } catch (error) {
    return jsonResponse({ error: error?.message || "Terjadi kesalahan saat analisis AI." }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
