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
      const humanPrompt = `You are a professional music supervisor analyzing a drawing to create a musical prompt. Follow this analysis hierarchy:

STEP 1 - IDENTIFY CONTENT TYPE:
First, determine what type of drawing this is:
- REPRESENTATIONAL: Contains recognizable objects, people, scenes, or landscapes
- ABSTRACT: Contains shapes, patterns, or non-representational elements
- MINIMAL: Very few strokes, mostly empty space, or extremely simple

STEP 2 - CONTENT ANALYSIS (choose the most appropriate):

If REPRESENTATIONAL (recognizable elements):
- Identify specific objects, scenes, or subjects (e.g., "mountain landscape", "person's face", "city skyline")
- Describe the mood and atmosphere these elements suggest
- Choose genre based on content: cinematic orchestral for landscapes, ambient electronic for faces, acoustic folk for nature scenes

If ABSTRACT (shapes/patterns but no clear objects):
- Analyze the stroke patterns, shapes, and composition
- Describe the energy and movement suggested by the forms
- Choose genre based on patterns: ambient electronic for flowing shapes, cinematic orchestral for geometric forms, lo-fi hip hop for organic patterns

If MINIMAL (very few strokes or mostly empty):
- Focus primarily on color palette and overall mood
- Use ethereal, ambient, or minimalist musical styles
- Keep tempo slow (60-80 BPM) and texture sparse

STEP 3 - MUSICAL TRANSLATION:
Create a music prompt that matches your analysis. Use this format:

BACKGROUND_MUSIC: [Start with "Background music:"]

CONTENT_TYPE: [REPRESENTATIONAL/ABSTRACT/MINIMAL]

THEME: [What you actually see or the overall mood if abstract]

MOOD: [Single emotional tone: calm/melancholic/energetic/mysterious/etc.]

GENRE: [Beatoven-compatible: cinematic orchestral/ambient electronic/acoustic folk/lo-fi hip hop/minimalist ambient]

TEMPO: [BPM range based on content energy]

TEXTURE: [Musical density: sparse/minimal/moderate/rich]

Keep total output 40-80 words. Better to be simple and accurate than complex and wrong.`;

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

SEGMENT_TIMINGS:
One line per segment in order, so that the music has transitions from board to board`;

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