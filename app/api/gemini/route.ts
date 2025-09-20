import { NextRequest, NextResponse } from 'next/server';
import extractTextFromGemini from '../../../lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imagesBase64: string[] = (
      body?.imagesBase64 || 
      body?.imageBase64List || 
      (Array.isArray(body?.boards) ? body.boards.map((b: any) => b.imageBase64) : null)
    ) || null;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });
    if (!Array.isArray(imagesBase64) || imagesBase64.length === 0) return NextResponse.json({ error: 'No images provided' }, { status: 400 });

    // 1️⃣ Generate per-image musical briefs
    const perImage: Array<{ brief: string; raw: any }> = [];
    for (const imageBase64 of imagesBase64) {
      const humanPrompt = `
You are a music prompt specialist for Beatoven-style generation. Analyze the attached image and produce a concise, evocative musical brief. Start with 'Background music:'. Include:
- Mood (calm, melancholic, energetic)
- Short genre (ambient, cinematic, electronic, jazz, orchestral, pop)
- Optional BPM/tempo hint
- Energy (0-1)
- Suggested key or 'none'
- Primary instruments & percussion
- Texture & rhythm hints
- 1-2 sentence evolution description (build/hold/release)
- Suggested duration in seconds
- 4–8 keyword/theme tags

Keep it natural-language, vivid, and ready to paste into Beatoven.
      `;

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: humanPrompt }, { inlineData: { mimeType: 'image/png', data: imageBase64 } }] }] }),
      });

      const geminiData: any = await geminiRes.json();
      const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || geminiData?.output?.[0]?.content?.text || JSON.stringify(geminiData);
      perImage.push({ brief: String(text).trim(), raw: geminiData });
    }

    // 2️⃣ Combine per-image briefs into a cohesive prompt (if multiple images)
    let combinedPrompt: string = perImage.length === 1 ? perImage[0].brief : '';
    let combinedRaw: any = null;

    if (perImage.length > 1) {
      const combinePrompt = `
You are an expert music director. Combine multiple per-segment musical briefs into a single Beatoven-ready prompt. Preserve segment order. Output ~60-100 words:
- Overall mood & brief genre
- Recommended tempo/BPM
- Core instruments or textures across segments
- Evolution across segments (build/hold/release)
- Timestamped cues mapping segments to start times
- 6–10 keywords/themes

Output only the final natural-language prompt ready for Beatoven.
      `;

      try {
        const combineRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: combinePrompt }] }, ...perImage.map(p => ({ parts: [{ text: p.brief }] }))]
          }),
        });
        const combineJson = await combineRes.json();
        combinedPrompt = extractTextFromGemini(combineJson).trim();
        combinedRaw = combineJson;
      } catch {
        // fallback: simple join
        combinedPrompt = perImage.map(p => p.brief).join(' | ');
      }
    }

    // 3️⃣ Send to Beatoven
    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    let beatovenResult: any = null;

    if (beatovenKey) {
      try {
        const composeRes = await fetch(`${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
          body: JSON.stringify({ prompt: { text: combinedPrompt }, format: 'mp3', looping: false }),
        });
        beatovenResult = await composeRes.json();
      } catch (e: any) {
        beatovenResult = { error: e.message || String(e) };
      }
    }

    // Extract audio
    const beatovenAudioUrl = beatovenResult?.audioUrl || beatovenResult?.track?.downloadUrl || null;
    const beatovenAudioBase64 = beatovenResult?.audioBase64 || beatovenResult?.base64 || null;

    return NextResponse.json({ perImage, combinedPrompt, combinedRaw, beatoven: beatovenResult, beatovenAudioUrl, beatovenAudioBase64 });

  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
