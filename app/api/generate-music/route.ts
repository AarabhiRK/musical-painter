import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

type GeminiResponse = any;

function extractTextFromGemini(data: GeminiResponse) {
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.output?.[0]?.content?.text ||
    JSON.stringify(data)
  );
}

function validatePrompt(obj: any) {
  if (!obj || typeof obj !== 'object') return false;
  const { mood, genre, tempo, duration } = obj;
  if (typeof mood !== 'string') return false;
  if (typeof genre !== 'string') return false;
  if (typeof tempo !== 'number' || Number.isNaN(tempo)) return false;
  if (typeof duration !== 'number' || Number.isNaN(duration)) return false;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    // Strict JSON schema prompt
    const humanPrompt = `You are a vision assistant. Analyze the attached drawing and OUTPUT ONLY a JSON object matching this exact schema (no explanation, no extra keys):\n{\n  "mood": string, // one word describing mood (e.g., calm, energetic)\n  "genre": string, // short music genre (e.g., ambient, cinematic, electronic, jazz, orchestral)\n  "tempo": number, // integer BPM, between 40 and 200\n  "duration": number // suggested duration in seconds, integer (e.g., 30, 60)\n}\nExample output:\n{ "mood": "wistful", "genre": "ambient", "tempo": 70, "duration": 30 }\nNow analyze the image and output only the JSON object.`;

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
                { inlineData: { mimeType: 'image/png', data: imageBase64 } },
              ],
            },
          ],
        }),
      }
    );

    const geminiData = await geminiRes.json();
    const geminiText = extractTextFromGemini(geminiData);

    // Extract JSON blob
    let parsed: any = null;
    try {
      const m = geminiText.match(/\{[\s\S]*\}/m);
      if (!m) throw new Error('No JSON found');
      parsed = JSON.parse(m[0]);
    } catch (e) {
      return NextResponse.json({ geminiRaw: geminiText, error: 'Failed to parse strict JSON from Gemini' });
    }

    // Coerce numeric fields and validate
    parsed.tempo = Number(parsed.tempo);
    parsed.duration = Number(parsed.duration);
    if (!validatePrompt(parsed)) {
      return NextResponse.json({ geminiRaw: geminiText, parsed, error: 'Parsed JSON does not match required schema' });
    }

    // Prepare Beatoven compose
    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    if (!beatovenKey) {
      return NextResponse.json({ prompt: parsed, error: 'BEATOVEN_API_KEY not set' }, { status: 500 });
    }

    const composeUrl = `${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`;
    const trackPrompt = `${parsed.duration} seconds ${parsed.mood} ${parsed.genre} track`;
    const composePayload = { prompt: { text: trackPrompt }, format: 'mp3', looping: false };

    const composeRes = await fetch(composeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
      body: JSON.stringify(composePayload),
    });

    if (!composeRes.ok) {
      const text = await composeRes.text();
      return NextResponse.json({ prompt: parsed, error: `Beatoven compose error: ${composeRes.status}`, details: text }, { status: 500 });
    }

    const composeJson = await composeRes.json();
    const taskId = composeJson?.task_id;
    if (!taskId) return NextResponse.json({ prompt: parsed, error: 'No task_id returned from Beatoven', composeJson });

    // Poll status
    const statusUrlBase = `${beatovenBase.replace(/\/$/, '')}/api/v1/tasks`;
    const maxAttempts = 60; // ~120s
    const intervalMs = 2000;
    let attempts = 0;
    let finalMeta: any = null;
    let lastStatus: any = null;

    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const stRes = await fetch(`${statusUrlBase}/${encodeURIComponent(taskId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${beatovenKey}` },
        });
        if (stRes.ok) {
          const stJson = await stRes.json();
          lastStatus = stJson?.status;
          if (stJson?.status === 'composed') {
            finalMeta = stJson?.meta || null;
            break;
          }
          if (stJson?.status === 'failed' || stJson?.status === 'error') {
            return NextResponse.json({ prompt: parsed, beatoven: stJson, error: 'Beatoven composition failed' }, { status: 500 });
          }
        }
      } catch (e) {
        // ignore transient errors
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    if (!finalMeta) {
      return NextResponse.json({ prompt: parsed, task_id: taskId, status: lastStatus || 'timed_out', error: 'Beatoven compose timed out' }, { status: 500 });
    }

    const trackUrl = finalMeta.track_url || finalMeta.trackUrl || null;
    if (!trackUrl) return NextResponse.json({ prompt: parsed, beatovenMeta: finalMeta, error: 'No track URL in Beatoven meta' }, { status: 500 });

    // Persist run metadata to data/runs.json for debugging/inspection
    (async () => {
      try {
        const runsDir = path.join(process.cwd(), 'data');
        const runsFile = path.join(runsDir, 'runs.json');
        await fs.mkdir(runsDir, { recursive: true });
        let runs: any[] = [];
        try {
          const existing = await fs.readFile(runsFile, 'utf-8');
          runs = JSON.parse(existing || '[]');
        } catch (e) {
          runs = [];
        }
        const entry = {
          id: `${Date.now()}-${Math.round(Math.random()*1000)}`,
          timestamp: new Date().toISOString(),
          prompt: parsed,
          task_id: taskId,
          trackUrl,
          beatovenMeta: finalMeta,
          geminiRaw: geminiText,
        };
        runs.unshift(entry);
        // keep last 200 runs to bound file size
        if (runs.length > 200) runs = runs.slice(0, 200);
        await fs.writeFile(runsFile, JSON.stringify(runs, null, 2), 'utf-8');
      } catch (e) {
        // ignore write errors so we don't break the API
        try { console.error('Failed to write run metadata', e); } catch {}
      }
    })();

    return NextResponse.json({ prompt: parsed, task_id: taskId, trackUrl, beatovenMeta: finalMeta });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
