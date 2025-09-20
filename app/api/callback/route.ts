import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    console.log('🎵 TemPolor Callback Received!');
    
    const callbackData = await req.json();
    console.log('📊 Full Callback Data:', JSON.stringify(callbackData, null, 2));
    
    // Log the callback details
    console.log('🎯 Callback Details:');
    console.log('   - Status:', callbackData.status);
    console.log('   - Task ID:', callbackData.data?.item_id || callbackData.item_id);
    console.log('   - Audio URL:', callbackData.data?.audio_url || callbackData.audio_url);
    console.log('   - Message:', callbackData.message);
    
    // Store the result (in a real app, you'd save this to a database)
    // For now, we'll just log it
    if (callbackData.status === 200000 && callbackData.data?.status === 'completed') {
      console.log('✅ Music generation completed via callback!');
      console.log('🎵 Audio URL:', callbackData.data.audio_url);
    } else if (callbackData.data?.status === 'failed') {
      console.log('❌ Music generation failed via callback');
    }
    
    // Return success to TemPolor
    return NextResponse.json({ 
      success: true, 
      message: 'Callback received successfully' 
    });
    
  } catch (error) {
    console.log('💥 Callback Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
