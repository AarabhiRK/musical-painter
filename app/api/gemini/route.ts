import { NextRequest, NextResponse } from 'next/server';

type GeminiResponse = any;

// Helper to safely extract text from Gemini response
function extractTextFromGemini(data: GeminiResponse) {
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.output?.[0]?.content?.text ||
    JSON.stringify(data)
  );
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    // Concise prompt: ask Gemini to summarize the image musically
    const humanPrompt = `You are an assistant that converts a drawing into a short musical prompt. 
Analyze the attached image and output a JSON object with:
- mood (1-2 words), 
- genre (short), 
- tempo (BPM), 
- duration (seconds), 
- instruments (2-6), 
- percussion (short description), 
- trackPrompt (30-60 words concise natural-language prompt suitable for music-generation APIs). 
Output only the JSON object.`;

    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: humanPrompt },
                { inlineData: { mimeType: 'image/png', data: imageBase64 } }
              ]
            }
          ]
        }),
      }
    );

    const geminiData = await geminiRes.json();
    const geminiText = extractTextFromGemini(geminiData);

    // Parse JSON from Gemini
    let parsedJSON: any = null;
    try {
      const jsonMatch = geminiText.match(/\{[\s\S]*\}/m);
      parsedJSON = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(geminiText);
    } catch (e) {
      return NextResponse.json({ geminiRaw: geminiText, error: 'Failed to parse JSON from Gemini output' });
    }

    // Generate a short Beatoven prompt (use trackPrompt if available, otherwise fallback)
    const trackPrompt = parsedJSON.trackPrompt?.trim() || `${parsedJSON.mood || ''} ${parsedJSON.genre || ''}`.trim() || 'ambient piece';

    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    let beatovenResult: any = null;

    if (beatovenKey) {
      try {
        const composeUrl = `${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`;
        const composePayload = { prompt: { text: trackPrompt }, format: 'mp3', looping: false };

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
      prompt: parsedJSON,
      trackPrompt,
      beatoven: beatovenResult,
      beatovenAudioUrl,
      beatovenAudioBase64,
      geminiRaw: geminiText,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
