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

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    // Prompt for Gemini
    const humanPrompt = `Convert this drawing into a short musical interpretation, a way to represent your visual art into a musical piece (works for scenes, patterns, and realistic drawings alike).`;

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
    const geminiText = extractTextFromGemini(geminiData).trim();

    if (!geminiText) {
      return NextResponse.json({ error: 'Gemini returned empty text' }, { status: 500 });
    }

    // Beatoven setup
    const beatovenKey = process.env.BEATOVEN_API_KEY;
    const beatovenBase = process.env.BEATOVEN_BASE_URL || 'https://public-api.beatoven.ai';
    if (!beatovenKey) return NextResponse.json({ error: 'BEATOVEN_API_KEY not set' }, { status: 500 });

    const composeUrl = `${beatovenBase.replace(/\/$/, '')}/api/v1/tracks/compose`;

    // Send Gemini output directly to Beatoven
    const trackPrompt = geminiText;
    console.log("Prompt sent to Beatoven:", trackPrompt);

    const composePayload = { prompt: { text: trackPrompt }, format: 'mp3', looping: false };
    const composeRes = await fetch(composeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${beatovenKey}` },
      body: JSON.stringify(composePayload),
    });

    if (!composeRes.ok) {
      const text = await composeRes.text();
      return NextResponse.json({ geminiText, error: `Beatoven compose error: ${composeRes.status}`, details: text }, { status: 500 });
    }

    const composeJson = await composeRes.json();
    const taskId = composeJson?.task_id;
    if (!taskId) return NextResponse.json({ geminiText, error: 'No task_id returned from Beatoven', composeJson });

    // Poll Beatoven until composition is ready
    const statusUrlBase = `${beatovenBase.replace(/\/$/, '')}/api/v1/tasks`;
    const maxAttempts = 60;
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
            return NextResponse.json({ geminiText, beatoven: stJson, error: 'Beatoven composition failed' }, { status: 500 });
          }
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    if (!finalMeta) {
      return NextResponse.json({ geminiText, task_id: taskId, status: lastStatus || 'timed_out', error: 'Beatoven compose timed out' }, { status: 500 });
    }

    const trackUrl = finalMeta.track_url || finalMeta.trackUrl || null;
    if (!trackUrl) return NextResponse.json({ geminiText, beatovenMeta: finalMeta, error: 'No track URL in Beatoven meta' }, { status: 500 });

    // Return Gemini text, Beatoven prompt, and track
    return NextResponse.json({
      prompt: geminiText,
      beatovenPrompt: trackPrompt, // natural language prompt sent to Beatoven
      task_id: taskId,
      trackUrl,
      beatovenMeta: finalMeta
    });


  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
