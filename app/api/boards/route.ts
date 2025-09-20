import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Board, UserSettings } from '@/models/Board';
import { verifyToken } from '@/lib/auth';

// Get all boards for a user
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
    const boards = await Board.find({ userId: payload.userId })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    // Get user settings
    const settings = await UserSettings.findOne({ userId: payload.userId }).lean();

    return NextResponse.json({ 
      boards, 
      settings: settings || {
        customSwatches: ["#7dd3fc","#60a5fa","#a78bfa"],
        defaultBrushType: 'normal',
        defaultColor: "#2563eb",
        defaultWidth: 6
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Create a new board
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { name, strokes = [], shapes = [], backgroundImage = null, bgTransform = null } = await req.json();

    await dbConnect();
    
    // Get the next order number
    const lastBoard = await Board.findOne({ userId: payload.userId })
      .sort({ timestamp: -1 })
      .lean();
    const nextOrder = lastBoard ? 0 : 0; // Simple ordering for now

    const board = await Board.create({
      userId: payload.userId,
      name: name || `Board ${nextOrder + 1}`,
      strokes,
      shapes,
      backgroundImage,
      bgTransform: bgTransform || { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
      order: nextOrder
    });

    return NextResponse.json(board);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Update a board
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

    const { boardId, ...updateData } = await req.json();

    await dbConnect();
    const board = await Board.findOneAndUpdate(
      { _id: boardId, userId: payload.userId },
      updateData,
      { new: true }
    );

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 });
    }

    return NextResponse.json(board);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Delete a board
export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get('token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const boardId = searchParams.get('boardId');

    if (!boardId) {
      return NextResponse.json({ error: 'Board ID required' }, { status: 400 });
    }

    await dbConnect();
    const result = await Board.deleteOne({ _id: boardId, userId: payload.userId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Board deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
