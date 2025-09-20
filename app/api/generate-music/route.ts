import { NextRequest, NextResponse } from 'next/server';
import extractTextFromGemini from '../../../lib/gemini';

const durationMap: Record<number, number> = { 1: 60, 2: 30, 3: 20, 4: 15 };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const boards: Array<{ id: string; name?: string; imageBase64?: string; strokeCount?: number }> = body?.boards || [];
    const totalDuration: number = typeof body?.totalDuration === 'number' ? body.totalDuration : 60;

    if (!boards.length) return NextResponse.json({ error: 'No boards provided' }, { status: 400 });

    const geminiKey = process.env.GEMINI_API_KEY;
    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    if (!geminiKey || !beatovenKey) return NextResponse.json({ error: 'API keys not set' }, { status: 500 });

    // Filter valid boards: accept any board that either has an uploaded image or has >=5 stroke points
    const validBoards = boards.filter(b => (b.imageBase64 && b.imageBase64.length > 100) || (b.strokeCount || 0) >= 5);
    if (validBoards.length === 0) {
      return NextResponse.json({ error: 'No valid boards to analyze. Each board must have either an uploaded background image or at least 5 stroke points.' }, { status: 400 });
    }

  // Limit to at most 4 boards for duration splits as requested; if more, keep first 4
  const limitedBoards = validBoards.slice(0, Math.min(validBoards.length, 4));

    // Determine per-board duration
    const num = limitedBoards.length;
    const perBoardDuration = durationMap[num] || Math.max(15, Math.floor(totalDuration / num));

    // 1️⃣ Generate per-board musical briefs
    const perBoardResults: Array<any> = [];
    for (let i = 0; i < limitedBoards.length; i++) {
      const b = limitedBoards[i];
      const humanPrompt = `You are a professional music supervisor creating prompts for AI music generation based on the attached drawing.

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
9. Duration: ${perBoardDuration} seconds.

Keep output 30–100 words, as a single natural paragraph. Only output the final prompt.`;
;

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: humanPrompt }, { inlineData: { mimeType: 'image/png', data: b.imageBase64 } }] }] }),
          }
        );
        const geminiData = await geminiRes.json();
        const briefText = extractTextFromGemini(geminiData).trim();
        perBoardResults.push({ id: b.id, name: b.name || `board-${i + 1}`, brief: briefText, raw: geminiData, strokeCount: b.strokeCount || 0, segment_duration: perBoardDuration });
      } catch (e: any) {
        perBoardResults.push({ id: b.id, name: b.name || `board-${i + 1}`, error: e?.message || String(e) });
      }
    }

    // 2️⃣ Build combined prompt with smooth transitions
    const combinedSegmentsText = perBoardResults.map((r, idx) => `Segment ${idx + 1} (${r.name || r.id}): ${r.brief || r.raw} Duration: ${r.segment_duration}s.`).join('\n\n');

    const sharedHints = `
Ensure coherence: align tempo, crossfade 1-3s, maintain sonic motifs, avoid abrupt changes. Output ~${totalDuration}s background music track of ordered segments suitable for scenes/looping.
    `;

    const combinedPrompt = `Compose a single ${totalDuration}-second track composed of ${num} ordered segments. ${sharedHints}\n\n${combinedSegmentsText}`;

    // 3️⃣ Optional Gemini refiner for a polished prompt
    let refinedPrompt: string | null = null;
    try {
      const refinerHuman = `
You are a senior music supervisor. Combine the per-segment musical briefs into one unified prompt for Beatoven.

Requirements:
- Preserve the chronological order of segments.
- Ensure coherence across tempo, genre, and instrumentation.
- Smooth transitions between segments (crossfade 1–3s, carry motifs forward).
- Total track duration: ~${totalDuration}s.

Output format:
REFINED_PROMPT:
Write an 80–160 word natural-language brief ready for Beatoven. Include:
1. Overall theme/message of the combined boards clearly and specifically based on drawing.
2. Unified mood and genre.
3. Tempo/BPM and key (consistent or evolving if necessary).
4. Core instruments and textures appearing across sections.
5. Segment evolution: describe how energy builds/holds/releases across the whole track.
6. Transition style (how one segment flows into the next).

SEGMENT_TIMINGS:
One line per segment in order, so that the music has transitions from board to board`;
      const refinerContents: any[] = [{ parts: [{ text: refinerHuman }] }];
      perBoardResults.forEach((r, idx) => refinerContents.push({ parts: [{ text: `Segment ${idx + 1} (${r.id || r.name}): ${r.brief || r.raw} Duration: ${r.segment_duration}s.` }] }));

      const refRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: refinerContents }),
      });
      const refText = extractTextFromGemini(await refRes.json()).trim();
      refinedPrompt = refText.match(/REFINED_PROMPT:\s*([\s\S]*)/i)?.[1].trim() || refText;
    } catch {}
    
    const promptToSend = refinedPrompt || combinedPrompt;

    // 4️⃣ Send to Beatoven
    const composeRes = await fetch(`${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
      body: JSON.stringify({ prompt: { text: promptToSend }, format: 'mp3', looping: false }),
    });
    const composeJson = await composeRes.json();
    const taskId = composeJson?.task_id;
    if (!taskId) return NextResponse.json({ perBoardResults, error: 'No task_id returned', composeJson }, { status: 500 });

    // 5️⃣ Poll for final track
    let attempts = 0;
    let finalMeta: any = null;
    while (attempts++ < 90) {
      try {
        const stRes = await fetch(`${beatovenBase.replace(/\/$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${beatovenKey}` },
        });
        if (stRes.ok) {
          const stJson = await stRes.json();
          const status = stJson?.status;
          if (status === 'composed') { finalMeta = stJson?.meta || stJson; break; }
          if (status === 'failed' || status === 'error') return NextResponse.json({ perBoardResults, beatoven: stJson, error: 'Beatoven composition failed' }, { status: 500 });
        }
      } catch {}
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!finalMeta) return NextResponse.json({ perBoardResults, task_id: taskId, status: 'timed_out', error: 'Beatoven compose timed out' }, { status: 500 });

    const trackUrl = finalMeta.track_url || finalMeta.trackUrl || finalMeta.track?.downloadUrl || finalMeta.track?.url || null;
    const perBoardDurations = perBoardResults.map(r => ({ id: r.id, duration: r.segment_duration }));

    return NextResponse.json({ perBoardResults, perBoardDurations, combinedPrompt, beatovenPrompt: promptToSend, task_id: taskId, trackUrl, beatovenMeta: finalMeta });

  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
