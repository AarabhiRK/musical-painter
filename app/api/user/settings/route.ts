import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { UserSettings } from '@/models/Board';
import { verifyToken } from '@/lib/auth';

// Get user settings
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await dbConnect();
    let settings = await UserSettings.findOne({ userId: payload.userId }).lean();

    // Create default settings if none exist
    if (!settings) {
      settings = await UserSettings.create({
        userId: payload.userId,
        customSwatches: ["#7dd3fc","#60a5fa","#a78bfa"],
        defaultBrushType: 'normal',
        defaultColor: "#2563eb",
        defaultWidth: 6
      });
    }

    return NextResponse.json(settings);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Update user settings
export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const updateData = await req.json();

    await dbConnect();
    const settings = await UserSettings.findOneAndUpdate(
      { userId: payload.userId },
      updateData,
      { upsert: true, new: true }
    );

    return NextResponse.json(settings);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
