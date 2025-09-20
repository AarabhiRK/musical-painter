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
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });
    }

    // Prompt template: ask Gemini Vision to analyze the image and return a JSON
    // object that will be used to instruct the music-generation service.
    const humanPrompt = `You are an assistant that converts a drawing into a music-generation prompt.\n\n` +
      `Analyze the attached image and produce a single JSON object (no extra commentary) with the following keys:\n` +
      `title: short title for the piece\n` +
      `description: 2-3 sentence description of the scene/elements\n` +
      `mood: one or two words (e.g., wistful, energetic, calm)\n` +
      `genre: musical genre suggestion (e.g., ambient, cinematic, electronic, jazz, orchestral)\n` +
      `tempo: suggested tempo in BPM (integer)\n` +
      `instruments: array of 2-6 instrument names\n` +
      `energy: number between 0.0 and 1.0 indicating intensity\n` +
      `duration: suggested duration in seconds (e.g., 30, 60)\n` +
      `trackPrompt: a 20-40 word concise prompt suitable for music-generation APIs describing the desired music (use mood, tempo, instruments)\n\n` +
      `Output only the JSON object. Now analyze the image and output the JSON.`;

    // Call Gemini Vision / Generative Language API with inline image
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

    // Try to extract JSON from the model output
    let parsedJSON: any = null;
    try {
      const jsonMatch = geminiText.match(/\{[\s\S]*\}/m);
      if (jsonMatch) {
        parsedJSON = JSON.parse(jsonMatch[0]);
      } else {
        // as a last resort try to parse the whole text
        parsedJSON = JSON.parse(geminiText);
      }
    } catch (e) {
      // return the model text so client can show it for debugging
      return NextResponse.json({
        geminiRaw: geminiText,
        error: 'Failed to parse JSON from Gemini output',
      });
    }

    // If Beatoven integration is configured, use the Compose API and poll until composed
    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    let beatovenResult: any = null;

    if (beatovenKey) {
      try {
        const composeUrl = `${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`;
        const composePayload = {
          prompt: { text: parsedJSON.trackPrompt || parsedJSON.description || `${parsedJSON.mood || ''} ${parsedJSON.genre || ''}`.trim() || 'ambient piece' },
          format: 'mp3',
          looping: false,
        };

        const composeRes = await fetch(composeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${beatovenKey}`,
          },
          body: JSON.stringify(composePayload),
        });

        if (!composeRes.ok) {
          const text = await composeRes.text();
          beatovenResult = { error: `Beatoven compose error: ${composeRes.status}`, details: text };
        } else {
          const composeJson = await composeRes.json();
          // expected: { status: 'started', task_id }
          const taskId = composeJson?.task_id;
          beatovenResult = composeJson;

          if (taskId) {
            // Poll for status
            const statusUrlBase = `${beatovenBase.replace(/\/$/, '')}/api/v1/tasks`;
            const maxAttempts = 45; // ~90s with 2s interval
            const intervalMs = 2000;
            let attempts = 0;
            let finalMeta: any = null;

            while (attempts < maxAttempts) {
              attempts += 1;
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
                  if (status === 'failed' || status === 'error') {
                    break;
                  }
                } else {
                  // non-ok status; keep trying until timeout
                }
              } catch (e) {
                // ignore transient errors
              }
              // wait
              await new Promise((r) => setTimeout(r, intervalMs));
            }

            if (finalMeta) {
              // attach meta to beatovenResult for downstream normalization
              beatovenResult = { ...beatovenResult, meta: finalMeta };
            } else {
              // timeout
              beatovenResult = { ...beatovenResult, error: 'Beatoven compose timed out or failed', task_id: taskId };
            }
          }
        }
      } catch (e: any) {
        beatovenResult = { error: e.message || String(e) };
      }
    }

    // Normalize possible audio outputs from Beatoven
    let beatovenAudioUrl: string | null = null;
    let beatovenAudioBase64: string | null = null;
    if (beatovenResult) {
      if (typeof beatovenResult === 'string') {
        beatovenAudioUrl = beatovenResult;
      } else if (beatovenResult.audioUrl) {
        beatovenAudioUrl = beatovenResult.audioUrl;
      } else if (beatovenResult.track && beatovenResult.track.downloadUrl) {
        beatovenAudioUrl = beatovenResult.track.downloadUrl;
      } else if (beatovenResult.meta && beatovenResult.meta.track_url) {
        beatovenAudioUrl = beatovenResult.meta.track_url;
      } else if (beatovenResult.data && beatovenResult.data.audio && beatovenResult.data.audio.url) {
        beatovenAudioUrl = beatovenResult.data.audio.url;
      } else if (beatovenResult.audioBase64) {
        beatovenAudioBase64 = beatovenResult.audioBase64;
      } else if (beatovenResult.base64) {
        beatovenAudioBase64 = beatovenResult.base64;
      }
    }

    return NextResponse.json({
      prompt: parsedJSON,
      beatoven: beatovenResult,
      beatovenAudioUrl,
      beatovenAudioBase64,
      geminiRaw: geminiText,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
