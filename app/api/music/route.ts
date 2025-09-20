import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();
    console.log('🎨 Music Generation Started');
    console.log('📸 Image Base64 length:', imageBase64?.length || 'No image data');
    console.log('📸 Image Base64 preview:', imageBase64?.substring(0, 100) + '...');
    
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const tempolorApiKey = process.env.TEMPOLOR_API_KEY;
    
    if (!geminiApiKey) {
      console.log('❌ Gemini API key not set');
      return NextResponse.json({ error: 'Gemini API key not set' }, { status: 500 });
    }
    
    if (!tempolorApiKey) {
      console.log('❌ TemPolor API key not set');
      return NextResponse.json({ error: 'TemPolor API key not set' }, { status: 500 });
    }

    console.log('✅ API keys found, proceeding with analysis...');
    console.log('🔑 TemPolor API Key format:', tempolorApiKey ? `Tempo-${tempolorApiKey.substring(0, 8)}...` : 'Not set');
    console.log('🔑 TemPolor API Key full:', tempolorApiKey ? `Bearer ${tempolorApiKey}` : 'Not set');

    // Step 1: Analyze the drawing with Gemini
    const geminiPrompt = `You are tasked with analyzing a user-provided drawing and translating its visual + stylistic qualities into structured musical descriptors for a music generation API. Users may submit both very rough sketches (shady, abstract, child-like) and highly detailed, polished drawings. You must handle both ends of this spectrum.

Step 1. Extract visual features:
- Dominant colors: e.g., bright warm vs dark cool
- Line/shape style: e.g., smooth flowing vs jagged chaotic
- Density: minimalist sparse vs detailed crowded
- Symmetry/geometry: regular patterns vs irregular composition
- Movement: horizontal calm vs diagonal energetic
- Subject matter keywords: scenery, portrait, abstract, character, etc.
- Emotional tone (inferred): joyful, melancholic, tense, dreamy, epic

Step 2. Translate to music parameters:
- Tempo (BPM): fast for energetic or chaotic strokes, slow for calm/vertical balance
- Key / Tonality: major for bright/warm colors, minor or modal for dark/cool
- Instrumentation: smooth curves → strings/piano; jagged/chaotic → percussion/synth/brass
- Dynamics: bold large shapes → forte; delicate small details → pianissimo
- Structure: symmetric → repetitive/loop-like; irregular → free/through-composed
- Mood tags: directly tied to the inferred emotional tone and subject matter

Step 3. Final output format:
Generate a 45-second instrumental piece inspired by [subject description].
Tempo: [BPM], [rhythm description].
Key: [key signature], [harmonic character].
Instruments: [primary instruments].
Dynamics: [dynamic range].
Mood: [emotional descriptors].
Structure: [form description].`;

    console.log('🤖 Sending request to Gemini API...');
    console.log('📝 Full Gemini Prompt:', geminiPrompt);
    console.log('📝 Prompt length:', geminiPrompt.length, 'characters');
    
    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiApiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: geminiPrompt },
              { inlineData: { mimeType: 'image/png', data: imageBase64 } }
            ]
          }
        ]
      }),
    });

    console.log('📡 Gemini API Response Status:', geminiResponse.status);
    const geminiData = await geminiResponse.json();
    console.log('📊 Full Gemini API Response:', JSON.stringify(geminiData, null, 2));
    
    if (!geminiResponse.ok || geminiData.error) {
      console.log('❌ Gemini API Error:', geminiData.error);
      throw new Error(geminiData.error?.message || geminiData.error || `Gemini API request failed with status ${geminiResponse.status}`);
    }
    
    const analysis = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'No analysis returned.';
    console.log('🎯 Full Gemini Analysis Result:', analysis);
    console.log('🎯 Analysis length:', analysis.length, 'characters');
    
    // Step 2: Parse the analysis and format for TemPolor API
    const musicParams = parseAnalysisForBeatoven(analysis);
    console.log('🎼 Full Parsed Music Parameters:', JSON.stringify(musicParams, null, 2));
    console.log('🎼 Music Parameters breakdown:');
    console.log('   - Tempo:', musicParams.tempo, 'BPM');
    console.log('   - Key:', musicParams.key);
    console.log('   - Mood:', musicParams.mood);
    console.log('   - Genre:', musicParams.genre);
    console.log('   - Instruments:', musicParams.instruments);
    console.log('   - Style:', musicParams.style);
    
    // Step 3: Call TemPolor API
    const tempolorPayload = {
      prompt: `Genre: ${musicParams.genre}, ${musicParams.style} Style: Instrumental, ${musicParams.instruments} Mood: ${musicParams.mood} Tempo: ${musicParams.tempo} BPM Key: ${musicParams.key}`,
      model: "TemPolor v3.5"
    };
    
    console.log('🎵 TemPolor API Payload Construction:');
    console.log('   - Original prompt:', musicParams.prompt);
    console.log('   - Formatted prompt:', tempolorPayload.prompt);
    console.log('   - Model:', tempolorPayload.model);
    
    // Step 3: Call TemPolor API using the correct useapi.net format
    const tempolorPayloadWithCallback = {
      prompt: tempolorPayload.prompt,
      model_song: "v3.5", // Correct parameter name for useapi.net
      replyUrl: "https://your-callback-url.com/callback" // Correct parameter name for useapi.net
    };
    
    console.log('🎵 Final TemPolor Payload with Callback:');
    console.log('   - Full payload:', JSON.stringify(tempolorPayloadWithCallback, null, 2));
    console.log('   - Payload size:', JSON.stringify(tempolorPayloadWithCallback).length, 'characters');
    
    // Get the base URL for the callback
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const callbackUrl = `${baseUrl}/api/callback`;
    
    console.log('🔗 Callback URL:', callbackUrl);
    
    // Try different TemPolor API endpoints and payload formats
    const tempolorEndpoints = [
      {
        url: 'https://api.tempolor.com/open-apis/v1/song/generate',
        payload: {
          prompt: tempolorPayload.prompt,
          model: "TemPolor v3.5",
          callback_url: callbackUrl
        }
      },
      {
        url: 'https://api.tempolor.com/open-apis/v1/song/generate',
        payload: {
          prompt: tempolorPayload.prompt,
          model: "v3.5",
          callback_url: callbackUrl
        }
      },
      {
        url: 'https://api.useapi.net/v1/tempolor/music/song',
        payload: {
          prompt: tempolorPayload.prompt,
          model_song: "v3.5",
          replyUrl: callbackUrl
        }
      }
    ];
    
    let tempolorData = null;
    let workingEndpoint = null;
    let workingAuth = null;
    
    for (const endpointConfig of tempolorEndpoints) {
      try {
        console.log('🎵 Trying TemPolor API endpoint:', endpointConfig.url);
        console.log('📤 TemPolor Payload:', JSON.stringify(endpointConfig.payload, null, 2));
        
        // Try different authentication formats for TemPolor
        const authFormats = [
          `Bearer ${tempolorApiKey}`,
          `Tempo-${tempolorApiKey}`,
          tempolorApiKey,
          `Bearer Tempo-${tempolorApiKey}`,
          `Tempo ${tempolorApiKey}`
        ];
        
        let tempolorResponse = null;
        
        for (const authFormat of authFormats) {
          try {
            console.log('🔑 Trying auth format:', authFormat);
            
            tempolorResponse = await fetch(endpointConfig.url, {
              method: 'POST',
              headers: {
                'Authorization': authFormat,
                'Content-Type': 'application/json; charset=utf-8',
              },
              body: JSON.stringify(endpointConfig.payload),
            });
            
            console.log('📡 Response Status:', tempolorResponse.status);
            
            if (tempolorResponse.status === 200) {
              const responseText = await tempolorResponse.text();
              console.log('📄 Response:', responseText);
              
              // Check if this is a successful response
              if (responseText.includes('"status":200000') || responseText.includes('"result":true')) {
                workingAuth = authFormat;
                workingEndpoint = endpointConfig.url;
                tempolorData = JSON.parse(responseText);
                console.log('✅ Found working auth format:', authFormat);
                console.log('✅ Found working endpoint:', endpointConfig.url);
                console.log('✅ Parsed response data:', tempolorData);
                break;
              }
            }
          } catch (error) {
            console.log('❌ Auth format failed:', authFormat, error instanceof Error ? error.message : 'Unknown error');
            continue;
          }
        }
        
        if (!workingAuth) {
          console.log('❌ All auth formats failed for endpoint:', endpointConfig.url);
          continue;
        }

        // We already have the response data from the successful auth format test
        console.log('🎉 Successfully connected to TemPolor API!');
        break;
      } catch (error) {
        console.log('❌ Endpoint failed:', endpointConfig.url, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }
    
    // If no endpoint worked, use mock implementation
    if (!tempolorData || !workingEndpoint) {
      console.log('⚠️ All TemPolor API endpoints failed, using mock implementation');
      console.log('📊 Mock TemPolor API Response: {"status": 200000, "data": {"item_ids": ["mock_task_123"]}}');
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const mockTaskId = `mock_task_${Date.now()}`;
      console.log('🎫 Mock Task ID:', mockTaskId);
      
      // Simulate polling process
      console.log('⏳ Starting mock polling for music completion...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // Simulate processing time
      
      // Mock audio URL (using a sample audio file)
      const mockAudioUrl = 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav';
      console.log('✅ Mock music generation completed! Audio URL:', mockAudioUrl);

      console.log('🎉 Mock TemPolor music generation successful! Returning result...');
      return NextResponse.json({ 
        success: true,
        audioUrl: mockAudioUrl,
        trackId: mockTaskId,
        analysis,
        musicParams,
        message: 'Mock music generated successfully! (TemPolor API endpoints not accessible)'
      });
    }

    // Step 4: Get the task ID and poll for completion
    // Handle both useapi.net format (jobs array) and direct TemPolor format (data.item_ids)
    const taskId = tempolorData?.jobs?.[0] || tempolorData?.data?.item_ids?.[0];
    console.log('🎫 Task ID from TemPolor:', taskId);
    console.log('🎫 Response format detected:', tempolorData?.jobs ? 'useapi.net format' : 'direct TemPolor format');
    console.log('🎫 Full tempolorData:', JSON.stringify(tempolorData, null, 2));
    
    if (!taskId) {
      console.log('❌ No task ID returned from TemPolor API');
      throw new Error('No task ID returned from TemPolor API');
    }

    // Try callback first, fallback to polling if needed
    console.log('🎵 Music generation started! TemPolor will call back to:', callbackUrl);
    console.log('⏳ Waiting for callback... (fallback polling available if callback fails)');
    
    // For now, let's still use polling as a fallback
    // In a real app, you'd store the task ID and wait for the callback
    let audioUrl = null;
    let attempts = 0;
    const maxAttempts = 20; // 20 attempts = 40 seconds max
    const pollInterval = 2000; // 2 seconds between polls

    console.log('⏳ Starting fallback polling for music completion...');
    console.log(`⏱️ Polling every ${pollInterval/1000}s for up to ${maxAttempts * pollInterval/1000}s`);
    
    while (!audioUrl && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      attempts++;
      
      console.log(`🔄 Polling attempt ${attempts}/${maxAttempts} for task ${taskId} (fallback - callback preferred)`);
      
      // Use the same base URL as the working endpoint
      const statusEndpoint = workingEndpoint.replace('/song/generate', '/song/status');
      
      // Use the exact same auth format that worked for the generate endpoint
      console.log('🔑 Using working auth format for status:', workingAuth);
      
      const statusResponse = await fetch(statusEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': workingAuth || '',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ item_id: taskId }),
      });
      
      console.log('📡 Status Response Status:', statusResponse.status);
      const statusData = await statusResponse.json();
      
      console.log('📊 Status Response Data:', JSON.stringify(statusData, null, 2));
      
      if (statusData.status === 200000 && statusData.data?.status === 'completed' && statusData.data?.audio_url) {
        audioUrl = statusData.data.audio_url;
        console.log('✅ Music generation completed! Audio URL:', audioUrl);
        break;
      } else if (statusData.data?.status === 'failed') {
        console.log('❌ Music generation failed');
        throw new Error('Music generation failed');
      }
    }

    if (!audioUrl) {
      console.log('⏰ Music generation timed out after', maxAttempts, 'attempts (40 seconds)');
      throw new Error('Music generation timed out after 40 seconds');
    }

    console.log('🎉 TemPolor music generation successful! Returning result...');
    return NextResponse.json({ 
      success: true,
      audioUrl,
      trackId: taskId,
      analysis,
      musicParams,
      message: 'Music generated successfully using TemPolor!'
    });
    
  } catch (error) {
    console.log('💥 Music Generation Error:', error);
    console.log('📝 Error Details:', error instanceof Error ? error.message : 'Unknown error');
    console.log('🔍 Error Stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

function parseAnalysisForBeatoven(analysis: string) {
  // Extract parameters from the Gemini analysis
  const tempoMatch = analysis.match(/Tempo:\s*(\d+)/i);
  const keyMatch = analysis.match(/Key:\s*([A-G][#b]?\s*(?:major|minor|maj|min))/i);
  const moodMatch = analysis.match(/Mood:\s*([^.]+)/i);
  const instrumentsMatch = analysis.match(/Instruments:\s*([^.]+)/i);
  
  // Default values
  const tempo = tempoMatch ? parseInt(tempoMatch[1]) : 120;
  const key = keyMatch ? keyMatch[1].trim() : 'C major';
  const mood = moodMatch ? moodMatch[1].trim() : 'neutral';
  const instruments = instrumentsMatch ? instrumentsMatch[1].trim() : 'piano, strings';
  
  // Determine genre based on mood and instruments
  let genre = 'instrumental';
  if (mood.toLowerCase().includes('tense') || mood.toLowerCase().includes('dramatic')) {
    genre = 'cinematic';
  } else if (mood.toLowerCase().includes('calm') || mood.toLowerCase().includes('peaceful')) {
    genre = 'ambient';
  } else if (mood.toLowerCase().includes('energetic') || mood.toLowerCase().includes('upbeat')) {
    genre = 'electronic';
  }
  
  return {
    prompt: analysis,
    tempo,
    key,
    mood,
    genre,
    instruments,
    style: 'contemporary'
  };
}
