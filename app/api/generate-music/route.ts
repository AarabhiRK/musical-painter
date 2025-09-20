import { NextRequest, NextResponse } from 'next/server';
import extractTextFromGemini from '../../../lib/gemini';

// Map number of valid boards to per-board duration (seconds)
const durationMap: Record<number, number> = {
  1: 60, // full piece (default total length)
  2: 30,
  3: 20,
  4: 15,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const boards: Array<{ id: string; name?: string; imageBase64?: string; strokeCount?: number }> = body?.boards || null;
    const totalDuration: number = typeof body?.totalDuration === 'number' ? body.totalDuration : 60;

    if (!Array.isArray(boards) || boards.length === 0) {
      return NextResponse.json({ error: 'No boards provided. Expecting { boards: [{ id, imageBase64, strokeCount }] }' }, { status: 400 });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    if (!beatovenKey) return NextResponse.json({ error: 'BEATOVEN_API_KEY not set' }, { status: 500 });

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

    // For each board, call Gemini to produce a concise natural-language musical brief (no JSON)
    const perBoardResults: Array<any> = [];

    for (let i = 0; i < limitedBoards.length; i++) {
      const b = limitedBoards[i];
  const humanPrompt = `You are a music assistant that converts a single drawing into a concise, expressive natural-language musical brief for a music-generation API. The brief must describe the segment's emotional intent AND how this segment should evolve if placed before or after other segments. Follow this example style exactly:\n\nExample single-image brief:\nBackground music: Tense playful battle scene with heroic undertones; tempo 110 BPM; energy 0.75; key A minor; instruments: synth bass, driving drums, electric guitar, brass stabs; percussion: medium-heavy; texture: full ensemble with occasional sparse breaks; rhythm: syncopated loopable groove; mood tags: tense, playful, heroic; duration ${perBoardDuration}s; use: cinematic background.\n\nAdditional requirements for each brief:\n- Mention whether it should 'build', 'hold', or 'release' when transitioning to the next segment (this defines gradual evolution).\n- If the scene should progress in intensity (e.g., peaceful -> angry), describe how instrumentation/energy should change over the segment (e.g., start with soft pads, gradually introduce rhythm and drums towards the end).\n- Include a short transition hint like 'transition: crossfade into next with rising percussion' or 'transition: soften into next with sparse plucked motif'.\n\nNow produce a brief for the attached image. Start with 'Background music:' and include tempo, energy (0-1), key (or 'none'), instruments, percussion, texture, rhythm, mood tags, duration (${perBoardDuration}s), whether it should 'build'/'hold'/'release', and a short 'transition:' hint. Keep it concise and natural-language.`;

      try {
        const geminiRes = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: humanPrompt },
                    { inlineData: { mimeType: 'image/png', data: b.imageBase64 } }
                  ]
                }
              ]
            })
          }
        );

        const geminiData = await geminiRes.json();
        const geminiText = extractTextFromGemini(geminiData).trim();

        // Keep the Gemini response as a natural-language brief
        perBoardResults.push({ id: b.id, name: b.name || `board-${i + 1}`, brief: geminiText, raw: geminiText, strokeCount: b.strokeCount || 0, segment_duration: perBoardDuration });
      } catch (e: any) {
        perBoardResults.push({ id: b.id, name: b.name || `board-${i + 1}`, error: e?.message || String(e) });
      }
    }

    // Build combined Beatoven prompt (fallback): assemble segment briefs in order and instruct for smooth transitions + tempo/key alignment
    const combinedSegmentsText = perBoardResults.map((r, idx) => {
      const segPrompt = r.brief || r.raw || '';
      return `Segment ${idx + 1} (${r.name || r.id}): ${segPrompt} Duration: ${r.segment_duration || perBoardDuration}s.`;
    }).join('\n\n');

    const sharedHints = `Ensure the entire composition is coherent: align segments to a consistent tempo (choose a BPM from the segments or a compromise), use gentle crossfades (1-3s) between segments, keep common sonic motifs across segments, and avoid harsh abrupt changes. Output a background music track of approximately ${totalDuration} seconds that contains the segments in order. Make the mix sit as non-intrusive background music suitable for scenes and looping if needed.`;

    const combinedPrompt = `Compose a single ${totalDuration}-second background music track composed of ${limitedBoards.length} ordered segments. ${sharedHints}\n\n${combinedSegmentsText}`;
    // Attempt a Gemini refiner pass in natural language: ask Gemini to output a labeled REFINED_PROMPT and SEGMENT_TIMINGS
    let refinedPrompt: string | null = null;
    try {
  const refinerHuman = `You are a senior music composition assistant. You will combine the per-segment briefs into a single coherent plan that preserves the visual ordering of the boards (do NOT reorder segments). Your output must guide how the whole piece should evolve so that the emotional flow of the boards is respected (for example: peaceful -> tense -> angry should gradually increase energy, introduce drums later, add distortion or heavier percussion toward the end).\n\nRequired output format (natural language):\n1) Start with a labeled section 'REFINED_PROMPT:' — a single, cohesive natural-language prompt (80-160 words) suitable for a music-generation API. The REFIND_PROMPT must say how instrumentation, tempo/key, energy, and textures evolve across the ordered segments, and include explicit transition instructions (crossfade lengths, motifs to repeat, where to add or remove drums, how to adjust intensity).\n2) Next include 'SEGMENT_TIMINGS:' — one line per segment in order: '1) <id/name> - start: XXs - duration: YYs - mood: ... - transition: brief instruction' (these timings should fit the total duration).\n\nImportant: preserve board order, and ensure transitions are gradual and follow the emotional arc described by the briefs (e.g., if brief 1 is calm and brief 3 is angry, describe a build across segments 1->2->3). Do NOT output JSON; use plain natural language with the labeled sections.\n\nNow produce the refiner output using the per-segment briefs below:`;

      const refinerContents: any[] = [ { parts: [{ text: refinerHuman }] } ];
      perBoardResults.forEach((r, idx) => {
        const text = `Segment ${idx + 1} (${r.id || r.name || 'segment'}): ${r.brief || r.raw || ''} Duration: ${r.segment_duration || perBoardDuration}s.`;
        refinerContents.push({ parts: [{ text }] });
      });

      const refRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: refinerContents }),
      });
      const refJson = await refRes.json();
      const refText = extractTextFromGemini(refJson).trim();

      // Extract the REFINED_PROMPT section; the REFINED_PROMPT must be 60-100 words and include short timestamped cues inline (e.g., "0-15s: ...").
      const rpMatch = refText.match(/REFINED_PROMPT:\s*([\s\S]*)/i);
      if (rpMatch) {
        refinedPrompt = rpMatch[1].trim();
      } else {
        refinedPrompt = refText || null;
      }
    } catch (e) {
      refinedPrompt = null;
    }

    // If refiner failed to produce a refined prompt, build a fallback natural-language prompt with explicit per-timestamp cues
    let promptToSend = '';
    if (refinedPrompt) {
      promptToSend = refinedPrompt;
    } else {
      // Build fallback timeline from perBoardResults
      let cursor = 0;
      const timelineLines: string[] = [];
      for (const r of perBoardResults) {
        const dur = r.segment_duration || perBoardDuration;
        const start = cursor;
        const end = cursor + dur;
        timelineLines.push(`${start}s-${end}s: ${r.brief || r.raw || ''}`);
        cursor = end;
      }
      const timelineText = timelineLines.join('; ');
      promptToSend = `${combinedPrompt} Timeline: ${timelineText}`;
    }

    // Send prompt (refined or combined) to Beatoven
    const composeUrl = `${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`;
    const composePayload = { prompt: { text: promptToSend }, format: 'mp3', looping: false };

    // Log the final prompt sent to Beatoven for debugging/inspection
    try {
      console.log('Prompt sent to Beatoven:', promptToSend);
    } catch (e) {}

    let composeRes: any = null;
    try {
      const res = await fetch(composeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
        body: JSON.stringify(composePayload),
      });
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ perBoardResults, error: `Beatoven compose error: ${res.status}`, details: text }, { status: 500 });
      }
      composeRes = await res.json();
    } catch (e: any) {
      return NextResponse.json({ perBoardResults, error: e?.message || String(e) }, { status: 500 });
    }

    const taskId = composeRes?.task_id;
    if (!taskId) return NextResponse.json({ perBoardResults, error: 'No task_id returned from Beatoven', composeRes }, { status: 500 });

    // Poll for final track
    const statusUrlBase = `${beatovenBase.replace(/\/$/, '')}/api/v1/tasks`;
    let attempts = 0;
    let finalMeta: any = null;
    while (attempts++ < 90) {
      try {
        const stRes = await fetch(`${statusUrlBase}/${encodeURIComponent(taskId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${beatovenKey}` },
        });
        if (stRes.ok) {
          const stJson = await stRes.json();
          const status = stJson?.status;
          if (status === 'composed') {
            finalMeta = stJson?.meta || stJson;
            break;
          }
          if (status === 'failed' || status === 'error') {
            return NextResponse.json({ perBoardResults, beatoven: stJson, error: 'Beatoven composition failed' }, { status: 500 });
          }
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!finalMeta) {
      return NextResponse.json({ perBoardResults, task_id: taskId, status: 'timed_out', error: 'Beatoven compose timed out' }, { status: 500 });
    }

    const trackUrl = finalMeta.track_url || finalMeta.trackUrl || finalMeta.track?.downloadUrl || finalMeta.track?.url || finalMeta?.track_url || null;

    const perBoardDurations = perBoardResults.map((r: any) => ({ id: r.id, duration: r.segment_duration || perBoardDuration }));

    return NextResponse.json({
      perBoardResults,
      perBoardDurations,
      combinedPrompt,
      beatovenPrompt: promptToSend,
      task_id: taskId,
      trackUrl,
      beatovenMeta: finalMeta,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
