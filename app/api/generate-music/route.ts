import { NextRequest, NextResponse } from 'next/server';
import extractTextFromGemini from '../../../lib/gemini';

const durationMap: Record<number, number> = { 1: 60, 2: 30, 3: 20, 4: 15 };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const boards: Array<{ id: string; name?: string; imageBase64?: string; strokeCount?: number }> = body?.boards || [];
    const totalDuration: number = typeof body?.totalDuration === 'number' ? body.totalDuration : 60;
    const retryMode = body?.retryMode === true;
    const adjustMode = body?.adjustMode === true;
    const beatovenPrompt = body?.beatovenPrompt;
    const adjustInstructions = body?.adjustInstructions;

    const geminiKey = process.env.GEMINI_API_KEY;
    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    if (!geminiKey || !beatovenKey) return NextResponse.json({ error: 'API keys not set' }, { status: 500 });

    // Handle retry mode - use existing prompt directly
    if (retryMode && beatovenPrompt) {
      const composeRes = await fetch(`${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
        body: JSON.stringify({ prompt: { text: beatovenPrompt }, format: 'mp3', looping: false }),
      });
      const composeJson = await composeRes.json();
      const taskId = composeJson?.task_id;
      if (!taskId) return NextResponse.json({ error: 'No task_id returned', composeJson }, { status: 500 });

      // Poll for completion
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
            if (status === 'failed' || status === 'error') return NextResponse.json({ beatoven: stJson, error: 'Beatoven composition failed' }, { status: 500 });
          }
        } catch {}
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!finalMeta) return NextResponse.json({ task_id: taskId, status: 'timed_out', error: 'Beatoven compose timed out' }, { status: 500 });

      const trackUrl = finalMeta.track_url || finalMeta.trackUrl || finalMeta.track?.downloadUrl || finalMeta.track?.url || null;
      return NextResponse.json({ beatovenPrompt, task_id: taskId, trackUrl, beatovenMeta: finalMeta });
    }

    // Handle adjust mode - modify existing prompt
    if (adjustMode && beatovenPrompt && adjustInstructions) {
      const adjustPrompt = `You are a music supervisor. Modify this existing Beatoven prompt based on the user's adjustment instructions.

ORIGINAL PROMPT:
${beatovenPrompt}

USER ADJUSTMENT REQUEST:
${adjustInstructions}

INSTRUCTIONS:
- Keep the core musical elements that work well
- Apply the requested changes while maintaining Beatoven compatibility
- Ensure the output is still a coherent musical prompt
- Use natural language descriptions, not technical music notation
- Maintain the same duration and overall structure

OUTPUT:
Provide the modified prompt ready for Beatoven, incorporating the requested changes.`;

      const adjustRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: adjustPrompt }] }] }),
      });

      if (!adjustRes.ok) {
        const errorText = await adjustRes.text();
        return NextResponse.json({ error: `Adjustment failed: ${errorText}` }, { status: 500 });
      }

      const adjustData = await adjustRes.json();
      const adjustedPrompt = extractTextFromGemini(adjustData).trim();

      if (!adjustedPrompt) {
        return NextResponse.json({ error: 'Failed to generate adjusted prompt' }, { status: 500 });
      }

      // Use the adjusted prompt with Beatoven
      const composeRes = await fetch(`${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
        body: JSON.stringify({ prompt: { text: adjustedPrompt }, format: 'mp3', looping: false }),
      });
      const composeJson = await composeRes.json();
      const taskId = composeJson?.task_id;
      if (!taskId) return NextResponse.json({ error: 'No task_id returned', composeJson }, { status: 500 });

      // Poll for completion
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
            if (status === 'failed' || status === 'error') return NextResponse.json({ beatoven: stJson, error: 'Beatoven composition failed' }, { status: 500 });
          }
        } catch {}
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!finalMeta) return NextResponse.json({ task_id: taskId, status: 'timed_out', error: 'Beatoven compose timed out' }, { status: 500 });

      const trackUrl = finalMeta.track_url || finalMeta.trackUrl || finalMeta.track?.downloadUrl || finalMeta.track?.url || null;
      return NextResponse.json({ beatovenPrompt: adjustedPrompt, task_id: taskId, trackUrl, beatovenMeta: finalMeta });
    }

    // Original flow for new generation
    if (!boards.length) return NextResponse.json({ error: 'No boards provided' }, { status: 400 });

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

    // 1️⃣ Generate per-board musical briefs (parallel processing)
    const processBoard = async (board: any, index: number): Promise<any> => {
      const humanPrompt = `Analyze the image and write a natural-language prompt for Beatoven to generate music. Start exactly with:
"Background music:"

Use **clear, evocative, descriptive language**. Describe:
1. Overall theme and story of the image.
2. Mood and tempo using qualitative words (e.g., calm, playful, energetic, slow, uplifting).
3. Genre/style: e.g., ambient, cinematic orchestral, lo-fi hip hop, synthwave.
4. Instruments: describe textures and roles (e.g., "bright, melodic piano," "warm, resonant strings," "rhythmic offbeat guitar").
5. Evolution: how the music flows, builds energy, or creates emotion over time.
6. Duration: ~${perBoardDuration} seconds.

**Do NOT use BPM, key, or technical musical terms.**
Keep output 30–100 words as a single paragraph. Only output the final prompt.`;

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: humanPrompt }, { inlineData: { mimeType: 'image/png', data: board.imageBase64 } }] }] }),
          }
        );

        // Validate response status before parsing JSON
        if (!geminiRes.ok) {
          const errorText = await geminiRes.text();
          throw new Error(`Gemini API error (${geminiRes.status}): ${errorText}`);
        }

        const geminiData = await geminiRes.json();
        
        // Validate Gemini response structure
        if (!geminiData || (!geminiData.candidates && !geminiData.output)) {
          throw new Error('Invalid Gemini API response structure');
        }

        const briefText = extractTextFromGemini(geminiData).trim();
        
        if (!briefText || briefText === '') {
          throw new Error('Empty response from Gemini API');
        }

        return { 
          id: board.id, 
          name: board.name || `board-${index + 1}`, 
          brief: briefText, 
          raw: geminiData, 
          strokeCount: board.strokeCount || 0, 
          segment_duration: perBoardDuration 
        };
      } catch (e: any) {
        return { 
          id: board.id, 
          name: board.name || `board-${index + 1}`, 
          error: e?.message || String(e) 
        };
      }
    };

    // Process all boards in parallel
    const perBoardResults: Array<any> = await Promise.all(
      limitedBoards.map((board, index) => processBoard(board, index))
    );

    // 2️⃣ Build combined prompt with smooth transitions
    const combinedSegmentsText = perBoardResults.map((r, idx) => `Segment ${idx + 1} (${r.name || r.id}): ${r.brief || r.raw} Duration: ${r.segment_duration}s.`).join('\n\n');

    const sharedHints = `
      Ensure coherence: align tempo, crossfade 1-3s, maintain sonic motifs, avoid abrupt changes. Output ~${totalDuration}s background music track of ordered segments suitable for scenes/looping.
    `;

    const combinedPrompt = `Compose a single ${totalDuration}-second track composed of ${num} ordered segments. ${sharedHints}\n\n${combinedSegmentsText}`;

    // 3️⃣ Optional Gemini refiner for a polished prompt
    let refinedPrompt: string | null = null;
    try {
      const refinerHuman = `You are a senior music supervisor. Combine the per-segment musical briefs into one unified prompt for Beatoven AI music generation.

ABOUT BEATOVEN:
Beatoven is an AI music generation service that creates background music from text prompts. It works best with:
- Clear, descriptive language about mood, genre, and instruments
- Specific tempo and key information
- Cinematic and ambient music styles
- Smooth, flowing compositions suitable for background use
- Natural language descriptions rather than technical music notation

Requirements:
<<<<<<< HEAD
- Preserve the chronological order of segments.
- Ensure coherence across tempo, genre, and instrumentation.
- Smooth transitions between segments (crossfade 1–3s, carry motifs forward).
- Total track duration: ~${totalDuration}s.
- Use Beatoven-friendly language (avoid complex music theory terms).

Output format:
REFINED_PROMPT:
Write an 80–160 word natural-language brief ready for Beatoven. Include:
1. Overall theme/message of the combined boards clearly and specifically based on drawing.
2. Unified genre (use Beatoven-compatible genres like "cinematic orchestral", "ambient electronic", "acoustic folk").
3. Mood progression across segments should also be somewhat unified but not necessarily the same as genre.
4. Tempo/BPM and key (consistent or evolving if necessary).
5. Core instruments and textures appearing across sections.
6. Segment evolution: describe how energy builds/holds/releases across the whole track.
7. Transition style (how one segment flows into the next).
=======
- Preserve chronological order of segments.
- Ensure smooth transitions and coherence across mood, style, and instrumentation.
- Describe overall mood, instrument textures, and how music evolves across the track.
- Total track duration: ~${totalDuration} seconds.

Output format:
REFINED_PROMPT:
Write 80–160 words using **evocative, descriptive language** ready for Beatoven. Emphasize mood, instruments, and evolution rather than technical details.
Include:
1. Overall theme/message.
2. Unified mood and style.
3. Core instruments and textures with adjectives.
4. Segment evolution: how energy and emotion develop across the track.
5. Natural transitions between segments.
>>>>>>> dda75c82bdccf4c4a8d6edc7303fc38f48f66daf

SEGMENT_TIMINGS:
One line per segment for reference only; musical description should remain in natural language form.`;

      const refinerContents: any[] = [{ parts: [{ text: refinerHuman }] }];
      perBoardResults.forEach((r, idx) => refinerContents.push({ parts: [{ text: `Segment ${idx + 1} (${r.id || r.name}): ${r.brief || r.raw} Duration: ${r.segment_duration}s.` }] }));

      const refRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: refinerContents }),
      });

      // Validate refiner response status
      if (!refRes.ok) {
        const errorText = await refRes.text();
        console.warn(`Gemini refiner API error (${refRes.status}): ${errorText}`);
        throw new Error(`Refiner API error: ${refRes.status}`);
      }

      const refinerData = await refRes.json();
      
      // Validate refiner response structure
      if (!refinerData || (!refinerData.candidates && !refinerData.output)) {
        throw new Error('Invalid refiner API response structure');
      }

      const refText = extractTextFromGemini(refinerData).trim();
      
      if (!refText || refText === '') {
        throw new Error('Empty response from refiner API');
      }

      refinedPrompt = refText.match(/REFINED_PROMPT:\s*([\s\S]*)/i)?.[1].trim() || refText;
    } catch (e: any) {
      console.warn('Gemini refiner failed, using combined prompt:', e?.message || String(e));
    }
    
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