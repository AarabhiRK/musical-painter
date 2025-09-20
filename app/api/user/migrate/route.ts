import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Board, UserSettings } from '@/models/Board';
import { verifyToken } from '@/lib/auth';

// Migrate localStorage data to database
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

    const { 
      boards = [], 
      userSwatches = [], 
      savedBoards = [],
      activeBoardId = null 
    } = await req.json();

    await dbConnect();

    // Check if user already has boards (prevent duplicate migration)
    const existingBoards = await Board.countDocuments({ userId: payload.userId });
    if (existingBoards > 0) {
      return NextResponse.json({ 
        message: 'User already has boards in database. Migration skipped.',
        boardsCount: existingBoards 
      });
    }

    // Migrate boards
    const migratedBoards = [];
    for (let i = 0; i < boards.length; i++) {
      const board = boards[i];
      const newBoard = await Board.create({
        userId: payload.userId,
        name: board.name || `Board ${i + 1}`,
        strokes: board.strokes || [],
        shapes: board.shapes || [],
        backgroundImage: board.backgroundImage || null,
        bgTransform: board.bgTransform || { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
        convertedMusic: board.convertedMusic || null,
        thumbnail: board.thumbnail || null,
        isActive: board.id === activeBoardId,
        order: i
      });
      migratedBoards.push(newBoard);
    }

    // Migrate user settings
    const settings = await UserSettings.findOneAndUpdate(
      { userId: payload.userId },
      {
        customSwatches: userSwatches.slice(0, 7) || ["#7dd3fc","#60a5fa","#a78bfa"],
        defaultBrushType: 'normal',
        defaultColor: "#2563eb",
        defaultWidth: 6
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      message: 'Migration completed successfully',
      migratedBoards: migratedBoards.length,
      settings: settings,
      activeBoardId: activeBoardId
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
