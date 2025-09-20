"use client";

import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Line, Rect } from "react-konva";

type Point = number;
type Stroke = { points: Point[]; color: string; width: number; globalCompositeOperation?: "source-over" | "destination-out" };

export default function Whiteboard() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [color, setColor] = useState("#2563eb");
  const [width, setWidth] = useState(6);
  const [erasing, setErasing] = useState(false);
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  
  // Undo/Redo state management
  const [history, setHistory] = useState<Stroke[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

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

  const onDown = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    const s: Stroke = {
      points: [pos.x, pos.y],
      color,
      width,
      globalCompositeOperation: erasing ? "destination-out" : "source-over",
    };
    setCurrent(s);
  };

  const onMove = (e: any) => {
    if (!current) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    setCurrent({
      ...current,
      points: current.points.concat([point.x, point.y]),
    });
  };

  const onUp = () => {
    if (!current) return;
    const newStrokes = [...strokes, current];
    setStrokes(newStrokes);
    setCurrent(null);
    
    // Add to history for undo/redo
    addToHistory(newStrokes);
  };

  // Add stroke to history
  const addToHistory = (newStrokes: Stroke[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newStrokes);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  // Undo function
  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setStrokes(history[newIndex]);
    }
  };

  // Redo function
  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setStrokes(history[newIndex]);
    }
  };

  const clear = () => {
    setStrokes([]);
    addToHistory([]);
  };

  const exportPNG = () => {
    const uri = stageRef.current.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
    // Download now; later you'll POST this to /api/analyze
    const a = document.createElement("a");
    a.href = uri;
    a.download = "drawing.png";
    a.click();
  };

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Toolbar */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <span>Color</span>
              <input 
                type="color" 
                value={color} 
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
              />
            </label>
          </div>
          
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <span>Width</span>
              <input
                type="range"
                min={1}
                max={32}
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value))}
                className="w-20"
              />
              <span className="text-xs text-gray-500 min-w-[30px]">{width}px</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            {/* Undo/Redo buttons */}
            <div className="flex items-center gap-1 border-r border-gray-300 pr-3 mr-2">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className={`px-3 py-2 rounded-lg border transition-colors ${
                  historyIndex <= 0
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
                title="Undo (Ctrl/Cmd+Z)"
              >
                ↶ Undo
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className={`px-3 py-2 rounded-lg border transition-colors ${
                  historyIndex >= history.length - 1
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
                title="Redo (Ctrl/Cmd+Y)"
              >
                ↷ Redo
              </button>
            </div>

            <button
              onClick={() => setErasing((v) => !v)}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                erasing 
                  ? "bg-red-500 text-white border-red-500 shadow-sm" 
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
              title="Toggle Eraser (draw with transparency)"
            >
              {erasing ? "Eraser ON" : "Eraser OFF"}
            </button>
            
            <button 
              onClick={clear} 
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Clear
            </button>
            
            <button 
              onClick={exportPNG} 
              className="px-4 py-2 rounded-lg border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            >
              Export PNG
            </button>
          </div>
        </div>
      </div>

      {/* Canvas container with enhanced styling */}
      <div className="bg-white border-2 border-gray-200 rounded-xl shadow-lg overflow-hidden">
        <div ref={containerRef} className="w-full">
          <Stage
            ref={stageRef}
            width={size.w}
            height={size.h}
            onMouseDown={onDown}
            onTouchStart={onDown}
            onMousemove={onMove}
            onTouchMove={onMove}
            onMouseup={onUp}
            onTouchEnd={onUp}
            style={{ 
              background: "#ffffff", 
              cursor: erasing ? "crosshair" : "url(''), crosshair",
              borderRadius: "12px"
            }}
          >
            <Layer>
              {/* White background to ensure opaque export */}
              <Rect x={0} y={0} width={size.w} height={size.h} fill="#ffffff" />
              {strokes.map((s, i) => (
                <Line
                  key={i}
                  points={s.points}
                  stroke={s.color}
                  strokeWidth={s.width}
                  tension={0.3}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={s.globalCompositeOperation}
                />
              ))}
              {current && (
                <Line
                  points={current.points}
                  stroke={current.color}
                  strokeWidth={current.width}
                  tension={0.3}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={current.globalCompositeOperation}
                />
              )}
            </Layer>
          </Stage>
        </div>
      </div>
    </div>
  );
}
