import { NextRequest, NextResponse } from 'next/server';
import extractTextFromGemini from '../../../lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // support multiple payload shapes: imagesBase64, imageBase64List, or boards: [{ imageBase64 }]
    const imagesBase64: string[] = (body?.imagesBase64 || body?.imageBase64List || (Array.isArray(body?.boards) ? body.boards.map((b: any) => b.imageBase64) : null)) || null;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    if (!Array.isArray(imagesBase64) || imagesBase64.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    // Step 1: Generate musical brief for each drawing (concise natural-language ready for music APIs)
    const perImage: Array<{ brief: string; raw: any }> = [];
    for (const imageBase64 of imagesBase64) {
      const humanPrompt = `You are a music prompt specialist preparing high-quality natural-language prompts for Beatoven-style music generation. Analyze the attached image and produce a concise, human-friendly musical brief that will produce the best background music for the scene. Start the brief with 'Background music:' and include these elements when relevant: a descriptive mood (e.g., calm, melancholic, energetic), a short genre (ambient, cinematic, electronic, jazz, orchestral, pop), an optional BPM or tempo hint if it helps, energy (0-1), a suggested key (or 'none'), primary instruments and percussion, texture and rhythm hints, a short 1-2 sentence description of how the music should evolve during the segment (build/hold/release), suggested duration in seconds, and 4–8 keyword/theme tags. Keep it natural-language, evocative, and suitable to paste directly into Beatoven as the track prompt.`;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: humanPrompt }, { inlineData: { mimeType: 'image/png', data: imageBase64 } }] }] }),
      });

  const geminiData: any = await geminiRes.json();
      const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || geminiData?.output?.[0]?.content?.text || JSON.stringify(geminiData);
      perImage.push({ brief: String(text).trim(), raw: geminiData });
    }

    // Step 2: Combine all per-image briefs into a single cohesive natural-language prompt via Gemini (if more than one)
    const combinedPromptSource = perImage.map((p, idx) => `Segment ${idx + 1}: ${p.brief}`).join('\n');
    let combinedPrompt: string = perImage.length === 1 ? perImage[0].brief : '';
    let combinedRaw: any = null;

    if (perImage.length > 1) {
      const combinePrompt = `You are an expert music director who must combine multiple per-segment musical briefs into one single Beatoven-ready prompt. Preserve the order of segments (do NOT reorder). Produce a single cohesive natural-language prompt of about 60-100 words that: states overall mood and brief genre, recommends tempo/BPM (or a compromise BPM), lists core instruments or textures to appear across the piece, explains how energy and instrumentation should evolve across segments (use words like build/hold/release), and includes short timestamped cues (e.g., "0-15s: ...") mapping each segment to start times that fit a total composition length if provided. Also include 6–10 short keywords or theme tags at the end (comma-separated). Output only the final prompt — no JSON. Make it directly usable for Beatoven.`;

      try {
        const combineRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: combinePrompt }] }, ...perImage.map(p => ({ parts: [{ text: p.brief }] }))] }),
        });
        const combineJson = await combineRes.json();
        const combinedText = extractTextFromGemini(combineJson).trim();
        combinedPrompt = combinedText;
        combinedRaw = combineJson;
      } catch (e: any) {
        // fallback: simple join
        combinedPrompt = perImage.map(p => p.brief).join(' | ');
      }
    }

    // Step 3: Send to Beatoven
    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    let beatovenResult: any = null;

    if (beatovenKey) {
      try {
        const composeUrl = `${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`;
        const composePayload = { prompt: { text: combinedPrompt }, format: 'mp3', looping: false };

        const composeRes = await fetch(composeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
          body: JSON.stringify(composePayload),
        });

        if (!composeRes.ok) {
          const text = await composeRes.text();
          beatovenResult = { error: `Beatoven compose error: ${composeRes.status}`, details: text };
        } else {
          const composeJson = await composeRes.json();
          const taskId = composeJson?.task_id;
          beatovenResult = composeJson;

          if (taskId) {
            const statusUrlBase = `${beatovenBase.replace(/\/$/, '')}/api/v1/tasks`;
            let attempts = 0;
            let finalMeta: any = null;
            while (attempts++ < 45) {
              try {
                const stRes = await fetch(`${statusUrlBase}/${encodeURIComponent(taskId)}`, {
                  method: 'GET',
                  headers: { Authorization: `Bearer ${beatovenKey}` },
                });
                if (stRes.ok) {
                  const stJson = await stRes.json();
                  beatovenResult = stJson;
                  const status = stJson?.status;
                  if (status === 'composed') {
                    finalMeta = stJson?.meta || null;
                    break;
                  }
                  if (status === 'failed' || status === 'error') break;
                }
              } catch {}
              await new Promise(r => setTimeout(r, 2000));
            }
            if (finalMeta) beatovenResult = { ...beatovenResult, meta: finalMeta };
            else beatovenResult = { ...beatovenResult, error: 'Beatoven compose timed out or failed', task_id: taskId };
          }
        }
      } catch (e: any) {
        beatovenResult = { error: e.message || String(e) };
      }
    }

    // Extract audio URL/base64
    let beatovenAudioUrl: string | null = null;
    let beatovenAudioBase64: string | null = null;
    if (beatovenResult) {
      beatovenAudioUrl =
        beatovenResult.audioUrl ||
        beatovenResult.track?.downloadUrl ||
        beatovenResult.meta?.track_url ||
        beatovenResult.data?.audio?.url ||
        null;
      beatovenAudioBase64 = beatovenResult.audioBase64 || beatovenResult.base64 || null;
    }

    return NextResponse.json({
      perImage,
      combinedPrompt,
      combinedRaw,
      beatoven: beatovenResult,
      beatovenAudioUrl,
      beatovenAudioBase64,
    });

  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
