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
You are a professional music supervisor creating prompts for AI music generation based on the attached drawing.

Analyze the image and write a natural-language prompt that can be directly used to generate music matching its theme, mood, and visuals. Start exactly with:
"Background music:"

Include the following details naturally in the paragraph:
1. Overall image meaning/theme: describe what the image depicts and the message or emotion conveyed specifically and clearly.
2. Mood: overall emotional tone (e.g., calm, melancholic, energetic).
3. Genre: a fitting genre (e.g., ambient, lo-fi hip hop, classical piano, synthwave, acoustic folk, cinematic orchestral).
4. Tempo/BPM: approximate beats per minute suitable for the image.
5. Key: musical key (e.g., A minor) or "none".
6. Instruments: lead instruments and percussion that match the theme and visuals.
7. Texture/Rhythm: musical textures, rhythm, or pace (slow, fast, syncopated, flowing).
8. Evolution: describe how the track builds, holds, or releases over time.
9. Duration: realistic length in seconds.

Keep output 30–100 words, as a single natural paragraph. Only output the final prompt.`;

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
You are an expert music director combining multiple music briefs into one master prompt for AI music generation. 

1. First, understand the meaning, theme, and mood of each board in order.  
2. Then, create a single cohesive natural-language prompt that can be used to generate music matching the full sequence. Start the prompt exactly with:
"Background music:"

Include:
- Overall mood and primary genre unifying all segments specifically and clearly.
- Recommended tempo/BPM (exact number preferred).
- Core instruments and textures that appear across sections.
- Evolution: describe how the track builds, holds, or releases over time across all boards.
- Optional timestamped cues for segments only if it makes sense (e.g., "0s–20s: ambient intro, 20s–40s: cinematic build").
- Duration: total suggested length in seconds.

Output only the final prompt in ~90–100 words.
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
