"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Stage, Layer, Line, Rect, Circle, Image as KonvaImage, Transformer } from "react-konva";
import AudioPlayer from 'react-h5-audio-player';
import 'react-h5-audio-player/lib/styles.css';

type Point = number;
type BrushType = 'normal' | 'rough' | 'thin' | 'highlighter' | 'spray' | 'marker';
type ShapeType = 'rectangle' | 'circle' | 'line' | 'triangle';
type Stroke = { 
  points: Point[]; 
  color: string; 
  width: number; 
  brushType: BrushType;
  opacity?: number;
  globalCompositeOperation?: "source-over" | "destination-out" 
};
type Shape = {
  type: ShapeType;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  width: number;
  opacity?: number;
  globalCompositeOperation?: "source-over" | "destination-out";
};

export default function Whiteboard() {
  // Board system - multiple tabs for different drawings
  type Board = {
    id: string;
    name: string;
    strokes: Stroke[];
    shapes: Shape[];
    backgroundImage: string | null;
    bgTransform: { x: number; y: number; width: number; height: number; rotation: number };
    convertedMusic: string | null;
    timestamp: string;
    thumb?: string | null;
  };
  
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>('');
  const [maxBoards] = useState(4);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  // Initialize with default board
  useEffect(() => {
    const defaultBoard: Board = {
      id: 'board-1',
      name: 'Board 1',
      strokes: [],
      shapes: [],
      backgroundImage: null,
      bgTransform: { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
      convertedMusic: null,
      timestamp: new Date().toISOString(),
    };
    
    // On mount, start with a fresh default board
    setBoards([defaultBoard]);
    setActiveBoardId(defaultBoard.id);
  }, []);

  // Save boards to localStorage whenever boards change
  useEffect(() => {
    try {
      // Persist savedBoards (gallery) but do NOT persist live 'boards' to ensure refresh clears them
      // Keep activeBoardId in storage only for UX within the session
      localStorage.setItem('activeBoardId', activeBoardId);
    } catch (e) {
      console.error('Failed to save boards to localStorage:', e);
    }
  }, [boards, activeBoardId]);

  // Get current active board - memoized to prevent infinite loops
  const activeBoard = useMemo(() => {
    return boards.find(board => board.id === activeBoardId) || boards[0];
  }, [boards, activeBoardId]);

  // Converted music analysis state - derived from active board
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState<'idle'|'analyzing'|'composing'|'done'|'cancelled'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Get converted music directly from active board
  const convertedMusic = activeBoard?.convertedMusic || null;
  // Download handler for the generated music
  const baseFileName = (boardId?: string) => {
    const id = boardId || activeBoard?.id || 'track';
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return `sketch-music-${id}-${ts}.mp3`;
  };

  const dataUrlToBlob = (dataUrl: string) => {
    const parts = dataUrl.split(',');
    const meta = parts[0];
    const isBase64 = /;base64$/.test(meta) || meta.includes(';base64');
    const contentTypeMatch = meta.match(/:(.*?);/);
    const contentType = contentTypeMatch ? contentTypeMatch[1] : 'audio/mpeg';
    const raw = parts[1] || '';
    if (isBase64) {
      const byteChars = atob(raw);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      return new Blob([byteArray], { type: contentType });
    }
    // Fallback for non-base64 data urls
    const blob = new Blob([decodeURIComponent(raw)], { type: contentType });
    return blob;
  };

  const handleDownloadConvertedMusic = async () => {
    if (!convertedMusic) return;
    try {
      let blob: Blob | null = null;
      if (convertedMusic.startsWith('data:')) {
        blob = dataUrlToBlob(convertedMusic);
      } else {
        // Fetch the resource as blob (may fail due to CORS if the resource disallows cross-origin requests)
        const resp = await fetch(convertedMusic);
        if (!resp.ok) throw new Error(`Failed to fetch audio: ${resp.status}`);
        blob = await resp.blob();
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = baseFileName(activeBoard?.id);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Download failed', e);
      setError((e && e.message) || 'Failed to download audio.');
    }
  };
  const [beatovenStatus, setBeatovenStatus] = useState<string | null>(null);
  const [beatovenTaskId, setBeatovenTaskId] = useState<string | null>(null);
  // promptPreview is intentionally not surfaced in UI; server logs to data/runs.json
  const abortCtrlRef = useRef<AbortController | null>(null);

  // Try Again functionality state
  const [showAdjustPopup, setShowAdjustPopup] = useState(false);
  const [adjustInstructions, setAdjustInstructions] = useState('');
  const [lastBeatovenPrompt, setLastBeatovenPrompt] = useState<string | null>(null);

  // Brush palettes
  const palettes: Record<string, string[]> = {
    Default: ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#7c3aed", "#111827"],
    Cinematic: ["#0f172a", "#1f2937", "#4b5563", "#ef4444", "#f97316", "#fbbf24"],
    Pastel: ["#ffd7e2", "#ffefc2", "#d9f7be", "#dbeafe", "#f3e8ff", "#ffedd5"],
    // 'Custom' is represented by userSwatches state
  };
  const [selectedPalette, setSelectedPalette] = useState<string>('Default');
  // User-custom swatches (up to 7) persisted to localStorage
  const [userSwatches, setUserSwatches] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('userSwatches');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setUserSwatches(parsed.slice(0, 7));
      } else {
        // default starter swatches
        setUserSwatches(["#7dd3fc","#60a5fa","#a78bfa"]);
      }
    } catch (e) {
      setUserSwatches(["#7dd3fc","#60a5fa","#a78bfa"]);
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('userSwatches', JSON.stringify(userSwatches.slice(0,7))); } catch (e) {}
  }, [userSwatches]);

  // Small helper to get current palette swatches
  const activeSwatches = selectedPalette === 'Custom' ? userSwatches : palettes[selectedPalette] || [];

  // Background image for the board (upload / drag & drop) - derived from active board
  const [bgImageObj, setBgImageObj] = useState<HTMLImageElement | null>(null);
  // Transform state for the uploaded image - derived from active board
  const [bgSelected, setBgSelected] = useState(false);
  const bgImageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const [moveMode, setMoveMode] = useState(false);

  // Get background image and transform directly from active board
  const backgroundImage = activeBoard?.backgroundImage || null;
  const bgTransform = activeBoard?.bgTransform || { x: 0, y: 0, width: 0, height: 0, rotation: 0 };

  // Gallery of saved boards stored in localStorage (no auth)
  type SavedBoard = { id: string; thumb: string; fullImage?: string; trackUrl?: string | null; timestamp: string };
  const [savedBoards, setSavedBoards] = useState<SavedBoard[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('savedBoards');
      if (raw) setSavedBoards(JSON.parse(raw));
    } catch (e) {
      setSavedBoards([]);
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('savedBoards', JSON.stringify(savedBoards || [])); } catch (e) {}
  }, [savedBoards]);

  // create HTMLImageElement when backgroundImage changes
  useEffect(() => {
    if (!backgroundImage) { setBgImageObj(null); return; }
    const img = new window.Image();
    img.src = backgroundImage;
    img.crossOrigin = 'anonymous';
    img.onload = () => setBgImageObj(img);
    img.onerror = () => setBgImageObj(null);
  }, [backgroundImage]);

  // Export and analyze function
  const analyzeDrawing = async () => {
    // Clear converted music from active board
    setBoards(prevBoards => 
      prevBoards.map(board => 
        board.id === activeBoardId 
          ? { ...board, convertedMusic: null }
          : board
      )
    );
    setError(null);
    setAnalyzing(true);
    setStage('analyzing');
    // abort any previous
    if (abortCtrlRef.current) {
      try { abortCtrlRef.current.abort(); } catch {}
    }
    const ac = new AbortController();
    abortCtrlRef.current = ac;
    try {
      // Render each board to image dataURL (uses stageRef for active board only). We'll create temporary canvases for other boards.
      const boardsPayload: Array<{ id: string; name?: string; imageBase64?: string; strokeCount?: number }> = [];

      // Helper to render a board: if it's the active board, use stageRef; otherwise create a temporary canvas and draw strokes/background
      const renderBoardToDataUrl = async (board: any) => {
        if (board.id === activeBoardId && stageRef.current) {
          const uri = stageRef.current.toDataURL({ pixelRatio: 2, mimeType: 'image/png' });
          return uri.replace(/^data:image\/png;base64,/, '');
        }

        // Create an offscreen canvas and try to draw board background + strokes similar to generateBoardThumbnail but larger
        const canvas = document.createElement('canvas');
        const w = Math.max(640, size.w);
        const h = Math.max(400, size.h);
        canvas.width = w * 2; // hi-res
        canvas.height = h * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw background image if available
        if (board.backgroundImage) {
          const img = new Image();
          img.src = board.backgroundImage;
          await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); });
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
          const dw = img.width * scale;
          const dh = img.height * scale;
          ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        }

        // Draw strokes scaled to canvas
        const strokes = board.strokes || [];
        strokes.forEach((s: any) => {
          if (!s || !s.points || s.points.length < 4) return;
          ctx.strokeStyle = s.color || '#000';
          ctx.lineWidth = (s.width || 4) * 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = s.opacity || 1;
          ctx.beginPath();
          const scaleX = (canvas.width / size.w) || 1;
          const scaleY = (canvas.height / size.h) || 1;
          ctx.moveTo(s.points[0] * scaleX, s.points[1] * scaleY);
          for (let i = 2; i < s.points.length; i += 2) {
            ctx.lineTo(s.points[i] * scaleX, s.points[i + 1] * scaleY);
          }
          ctx.stroke();
        });

        return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      };

      // Build payload for all boards
      for (const board of boards) {
        try {
          const base64 = await renderBoardToDataUrl(board);
          boardsPayload.push({ id: board.id, name: board.name, imageBase64: base64, strokeCount: (board.strokes || []).length });
        } catch (e) {
          boardsPayload.push({ id: board.id, name: board.name, imageBase64: undefined, strokeCount: (board.strokes || []).length });
        }
      }

      const res = await fetch('/api/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boards: boardsPayload, totalDuration: 60 }),
        signal: ac.signal,
      });

      const data = await res.json();

      if (data?.trackUrl) {
        // Attach trackUrl to all valid boards returned in perBoardResults
        const validIds = (data.perBoardResults || []).filter((r: any) => !r.error).map((r: any) => r.id);
        setBoards(prevBoards => prevBoards.map(board => {
          if (validIds.includes(board.id)) return { ...board, convertedMusic: data.trackUrl };
          return board;
        }));
        setBeatovenStatus(data?.beatovenMeta?.status || 'composed');
        setBeatovenTaskId(data?.task_id || null);
        setLastBeatovenPrompt(data?.beatovenPrompt || null); // Store the prompt for adjustments
        setStage('done');
      } else if (data?.task_id) {
        setBeatovenTaskId(data?.task_id || null);
        setBeatovenStatus(data?.beatovenMeta?.status || null);
        setStage('composing');
      } else if (data?.error) {
        setError(data.error || 'Server error');
      } else {
        setError('No usable response from server');
      }

    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError('Analysis cancelled');
        setStage('cancelled');
      } else {
        setError(e.message || 'Failed to analyze.');
      }
    } finally {
      setAnalyzing(false);
      abortCtrlRef.current = null;
    }
  };

  const cancelAnalyze = useCallback(() => {
    if (abortCtrlRef.current) {
      try { abortCtrlRef.current.abort(); } catch {};
      setAnalyzing(false);
      setBeatovenStatus('cancelled');
      setStage('cancelled');
    }
  }, []);

  // Try Again functionality
  const tryAgain = useCallback(async () => {
    if (!lastBeatovenPrompt) {
      // Fallback to full analysis if no previous prompt
      await analyzeDrawing();
      return;
    }

    // Clear current music and start composing with same prompt
    setBoards(prevBoards => 
      prevBoards.map(board => 
        board.id === activeBoardId 
          ? { ...board, convertedMusic: null }
          : board
      )
    );
    setError(null);
    setAnalyzing(true);
    setStage('composing');

    try {
      const res = await fetch('/api/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          boards: [], // Empty boards array for retry
          totalDuration: 60,
          retryMode: true,
          beatovenPrompt: lastBeatovenPrompt
        }),
      });

      const data = await res.json();

      if (data?.trackUrl) {
        setBoards(prevBoards => prevBoards.map(board => {
          if (board.id === activeBoardId) return { ...board, convertedMusic: data.trackUrl };
          return board;
        }));
        setBeatovenStatus(data?.beatovenMeta?.status || 'composed');
        setBeatovenTaskId(data?.task_id || null);
        setStage('done');
      } else if (data?.error) {
        setError(data.error || 'Retry failed');
      } else {
        setError('No usable response from server');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to retry music generation.');
    } finally {
      setAnalyzing(false);
    }
  }, [lastBeatovenPrompt, activeBoardId, analyzeDrawing]);

  const adjustMusic = useCallback(async () => {
    if (!lastBeatovenPrompt || !adjustInstructions.trim()) {
      setError('Please provide adjustment instructions');
      return;
    }

    // Clear current music and start composing with modified prompt
    setBoards(prevBoards => 
      prevBoards.map(board => 
        board.id === activeBoardId 
          ? { ...board, convertedMusic: null }
          : board
      )
    );
    setError(null);
    setAnalyzing(true);
    setStage('composing');
    setShowAdjustPopup(false);

    try {
      const res = await fetch('/api/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          boards: [], // Empty boards array for adjustment
          totalDuration: 60,
          adjustMode: true,
          beatovenPrompt: lastBeatovenPrompt,
          adjustInstructions: adjustInstructions.trim()
        }),
      });

      const data = await res.json();

      if (data?.trackUrl) {
        setBoards(prevBoards => prevBoards.map(board => {
          if (board.id === activeBoardId) return { ...board, convertedMusic: data.trackUrl };
          return board;
        }));
        setBeatovenStatus(data?.beatovenMeta?.status || 'composed');
        setBeatovenTaskId(data?.task_id || null);
        setLastBeatovenPrompt(data?.beatovenPrompt || lastBeatovenPrompt);
        setStage('done');
      } else if (data?.error) {
        setError(data.error || 'Adjustment failed');
      } else {
        setError('No usable response from server');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to adjust music generation.');
    } finally {
      setAnalyzing(false);
      setAdjustInstructions('');
    }
  }, [lastBeatovenPrompt, adjustInstructions, activeBoardId]);

  // Drawing state - derived from active board
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [color, setColor] = useState("#2563eb");
  const [width, setWidth] = useState(6);
  const [brushType, setBrushType] = useState<BrushType>('normal');
  const [erasing, setErasing] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);
  
  // Shape tool state
  const [toolMode, setToolMode] = useState<'draw' | 'shape'>('draw');
  const [selectedShape, setSelectedShape] = useState<ShapeType>('rectangle');
  const [currentShape, setCurrentShape] = useState<Shape | null>(null);
  const [isDrawingShape, setIsDrawingShape] = useState(false);
  
  
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });

  // Get strokes and shapes directly from active board
  const strokes = activeBoard?.strokes || [];
  const shapes = activeBoard?.shapes || [];
  
  // Undo/Redo state management
  const [history, setHistory] = useState<{strokes: Stroke[], shapes: Shape[]}[]>([{strokes: [], shapes: []}]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Brush properties helper functions
  const getBrushProperties = (type: BrushType, baseWidth: number) => {
    switch (type) {
      case 'spray':
        return {
          width: Math.max(2, baseWidth),
          opacity: 0.6,
          tension: 0.2,
          lineCap: 'round' as const,
          lineJoin: 'round' as const,
        };
      case 'marker':
        return {
          width: baseWidth * 1.6,
          opacity: 0.55,
          tension: 0.25,
          lineCap: 'round' as const,
          lineJoin: 'round' as const,
        };
      case 'rough':
        return {
          width: baseWidth * 1.2,
          opacity: 0.8,
          tension: 0.1,
          lineCap: 'round' as const,
          lineJoin: 'round' as const,
        };
      case 'thin':
        return {
          width: Math.max(1, baseWidth * 0.5),
          opacity: 1,
          tension: 0.5,
          lineCap: 'round' as const,
          lineJoin: 'round' as const,
        };
      case 'highlighter':
        return {
          width: baseWidth * 2,
          opacity: 0.4,
          tension: 0.3,
          lineCap: 'square' as const,
          lineJoin: 'round' as const,
        };
      default: // normal
        return {
          width: baseWidth,
          opacity: 1,
          tension: 0.3,
          lineCap: 'round' as const,
          lineJoin: 'round' as const,
        };
    }
  };

  // Resize Stage to container
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = Math.max(420, Math.round(w * 0.6));
      setSize({ w, h });
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // initialize bgTransform when image loads and size is known
  useEffect(() => {
    if (!bgImageObj || !size) return;
    const iw = bgImageObj.width;
    const ih = bgImageObj.height;
    const cw = size.w;
    const ch = size.h;
    const scale = Math.min(cw / iw, ch / ih);
    const w = iw * scale;
    const h = ih * scale;
    const newTransform = { x: (cw - w) / 2, y: (ch - h) / 2, width: w, height: h, rotation: 0 };
    
    // Update the active board directly
    setBoards(prevBoards => 
      prevBoards.map(board => 
        board.id === activeBoardId 
          ? { ...board, bgTransform: newTransform }
          : board
      )
    );
  }, [bgImageObj, size, activeBoardId]);

  // When bgSelected changes, attach the transformer to the selected node
  useEffect(() => {
    const tr = transformerRef.current;
    const node = bgImageRef.current;
    if (tr && node) {
      if (bgSelected) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
      } else {
        tr.nodes([]);
        tr.getLayer()?.batchDraw();
      }
    }
  }, [bgSelected]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);


  // Cleanup Konva Stage on unmount
  useEffect(() => {
    return () => {
      if (stageRef.current) {
        stageRef.current.destroy();
      }
    };
  }, []);

  const onDown = useCallback((e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    
    if (toolMode === 'shape') {
      // Start drawing a shape
      const effectiveColor = erasing ? '#ffffff' : color;
      const newShape: Shape = {
        type: selectedShape,
        startX: pos.x,
        startY: pos.y,
        endX: pos.x,
        endY: pos.y,
        color: effectiveColor,
        width: width,
        opacity: 1,
        globalCompositeOperation: 'source-over',
      };
      setCurrentShape(newShape);
      setIsDrawingShape(true);
      setIsMouseDown(true);
    } else {
      // Regular drawing mode
      const effectiveBrushType: BrushType = erasing ? 'normal' : brushType;
      const effectiveColor = erasing ? '#ffffff' : color;
      const brushProps = getBrushProperties(effectiveBrushType, width);
      const s: Stroke = {
        points: [pos.x, pos.y],
        color: effectiveColor,
        width: brushProps.width,
        brushType: effectiveBrushType,
        opacity: brushProps.opacity,
        globalCompositeOperation: 'source-over',
      };
      setCurrent(s);
      setIsMouseDown(true);
    }
  }, [toolMode, selectedShape, brushType, width, color, erasing]);

  const onMove = useCallback((e: any) => {
    if (!isMouseDown) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    
    if (toolMode === 'shape' && isDrawingShape && currentShape) {
      // Update shape dimensions
      setCurrentShape({
        ...currentShape,
        endX: point.x,
        endY: point.y,
      });
    } else if (toolMode === 'draw' && current) {
      // Regular drawing mode
      const isWithinBounds = point.x >= 0 && point.x <= size.w && point.y >= 0 && point.y <= size.h;
      
      if (isWithinBounds) {
        setCurrent({
          ...current,
          points: current.points.concat([point.x, point.y]),
        });
      }
    }
  }, [isMouseDown, toolMode, isDrawingShape, currentShape, current, size.w, size.h]);

  const onUp = useCallback(() => {
    if (toolMode === 'shape' && isDrawingShape && currentShape) {
      // Finish drawing a shape
      const newShapes = [...shapes, currentShape];
      
      // Update the active board directly
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === activeBoardId 
            ? { ...board, shapes: newShapes }
            : board
        )
      );
      setCurrentShape(null);
      setIsDrawingShape(false);
      setIsMouseDown(false);
      
      // Add to history for undo/redo
      addToHistory({strokes, shapes: newShapes});
    } else if (toolMode === 'draw' && current) {
      // Regular drawing mode
      const newStrokes = [...strokes, current];
      
      // Update the active board directly
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === activeBoardId 
            ? { ...board, strokes: newStrokes }
            : board
        )
      );
      setCurrent(null);
      setIsMouseDown(false);
      
      // Add to history for undo/redo
      addToHistory({strokes: newStrokes, shapes});
    }
  }, [toolMode, isDrawingShape, currentShape, current, strokes, shapes, activeBoardId]);

  // Add to history
  const addToHistory = useCallback((newState: {strokes: Stroke[], shapes: Shape[]}) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  // Global mouse up listener to handle mouse release outside whiteboard
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (toolMode === 'shape' && isDrawingShape && currentShape) {
        const newShapes = [...shapes, currentShape];
        
        // Update the active board directly
        setBoards(prevBoards => 
          prevBoards.map(board => 
            board.id === activeBoardId 
              ? { ...board, shapes: newShapes }
              : board
          )
        );
        setCurrentShape(null);
        setIsDrawingShape(false);
        setIsMouseDown(false);
        
        // Add to history for undo/redo
        addToHistory({strokes, shapes: newShapes});
      } else if (toolMode === 'draw' && current && isMouseDown) {
        const newStrokes = [...strokes, current];
        
        // Update the active board directly
        setBoards(prevBoards => 
          prevBoards.map(board => 
            board.id === activeBoardId 
              ? { ...board, strokes: newStrokes }
              : board
          )
        );
        setCurrent(null);
        setIsMouseDown(false);
        
        // Add to history for undo/redo
        addToHistory({strokes: newStrokes, shapes});
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [toolMode, isDrawingShape, currentShape, current, isMouseDown, strokes, shapes, activeBoardId, addToHistory]);

  // Undo function
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const newState = history[newIndex];
      setHistoryIndex(newIndex);
      
      // Update the active board directly
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === activeBoardId 
            ? { ...board, strokes: newState.strokes, shapes: newState.shapes }
            : board
        )
      );
    }
  }, [historyIndex, history, activeBoardId]);

  // Redo function
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const newState = history[newIndex];
      setHistoryIndex(newIndex);
      
      // Update the active board directly
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === activeBoardId 
            ? { ...board, strokes: newState.strokes, shapes: newState.shapes }
            : board
        )
      );
    }
  }, [historyIndex, history, activeBoardId]);

  const clear = useCallback(() => {
    // Update the active board directly
    setBoards(prevBoards => 
      prevBoards.map(board => 
        board.id === activeBoardId 
          ? { ...board, strokes: [], shapes: [] }
          : board
      )
    );
    addToHistory({strokes: [], shapes: []});
  }, [addToHistory, activeBoardId]);

  const exportPNG = useCallback(() => {
    if (!stageRef.current) return;
    const uri = stageRef.current.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
    // Download now; later you'll POST this to /api/analyze
    const a = document.createElement("a");
    a.href = uri;
    a.download = "drawing.png";
    a.click();
  }, []);

  // Download music helper
  const downloadMusic = useCallback(() => {
    if (!convertedMusic) return;
    const a = document.createElement('a');
    a.href = convertedMusic;
    a.download = 'composition.mp3';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [convertedMusic]);

  // Upload / Drag & Drop handlers
  const handleFile = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      // Update the active board directly
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === activeBoardId 
            ? { ...board, backgroundImage: data }
            : board
        )
      );
    };
    reader.readAsDataURL(file);
  }, [activeBoardId]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Save current board (thumbnail + track) to gallery
  const saveBoardToGallery = useCallback(async () => {
    if (!stageRef.current) return;
    // thumbnail small
    const thumb = stageRef.current.toDataURL({ pixelRatio: 0.5 });
    const full = stageRef.current.toDataURL({ pixelRatio: 2 });
    const entry: SavedBoard = {
      id: `${Date.now()}-${Math.round(Math.random()*999)}`,
      thumb,
      fullImage: full,
      trackUrl: convertedMusic || null,
      timestamp: new Date().toISOString(),
    };
    setSavedBoards((s) => [entry, ...s].slice(0, 200));
  }, [convertedMusic]);

  const loadBoard = useCallback((entry: SavedBoard) => {
    if (entry.fullImage) {
      // Update the active board directly
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === activeBoardId 
            ? { ...board, backgroundImage: entry.fullImage || null }
            : board
        )
      );
    }
    if (entry.trackUrl) {
      // Update the active board directly
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === activeBoardId 
            ? { ...board, convertedMusic: entry.trackUrl || null }
            : board
        )
      );
    }
  }, [activeBoardId]);

  const deleteBoard = useCallback((id: string) => {
    setSavedBoards((s) => s.filter((x) => x.id !== id));
  }, []);

  // Board management functions
  const createNewBoard = useCallback(() => {
    if (boards.length >= maxBoards) return;
    
    // Find the highest existing board number and increment from there
    const existingNumbers = boards.map(board => {
      const match = board.name.match(/Board (\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });
    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
    
    const newBoardId = `board-${Date.now()}`;
    const newBoard: Board = {
      id: newBoardId,
      name: `Board ${nextNumber}`,
      strokes: [],
      shapes: [],
      backgroundImage: null,
      bgTransform: { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
      convertedMusic: null,
      timestamp: new Date().toISOString(),
    };
    
    setBoards(prevBoards => [...prevBoards, newBoard]);
    setActiveBoardId(newBoardId);
  }, [boards.length, maxBoards, boards]);

  const switchToBoard = useCallback((boardId: string) => {
    setActiveBoardId(boardId);
    setBgSelected(false); // Clear any selected background when switching
  }, []);

  const deleteBoardTab = useCallback((boardId: string) => {
    if (boards.length <= 1) return; // Don't delete the last board
    
    setBoards(prevBoards => prevBoards.filter(board => board.id !== boardId));
    
    // If we deleted the active board, switch to the first remaining board
    if (activeBoardId === boardId) {
      const remainingBoards = boards.filter(board => board.id !== boardId);
      if (remainingBoards.length > 0) {
        setActiveBoardId(remainingBoards[0].id);
      }
    }
  }, [boards, activeBoardId]);

  const startRenamingBoard = useCallback((boardId: string, currentName: string) => {
    setEditingBoardId(boardId);
    setEditingName(currentName);
  }, []);

  const finishRenamingBoard = useCallback(() => {
    if (editingBoardId && editingName.trim()) {
      setBoards(prevBoards => 
        prevBoards.map(board => 
          board.id === editingBoardId 
            ? { ...board, name: editingName.trim() }
            : board
        )
      );
    }
    setEditingBoardId(null);
    setEditingName('');
  }, [editingBoardId, editingName]);

  const cancelRenamingBoard = useCallback(() => {
    setEditingBoardId(null);
    setEditingName('');
  }, []);

  // Generate thumbnail for a board
  // We'll generate thumbnails asynchronously whenever boards change and store them on each board as `thumb`.
  const generateThumbnailForBoard = useCallback(async (board: Board) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128; // slightly larger for better quality when scaled
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw background image synchronously if possible (await load)
    if (board.backgroundImage) {
      await new Promise<void>((res) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
          res();
        };
        img.onerror = () => res();
        img.src = board.backgroundImage || '';
      });
    }

    // Draw strokes scaled to thumbnail
    const strokes = board.strokes || [];
    strokes.forEach((s: any) => {
      if (!s || !s.points || s.points.length < 4) return;
      ctx.strokeStyle = s.color || '#000';
      ctx.lineWidth = Math.max(0.6, (s.width || 4) * 0.12);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = s.opacity ?? 1;
      ctx.beginPath();
      // scale factor: assume original stage size is available in `size`
      const scaleX = (canvas.width / Math.max(1, size.w)) || 1;
      const scaleY = (canvas.height / Math.max(1, size.h)) || 1;
      ctx.moveTo((s.points[0] || 0) * scaleX, (s.points[1] || 0) * scaleY);
      for (let i = 2; i < s.points.length; i += 2) {
        ctx.lineTo((s.points[i] || 0) * scaleX, (s.points[i + 1] || 0) * scaleY);
      }
      ctx.stroke();
    });

    return canvas.toDataURL('image/png');
  }, [size.w, size.h]);

  // Whenever boards or size change, regenerate thumbnails and store them on the board state (debounced-ish via effect)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < boards.length; i++) {
        const b = boards[i];
        try {
          const thumb = await generateThumbnailForBoard(b);
          if (cancelled) return;
          if (thumb && thumb !== b.thumb) {
            setBoards(prev => prev.map(p => p.id === b.id ? { ...p, thumb } : p));
          }
        } catch (e) {}
      }
    })();
    return () => { cancelled = true; };
  }, [boards, size.w, size.h, generateThumbnailForBoard]);

  // Helper function to render a shape
  const renderShape = useCallback((shape: Shape, key: string, index?: number) => {
    const { type, startX, startY, endX, endY, color, width, opacity, globalCompositeOperation } = shape;
    
    switch (type) {
      case 'rectangle':
        return (
          <Rect
              key={key}
              x={Math.min(startX, endX)}
              y={Math.min(startY, endY)}
              width={Math.abs(endX - startX)}
              height={Math.abs(endY - startY)}
              stroke={color}
              strokeWidth={width}
              opacity={opacity || 1}
              globalCompositeOperation={globalCompositeOperation}
              onClick={(e) => { if (typeof index === 'number') handleShapeClick(index, e); }}
            />
        );
      case 'circle':
        // Calculate center and radius for corner-to-corner circle (like rectangle)
        const centerX = (startX + endX) / 2;
        const centerY = (startY + endY) / 2;
        const radius = Math.min(Math.abs(endX - startX), Math.abs(endY - startY)) / 2;
        return (
          <Circle
            key={key}
            x={centerX}
            y={centerY}
            radius={radius}
            stroke={color}
            strokeWidth={width}
            opacity={opacity || 1}
            globalCompositeOperation={globalCompositeOperation}
            onClick={(e) => { if (typeof index === 'number') handleShapeClick(index, e); }}
          />
        );
      case 'line':
        return (
          <Line
            key={key}
            points={[startX, startY, endX, endY]}
            stroke={color}
            strokeWidth={width}
            opacity={opacity || 1}
            globalCompositeOperation={globalCompositeOperation}
            onClick={(e) => { if (typeof index === 'number') handleShapeClick(index, e); }}
          />
        );
      case 'triangle':
        const midX = (startX + endX) / 2;
        return (
          <Line
            key={key}
            points={[startX, endY, midX, startY, endX, endY, startX, endY]}
            stroke={color}
            strokeWidth={width}
            opacity={opacity || 1}
            globalCompositeOperation={globalCompositeOperation}
            closed={true}
            onClick={(e) => { if (typeof index === 'number') handleShapeClick(index, e); }}
          />
        );
      default:
        return null;
    }
  }, []);

  // Memoize shape rendering for better performance
  const renderedShapes = useMemo(() => {
    return shapes.map((shape, i) => renderShape(shape, `shape-${i}`, i));
  }, [shapes, renderShape]);

  // Handle clicks on shapes: fill when fillMode, delete when erasing is active and erasing should remove full shape
  const handleShapeClick = useCallback((index: number, e: any) => {
    // prevent stage from starting a new stroke when clicking shapes
    e.cancelBubble = true;
    e.evt?.stopImmediatePropagation?.();
    const shape = shapes[index];
    if (!shape) return;

    // No fill handling — shapes are not filled in this version

    // If erasing and toolMode is shape, delete the whole shape
    if (erasing && toolMode === 'shape') {
      const newShapes = shapes.slice();
      newShapes.splice(index, 1);
      setBoards(prev => prev.map(b => b.id === activeBoardId ? { ...b, shapes: newShapes } : b));
      addToHistory({ strokes, shapes: newShapes });
      return;
    }

    // otherwise, do nothing special
  }, [shapes, color, addToHistory, activeBoardId, erasing, toolMode, strokes]);

  // Memoize stroke rendering for better performance
  const renderedStrokes = useMemo(() => {
    // For rough brush strokes, render several jittered copies to simulate a rough stroke
    return strokes.flatMap((s, i) => {
      const brushProps = getBrushProperties(s.brushType, s.width);
      if (s.brushType === 'rough') {
        // number of jittered lines (2-5)
        const copies = Math.min(5, Math.max(2, Math.round(s.width / 3)));
        // small offset range based on width
        const offsetRange = Math.max(1, s.width * 0.6);
        return Array.from({ length: copies }).map((_, ci) => {
          const jittered = s.points.map((val: number, idx: number) => {
            // apply jitter to x (even indices) and y (odd indices)
            if (idx % 2 === 0) return val + (Math.random() * 2 - 1) * offsetRange;
            return val + (Math.random() * 2 - 1) * offsetRange;
          });
          // vary width/opacity slightly per copy for texture
          const w = Math.max(1, brushProps.width * (0.9 + Math.random() * 0.3));
          const op = Math.max(0.4, Math.min(1, brushProps.opacity! * (0.8 + Math.random() * 0.4)));
          return (
            <Line
              key={`${i}-rough-${ci}`}
              points={jittered}
              stroke={s.color}
              strokeWidth={w}
              opacity={op}
              tension={brushProps.tension}
              lineCap={brushProps.lineCap}
              lineJoin={brushProps.lineJoin}
              globalCompositeOperation={s.globalCompositeOperation}
            />
          );
        });
      }
      // Spray brush: render small scattered dots along the path
      if (s.brushType === 'spray') {
        // density related to width
        const density = Math.min(6, Math.max(2, Math.round(s.width / 2)));
        const dots: any[] = [];
        for (let p = 0; p < s.points.length; p += 2) {
          const x = s.points[p];
          const y = s.points[p + 1];
          for (let d = 0; d < density; d++) {
            const rx = x + (Math.random() * 2 - 1) * s.width * 0.7;
            const ry = y + (Math.random() * 2 - 1) * s.width * 0.7;
            const r = Math.max(1, Math.random() * (brushProps.width / 2));
            dots.push(
              <Line
                key={`${i}-spray-${p}-${d}`}
                points={[rx, ry, rx + 0.01, ry + 0.01]}
                stroke={s.color}
                strokeWidth={r}
                opacity={Math.max(0.15, brushProps.opacity! * Math.random())}
                tension={0}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={s.globalCompositeOperation}
              />
            );
          }
        }
        return dots;
      }

      // Marker brush: render the main line plus a few faded wider backups to simulate soft edge
      if (s.brushType === 'marker') {
        const backups = [0, 1, 2].map((bi) => {
          const mult = 1 + bi * 0.5;
          return (
            <Line
              key={`${i}-marker-${bi}`}
              points={s.points}
              stroke={s.color}
              strokeWidth={brushProps.width * mult}
              opacity={Math.max(0.12, brushProps.opacity! * (0.7 - bi * 0.25))}
              tension={brushProps.tension}
              lineCap={brushProps.lineCap}
              lineJoin={brushProps.lineJoin}
              globalCompositeOperation={s.globalCompositeOperation}
            />
          );
        });
        return backups;
      }

      return (
        <Line
          key={i}
          points={s.points}
          stroke={s.color}
          strokeWidth={brushProps.width}
          opacity={brushProps.opacity}
          tension={brushProps.tension}
          lineCap={brushProps.lineCap}
          lineJoin={brushProps.lineJoin}
          globalCompositeOperation={s.globalCompositeOperation}
        />
      );
    });
  }, [strokes]);

  // Memoize current stroke rendering
  const renderedCurrentStroke = useMemo(() => {
    if (!current) return null;
    const brushProps = getBrushProperties(current.brushType, current.width);
    if (current.brushType === 'rough') {
      const copies = Math.min(5, Math.max(2, Math.round(current.width / 3)));
      const offsetRange = Math.max(1, current.width * 0.6);
      return (
        <>
          {Array.from({ length: copies }).map((_, ci) => {
            const jittered = current.points.map((val, idx) => {
              if (idx % 2 === 0) return val + (Math.random() * 2 - 1) * offsetRange;
              return val + (Math.random() * 2 - 1) * offsetRange;
            });
            const w = Math.max(1, brushProps.width * (0.9 + Math.random() * 0.3));
            const op = Math.max(0.4, Math.min(1, brushProps.opacity! * (0.8 + Math.random() * 0.4)));
            return (
              <Line
                key={`current-rough-${ci}`}
                points={jittered}
                stroke={current.color}
                strokeWidth={w}
                opacity={op}
                tension={brushProps.tension}
                lineCap={brushProps.lineCap}
                lineJoin={brushProps.lineJoin}
                globalCompositeOperation={current.globalCompositeOperation}
              />
            );
          })}
        </>
      );
    }

    if (current.brushType === 'spray') {
      const density = Math.min(6, Math.max(2, Math.round(current.width / 2)));
      return (
        <>
          {current.points.map((val, idx) => {
            if (idx % 2 === 1) return null;
            const x = current.points[idx];
            const y = current.points[idx + 1];
            return Array.from({ length: density }).map((_, di) => {
              const rx = x + (Math.random() * 2 - 1) * current.width * 0.7;
              const ry = y + (Math.random() * 2 - 1) * current.width * 0.7;
              const r = Math.max(1, Math.random() * (brushProps.width / 2));
              return (
                <Line
                  key={`current-spray-${idx}-${di}`}
                  points={[rx, ry, rx + 0.01, ry + 0.01]}
                  stroke={current.color}
                  strokeWidth={r}
                  opacity={Math.max(0.15, brushProps.opacity! * Math.random())}
                  tension={0}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={current.globalCompositeOperation}
                />
              );
            });
          })}
        </>
      );
    }

    if (current.brushType === 'marker') {
      return (
        <>
          {[0, 1, 2].map((bi) => (
            <Line
              key={`current-marker-${bi}`}
              points={current.points}
              stroke={current.color}
              strokeWidth={brushProps.width * (1 + bi * 0.5)}
              opacity={Math.max(0.12, brushProps.opacity! * (0.7 - bi * 0.25))}
              tension={brushProps.tension}
              lineCap={brushProps.lineCap}
              lineJoin={brushProps.lineJoin}
              globalCompositeOperation={current.globalCompositeOperation}
            />
          ))}
        </>
      );
    }

    return (
      <Line
        points={current.points}
        stroke={current.color}
        strokeWidth={brushProps.width}
        opacity={brushProps.opacity}
        tension={brushProps.tension}
        lineCap={brushProps.lineCap}
        lineJoin={brushProps.lineJoin}
        globalCompositeOperation={current.globalCompositeOperation}
      />
    );
  }, [current]);

  // Memoize current shape preview rendering
  const renderedCurrentShape = useMemo(() => {
    if (!currentShape || !isDrawingShape) return null;
    return renderShape(currentShape, 'current-shape');
  }, [currentShape, isDrawingShape, renderShape]);

  // Check if stroke requirements are met for music generation
  const canGenerateMusic = useMemo(() => {
    if (boards.length === 0) return false;
    
    // Check if all boards meet the requirement (5+ strokes or uploaded image)
    const validBoards = boards.filter(board => 
      (board.backgroundImage && board.backgroundImage.length > 100) || 
      (board.strokes && board.strokes.length >= 5)
    );
    
    // For multiple boards, all must be valid. For single board, just one needs to be valid.
    return boards.length === 1 ? validBoards.length > 0 : validBoards.length === boards.length;
  }, [boards]);

  // Get stroke count info for UI feedback
  const strokeCountInfo = useMemo(() => {
    return boards.map(board => ({
      id: board.id,
      name: board.name,
      strokeCount: board.strokes ? board.strokes.length : 0,
      hasImage: board.backgroundImage && board.backgroundImage.length > 100,
      isValid: (board.backgroundImage && board.backgroundImage.length > 100) || (board.strokes && board.strokes.length >= 5)
    }));
  }, [boards]);
  
  return (
    <div className="w-full max-w-7xl mx-auto">
      <style>{`
        @keyframes pulse-slower { 0% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.05); opacity: 0.9 } 100% { transform: scale(1); opacity: 1 } }
        .animate-pulse-slower { animation: pulse-slower 2.8s ease-in-out infinite; }
        @keyframes spin-slow { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .animate-spin-slow { animation: spin-slow 3s linear infinite; }
        @keyframes loading-bar { 0% { transform: translateX(-100%);} 50% { transform: translateX(-20%);} 100% { transform: translateX(100%);} }
        .animate-loading-bar { animation: loading-bar 2.2s linear infinite; }
        .animate-loading-bar-slow { animation: loading-bar 4s linear infinite; }
      `}</style>
      
      {/* Board Tabs */}
      <div className="bg-white border border-gray-200 rounded-t-2xl shadow-sm">
        <div className="flex items-center justify-center px-6 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {boards.map((board) => (
              <div
                key={board.id}
                className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 min-w-[120px] ${
                  activeBoardId === board.id
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`}
                onClick={() => switchToBoard(board.id)}
              >
                {/* Thumbnail Preview */}
                <div className="w-16 h-12 bg-gray-100 rounded border border-gray-200 overflow-hidden flex items-center justify-center">
                  {board.thumb ? (
                    <img src={board.thumb} alt={`${board.name} preview`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-gray-400 text-xs">Empty</div>
                  )}
                </div>
                
                {/* Board Name */}
                <div className="flex items-center justify-center gap-1">
                  {editingBoardId === board.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={finishRenamingBoard}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRenamingBoard();
                        if (e.key === 'Escape') cancelRenamingBoard();
                      }}
                      className="text-xs font-medium bg-transparent border-none outline-none text-center min-w-[60px] max-w-[100px]"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span 
                        className="text-xs font-medium text-center"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startRenamingBoard(board.id, board.name);
                        }}
                      >
                        {board.name}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startRenamingBoard(board.id, board.name);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 transition-all"
                        title="Rename board"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                
                {/* Close Button */}
                {boards.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBoardTab(board.id);
                    }}
                    className="absolute -top-1 -right-1 p-1 rounded-full bg-white border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm"
                    title="Close board"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            
            {/* Add New Board Button */}
            {boards.length < maxBoards && (
              <button
                onClick={createNewBoard}
                className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all duration-200 border border-dashed border-gray-300 min-w-[120px]"
                title="Add new board"
              >
                <div className="w-16 h-12 bg-gray-50 rounded border border-dashed border-gray-300 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <span className="text-xs font-medium">New Board</span>
              </button>
            )}
          </div>
        </div>
        
        {/* Board Counter */}
        <div className="flex justify-center pb-2">
          <div className="text-xs text-gray-500 bg-gray-50 px-3 py-1 rounded-full">
            {boards.length} / {maxBoards} boards
          </div>
        </div>
      </div>
      
      {/* Toolbar */}
      <div className="bg-white border-l border-r border-b border-gray-200 rounded-b-2xl p-6 mb-8 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
                <span className="text-gray-600">Color</span>
                <input 
                  type="color" 
                  value={color} 
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-10 rounded-xl border-2 border-gray-200 cursor-pointer hover:border-gray-300 transition-colors"
                />
              </label>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={selectedPalette}
                  onChange={(e) => setSelectedPalette(e.target.value)}
                  className="text-xs rounded-md border px-2 py-1"
                >
                  {Object.keys(palettes).concat(['Custom']).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  {/* Non-custom palettes: simple swatch buttons */}
                  {selectedPalette !== 'Custom' && activeSwatches.map((c, i) => (
                    <button
                      key={`${c}-${i}`}
                      onClick={() => setColor(c)}
                      aria-label={`Select color ${c}`}
                      style={{ background: c }}
                      className="w-6 h-6 rounded-md border border-gray-200"
                    />
                  ))}

                  {/* Custom palette: show editable color inputs inline (single row) */}
                  {selectedPalette === 'Custom' && (
                    <>
                      {userSwatches.map((c, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <input
                            type="color"
                            value={c}
                            onChange={(e) => {
                              const copy = [...userSwatches];
                              copy[i] = e.target.value;
                              setUserSwatches(copy.slice(0, 7));
                              // immediately set brush color to the chosen value
                              setColor(e.target.value);
                            }}
                            onMouseDown={() => setColor(c)}
                            className="w-6 h-6 p-0 border rounded-md cursor-pointer"
                            title={`Swatch ${i + 1}`}
                          />
                          <button
                            onClick={() => setUserSwatches(userSwatches.filter((_, idx) => idx !== i))}
                            className="text-xs text-red-500"
                            aria-label={`Remove swatch ${i + 1}`}
                          >
                            x
                          </button>
                        </div>
                      ))}

                      <button
                        onClick={() => {
                          if (userSwatches.length >= 7) return;
                          const next = [...userSwatches, '#ffffff'].slice(0, 7);
                          setUserSwatches(next);
                          // select the newly added swatch as brush color
                          setColor('#ffffff');
                        }}
                        disabled={userSwatches.length >= 7}
                        className={`w-6 h-6 rounded-md border border-dashed flex items-center justify-center text-xs ${userSwatches.length >= 7 ? 'text-gray-300 border-gray-100 cursor-not-allowed bg-gray-50' : 'text-gray-500'}`}
                        title="Add swatch (max 7)"
                      >
                        +
                      </button>
                    </>
                  )}
                </div>
              </div>
              {/* custom swatches are rendered inline above; no duplicate inputs here */}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
              <span className="text-gray-600">Tool</span>
              <select
                value={toolMode}
                onChange={(e) => setToolMode(e.target.value as 'draw' | 'shape')}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200"
              >
                <option value="draw">Draw</option>
                <option value="shape">Shapes</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
              <span className="text-gray-600">Width</span>
              <input
                type="range"
                min={1}
                max={32}
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value))}
                className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-gray-500 min-w-[35px] font-mono">{width}px</span>
            </label>
          </div>

          {toolMode === 'draw' && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
                <span className="text-gray-600">Brush</span>
                <select
                  value={brushType}
                  onChange={(e) => setBrushType(e.target.value as BrushType)}
                  className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200"
                >
                  <option value="normal">Normal</option>
                  <option value="rough">Rough</option>
                  <option value="spray">Spray</option>
                  <option value="marker">Marker</option>
                  <option value="thin">Thin</option>
                  <option value="highlighter">Highlighter</option>
                </select>
              </label>
            </div>
          )}

          {toolMode === 'shape' && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
                <span className="text-gray-600">Shape</span>
                <select
                  value={selectedShape}
                  onChange={(e) => setSelectedShape(e.target.value as ShapeType)}
                  className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-200"
                >
                  <option value="rectangle">Rectangle</option>
                  <option value="circle">Circle</option>
                  <option value="line">Line</option>
                  <option value="triangle">Triangle</option>
                </select>
              </label>
              <div className="flex items-center gap-2"></div>
            </div>
          )}

          <div className="flex items-center gap-3">
            {/* Undo/Redo buttons */}
            <div className="flex items-center gap-2 border-r border-gray-200 pr-4 mr-2">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className={`px-4 py-2 rounded-xl border transition-all duration-200 ${
                  historyIndex <= 0
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                }`}
                title="Undo (Ctrl/Cmd+Z)"
              >
                ↶ Undo
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className={`px-4 py-2 rounded-xl border transition-all duration-200 ${
                  historyIndex >= history.length - 1
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
                }`}
                title="Redo (Ctrl/Cmd+Y)"
              >
                ↷ Redo
              </button>
            </div>

            <button
              onClick={() => setErasing((v) => !v)}
              className={`px-5 py-2 rounded-xl border transition-all duration-200 ${
                erasing 
                  ? "bg-gray-800 text-white border-gray-800 shadow-sm" 
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300"
              }`}
              title="Eraser: paints white over the canvas (independent of brush type)"
            >
              Eraser
            </button>
            
            <button 
              onClick={clear} 
              className="px-5 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200"
            >
              Clear
            </button>
            
            <button 
              onClick={exportPNG} 
              className="px-5 py-2 rounded-xl border border-gray-800 bg-gray-800 text-white hover:bg-gray-900 transition-all duration-200"
            >
              Export PNG
            </button>
            
            <button
              onClick={openFilePicker}
              className="px-5 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200"
              title="Upload an image to use as the board background"
            >
              Upload Image
            </button>

            <button
              onClick={() => setMoveMode((v) => !v)}
              className={`px-4 py-2 rounded-xl border transition-all duration-200 ${moveMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'}`}
              title="Toggle image edit mode — enable to move/resize the image"
            >
              {moveMode ? 'Image Edit: ON' : 'Image Edit: OFF'}
            </button>

            {backgroundImage && (
              <button
                onClick={() => { 
                  // Update the active board directly
                  setBoards(prevBoards => 
                    prevBoards.map(board => 
                      board.id === activeBoardId 
                        ? { ...board, backgroundImage: null }
                        : board
                    )
                  );
                  setBgImageObj(null); 
                  setBgSelected(false); 
                }}
                className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200"
                title="Remove background image"
              >
                Clear Background
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* Canvas container with enhanced styling */}
      <div className="bg-white border-l border-r border-b border-gray-200 rounded-b-2xl shadow-sm overflow-hidden">
  <div ref={containerRef} className="w-full" onDrop={onDrop} onDragOver={onDragOver}>
          <Stage
            key="whiteboard-stage"
            ref={stageRef}
            width={size.w}
            height={size.h}
            onMouseDown={(e) => {
              const clickedOnEmpty = e.target === e.target.getStage();
              if (clickedOnEmpty) setBgSelected(false);
              
              // Only prevent shape drawing when clicking on background image in shape mode
              if (toolMode === 'shape' && !clickedOnEmpty && bgImageObj) {
                return; // Don't start shape drawing when clicking on background image
              }
              
              onDown(e);
            }}
            onTouchStart={onDown}
            onMouseMove={onMove}
            onTouchMove={onMove}
            onMouseUp={onUp}
            onTouchEnd={onUp}
            onMouseLeave={() => {
              // Don't end the stroke on mouse leave - just stop adding points
              // The stroke will continue when mouse re-enters if still held down
            }}
            onMouseEnter={() => {
              // Reset mouse state when entering the whiteboard without mouse down
              // This prevents stroke continuation when re-entering without mouse down
              if (!isMouseDown) {
                setCurrent(null);
              }
            }}
            style={{ 
              background: "#ffffff", 
              cursor: erasing ? "crosshair" : "url(''), crosshair",
              borderRadius: "16px"
            }}
          >
            <Layer>
              {/* Background image (if uploaded) rendered beneath strokes and is draggable/transformable */}
              {bgImageObj && (
                <>
                  <KonvaImage
                    image={bgImageObj}
                    x={bgTransform.x}
                    y={bgTransform.y}
                    width={bgTransform.width}
                    height={bgTransform.height}
                    rotation={bgTransform.rotation}
                    draggable={moveMode}
                    ref={bgImageRef}
                    onClick={(e) => {
                      e.cancelBubble = true; // prevent stage from starting a stroke
                      if (moveMode) setBgSelected(true);
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      if (moveMode) setBgSelected(true);
                    }}
                    onDragEnd={(e) => {
                      const node = e.target;
                      const newTransform = { ...bgTransform, x: node.x(), y: node.y() };
                      // Update the active board directly
                      setBoards(prevBoards => 
                        prevBoards.map(board => 
                          board.id === activeBoardId 
                            ? { ...board, bgTransform: newTransform }
                            : board
                        )
                      );
                    }}
                    onTransformEnd={() => {
                      const node = bgImageRef.current;
                      if (!node) return;
                      const scaleX = node.scaleX() || 1;
                      const scaleY = node.scaleY() || 1;
                      node.scaleX(1);
                      node.scaleY(1);
                      const newTransform = {
                        x: node.x(),
                        y: node.y(),
                        width: Math.max(8, node.width() * scaleX),
                        height: Math.max(8, node.height() * scaleY),
                        rotation: node.rotation() || 0,
                      };
                      // Update the active board directly
                      setBoards(prevBoards => 
                        prevBoards.map(board => 
                          board.id === activeBoardId 
                            ? { ...board, bgTransform: newTransform }
                            : board
                        )
                      );
                    }}
                  />
                  {bgSelected && (
                    <Transformer
                      ref={transformerRef}
                      keepRatio={true}
                      enabledAnchors={["top-left","top-right","bottom-left","bottom-right","middle-left","middle-right","top-center","bottom-center"]}
                    />
                  )}
                </>
              )}
              {/* White background to ensure opaque export when no bg image */}
              {!bgImageObj && <Rect x={0} y={0} width={size.w} height={size.h} fill="#ffffff" />}
              {renderedStrokes}
              {renderedShapes}
              {renderedCurrentStroke}
              {renderedCurrentShape}
            </Layer>
          </Stage>
        </div>
      </div>
      {/* Loading overlay with animated visuals during analyzing/composing */}
      {(stage === 'analyzing' || stage === 'composing') && (
        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto bg-black/80 rounded-2xl p-8 shadow-xl flex items-center gap-6 w-[min(760px,calc(100%-48px))]">
            <div className="w-24 h-24 flex items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 animate-pulse-slower">
              <svg className="h-12 w-12 text-white animate-spin-slow" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="60" strokeLinecap="round"/></svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white">{stage === 'analyzing' ? 'Analyzing drawing' : 'Composing music'}</div>
              <div className="mt-2 text-xs text-white/80">This may take up to a minute. We&apos;re generating a musical composition that matches your drawing.</div>
              <div className="mt-4 w-full bg-white/10 h-2 rounded overflow-hidden">
                <div className={`h-2 bg-gradient-to-r from-blue-400 to-indigo-400 ${stage === 'composing' ? 'animate-loading-bar' : 'animate-loading-bar-slow'}`} style={{ width: stage === 'composing' ? '60%' : '30%' }} />
              </div>
            </div>
            {/* Cancel exists outside this overlay already; remove internal cancel button */}
          </div>
        </div>
      )}
      
      {/* Music Generation Button & Result */}
      <div className="mt-8 flex flex-col items-center">
        <button
          onClick={analyzeDrawing}
          disabled={analyzing || !canGenerateMusic}
          className={`px-6 py-3 rounded-xl border font-semibold shadow transition-all ${
            analyzing || !canGenerateMusic
              ? 'border-gray-300 bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800'
          }`}
        >
          {analyzing ? 'Analyzing...' : 'Generate Music from Drawing'}
        </button>
        
        {/* Stroke count feedback */}
        {!canGenerateMusic && (
          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg max-w-xl">
            <p className="text-sm text-yellow-800 font-medium mb-2">
              {boards.length === 1 
                ? 'Need at least 5 strokes or upload an image to generate music'
                : 'All boards need at least 5 strokes or uploaded images to generate music'
              }
            </p>
            <div className="space-y-1">
              {strokeCountInfo.map(board => (
                <div key={board.id} className="flex items-center justify-between text-xs">
                  <span className={`${board.isValid ? 'text-green-700' : 'text-yellow-700'}`}>
                    {board.name}: {board.strokeCount} strokes {board.hasImage ? '+ image' : ''}
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    board.isValid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {board.isValid ? '✓ Ready' : 'Need 5+ strokes'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <p className="mt-3 max-w-xl text-sm text-gray-600 text-center">
          Convert this drawing into a short musical interpretation, a way to represent your visual art into a musical
          piece (works for scenes, patterns, and realistic drawings alike).
        </p>
        <p className="mt-2 max-w-xl text-xs text-gray-500 italic text-center"></p>
      </div>
      
      {/* Progressive Compositing Stepper */}
      <div className="mt-8 w-full max-w-3xl mx-auto">
        <div className="flex flex-col items-center">
          {/* Stepper */}
          <div className="w-full">
            <div className="flex items-center justify-center gap-8">
              {[
                { id: 'analyze', label: 'Analyze' },
                { id: 'compose', label: 'Compose' },
                { id: 'done', label: 'Done' },
              ].map((step, idx) => {
                const active = (
                  (stage === 'analyzing' && step.id === 'analyze') ||
                  (stage === 'composing' && step.id === 'compose') ||
                  (stage === 'done' && step.id === 'done')
                );
                const completed = (() => {
                  if (stage === 'done') return true;
                  if (stage === 'composing') return step.id === 'analyze';
                  return false;
                })();
                return (
                  <div key={step.id} className="flex flex-col items-center gap-2 text-center w-32">
                    <div className={`w-10 h-10 flex items-center justify-center rounded-full ${completed ? 'bg-blue-600 text-white' : active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {active && stage !== 'done' ? (
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="60" strokeLinecap="round"/></svg>
                      ) : completed ? (
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                      ) : (
                        <span className="text-sm font-medium">{idx + 1}</span>
                      )}
                    </div>
                    <div>
                      <div className={`text-sm font-semibold ${completed ? 'text-gray-800' : active ? 'text-blue-700' : 'text-gray-500'}`}>{step.label}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions (centered below stepper) */}
          <div className="w-full flex justify-center mt-4">
            {(stage === 'analyzing' || stage === 'composing') && (
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeDasharray="60" strokeLinecap="round"/></svg>
                <button onClick={cancelAnalyze} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm">Cancel</button>
              </div>
            )}
          </div>
        </div>

        {/* Removed duplicate marketing sentence as requested */}

        {/* Results area */}
        <div className="mt-6 flex justify-center">
          <div className="w-full max-w-3xl">
            {stage === 'done' && convertedMusic && (
              <div className="mt-6 p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl text-blue-900">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <strong className="text-lg">Generated Music</strong>
              </div>
              <div className="mt-4 flex justify-center">
                <div className="w-full max-w-xl">
                  {convertedMusic.startsWith('data:audio') || convertedMusic.match(/^https?:\/\//) ? (
                    <div className="w-full">
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <AudioPlayer
                            src={convertedMusic}
                            style={{
                              borderRadius: '8px',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                            }}
                            customAdditionalControls={[]}
                            showJumpControls={true}
                            customVolumeControls={[]}
                            layout="horizontal"
                            preload="metadata"
                          />
                        </div>
                        <div className="flex-shrink-0">
                          <button onClick={handleDownloadConvertedMusic} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm">Download</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <pre className="text-left whitespace-pre-wrap bg-white p-3 rounded-md text-sm text-gray-800">{convertedMusic}</pre>
                  )}
                </div>
              </div>
              
              {/* Try Again Buttons */}
              <div className="mt-4 flex gap-2 justify-center">
                <button
                  onClick={tryAgain}
                  disabled={analyzing}
                  className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Try Again
                </button>
                <button
                  onClick={() => setShowAdjustPopup(true)}
                  disabled={analyzing}
                  className="px-4 py-2 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors text-sm font-medium"
                >
                  Adjust
                </button>
              </div>
            </div>
          )}
          </div>
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Adjust Popup Modal */}
      {showAdjustPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Adjust Music</h3>
              <button
                onClick={() => {
                  setShowAdjustPopup(false);
                  setAdjustInstructions('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                What would you like to change?
              </label>
              <textarea
                value={adjustInstructions}
                onChange={(e) => setAdjustInstructions(e.target.value)}
                placeholder="e.g., Make it more upbeat, slower tempo, add piano, more cinematic, etc."
                className="w-full p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder-gray-500"
                rows={3}
                maxLength={200}
              />
              <div className="text-xs text-gray-600 mt-1 font-medium">
                {adjustInstructions.length}/200 characters
              </div>
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowAdjustPopup(false);
                  setAdjustInstructions('');
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={adjustMusic}
                disabled={!adjustInstructions.trim() || analyzing}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  !adjustInstructions.trim() || analyzing
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {analyzing ? 'Adjusting...' : 'Apply Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
