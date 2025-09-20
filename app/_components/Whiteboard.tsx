"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Stage, Layer, Line, Rect } from "react-konva";

type Point = number;
type BrushType = 'normal' | 'rough' | 'thin' | 'highlighter' | 'spray' | 'marker';
type Stroke = { 
  points: Point[]; 
  color: string; 
  width: number; 
  brushType: BrushType;
  opacity?: number;
  globalCompositeOperation?: "source-over" | "destination-out" 
};

export default function Whiteboard() {
  // Emotion analysis state
  const [emotionSummary, setEmotionSummary] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Export and analyze function
  const analyzeEmotions = async () => {
    setEmotionSummary(null);
    setError(null);
    setAnalyzing(true);
    try {
      if (!stageRef.current) throw new Error('No drawing to analyze.');
      const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
      const base64 = uri.replace(/^data:image\/png;base64,/, "");
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 })
      });
      const data = await res.json();
      
      // Check if the response contains an error
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || data.error || `API request failed with status ${res.status}`);
      }
      
      // Gemini API returns candidates[0].content.parts[0].text
      const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No summary returned.';
      setEmotionSummary(summary);
    } catch (e: any) {
      setError(e.message || 'Failed to analyze.');
    } finally {
      setAnalyzing(false);
    }
  };
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [color, setColor] = useState("#2563eb");
  const [width, setWidth] = useState(6);
  const [brushType, setBrushType] = useState<BrushType>('normal');
  const [erasing, setErasing] = useState(false);
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  
  // Undo/Redo state management
  const [history, setHistory] = useState<Stroke[][]>([[]]);
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
    // If erasing, force normal brush and white color so erasing is just painting white
    const effectiveBrushType: BrushType = erasing ? 'normal' : brushType;
    const effectiveColor = erasing ? '#ffffff' : color;
    const brushProps = getBrushProperties(effectiveBrushType, width);
    const s: Stroke = {
      points: [pos.x, pos.y],
      color: effectiveColor,
      width: brushProps.width,
      brushType: effectiveBrushType,
      opacity: brushProps.opacity,
      // keep default compositing (draw white over canvas) when erasing
      globalCompositeOperation: 'source-over',
    };
    setCurrent(s);
  }, [brushType, width, color, erasing]);

  const onMove = useCallback((e: any) => {
    if (!current) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    setCurrent({
      ...current,
      points: current.points.concat([point.x, point.y]),
    });
  }, [current]);

  const onUp = useCallback(() => {
    if (!current) return;
    const newStrokes = [...strokes, current];
    setStrokes(newStrokes);
    setCurrent(null);
    
    // Add to history for undo/redo
    addToHistory(newStrokes);
  }, [current, strokes]);

  // Add stroke to history
  const addToHistory = useCallback((newStrokes: Stroke[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newStrokes);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  // Undo function
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setStrokes(history[newIndex]);
    }
  }, [historyIndex, history]);

  // Redo function
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setStrokes(history[newIndex]);
    }
  }, [historyIndex, history]);

  const clear = useCallback(() => {
    setStrokes([]);
    addToHistory([]);
  }, [addToHistory]);

  const exportPNG = useCallback(() => {
    if (!stageRef.current) return;
    const uri = stageRef.current.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
    // Download now; later you'll POST this to /api/analyze
    const a = document.createElement("a");
    a.href = uri;
    a.download = "drawing.png";
    a.click();
  }, []);

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
          const jittered = s.points.map((val, idx) => {
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

  return (
    <div className="w-full max-w-7xl mx-auto">
      {/* Toolbar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-8 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
              <span className="text-gray-600">Color</span>
              <input 
                type="color" 
                value={color} 
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-xl border-2 border-gray-200 cursor-pointer hover:border-gray-300 transition-colors"
              />
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
          </div>
        </div>
      </div>

      {/* Canvas container with enhanced styling */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div ref={containerRef} className="w-full">
          <Stage
            key="whiteboard-stage"
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
              borderRadius: "16px"
            }}
          >
            <Layer>
              {/* White background to ensure opaque export */}
              <Rect x={0} y={0} width={size.w} height={size.h} fill="#ffffff" />
              {renderedStrokes}
              {renderedCurrentStroke}
            </Layer>
          </Stage>
        </div>
      </div>
      {/* Analyze Emotions Button & Result */}
      <div className="mt-8 flex flex-col items-center">
        <button
          onClick={analyzeEmotions}
          disabled={analyzing}
          className="px-6 py-3 rounded-xl border border-blue-700 bg-blue-700 text-white font-semibold shadow hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          {analyzing ? 'Analyzing...' : 'Analyze Emotions'}
        </button>
        {emotionSummary && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 max-w-xl text-center">
            <strong>Emotion Summary:</strong>
            <div className="mt-2 whitespace-pre-line">{emotionSummary}</div>
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 max-w-xl text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
