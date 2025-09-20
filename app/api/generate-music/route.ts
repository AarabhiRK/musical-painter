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
      const humanPrompt = `
You are a music assistant. Convert the attached board into a concise, evocative musical brief for Beatoven. Include:
- Mood, genre, tempo/BPM
- Energy (0-1), key, instruments, percussion, texture, rhythm
- Duration: ${perBoardDuration}s
- Evolution: build/hold/release across segment
- Transition hint to next segment

Start with 'Background music:' and keep it natural-language, ready for Beatoven.
      `;

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
You are a senior music assistant. Combine per-segment briefs into a coherent track preserving board order. Output:
REFINED_PROMPT: 80-160 word natural-language prompt suitable for Beatoven. Include evolution (energy, instrumentation, tempo/key) and transitions.
SEGMENT_TIMINGS: One line per segment: '1) <id/name> - start: XXs - duration: YYs - mood: ... - transition: brief'.
      `;
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
