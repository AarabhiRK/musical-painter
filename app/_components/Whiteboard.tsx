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
  // Converted music analysis state
  const [convertedMusic, setConvertedMusic] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState<'idle'|'analyzing'|'composing'|'done'|'cancelled'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [beatovenStatus, setBeatovenStatus] = useState<string | null>(null);
  const [beatovenTaskId, setBeatovenTaskId] = useState<string | null>(null);
  // promptPreview is intentionally not surfaced in UI; server logs to data/runs.json
  const abortCtrlRef = useRef<AbortController | null>(null);

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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

  // Export and analyze function
  const analyzeDrawing = async () => {
    setConvertedMusic(null);
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
      if (!stageRef.current) throw new Error('No drawing to analyze.');
      const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
      const base64 = uri.replace(/^data:image\/png;base64,/, "");
      // call the new generate-music route which returns { prompt, task_id, trackUrl, beatovenMeta, geminiRaw }
      const res = await fetch("/api/generate-music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
        signal: ac.signal,
      });
      const data = await res.json();
      // Expected shape: { prompt, task_id, trackUrl, beatovenMeta, geminiRaw }
      if (data?.trackUrl) {
        setConvertedMusic(data.trackUrl);
        setBeatovenStatus(data?.beatovenMeta?.status || 'composed');
        setBeatovenTaskId(data?.task_id || null);
        // do not surface prompt/task to UI; server logs runs to data/runs.json
        setStage('done');
      } else if (data?.prompt) {
        // Server returned a parsed prompt but no final track yet - switch to composing state silently
        setConvertedMusic(null);
        setBeatovenTaskId(data?.task_id || null);
        setBeatovenStatus(data?.beatovenMeta?.status || null);
        setStage('composing');
      } else if (data?.geminiRaw) {
        // fallback: keep raw for debugging but don't show by default
        setConvertedMusic(null);
      } else if (data?.error) {
        setError(data.error);
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

  // Audio control functions
  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current || isDragging) return;
    setCurrentTime(audioRef.current.currentTime);
  }, [isDragging]);

  const handleLoadedMetadata = useCallback(() => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const formatTime = useCallback((time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

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
      <style>{`
        @keyframes pulse-slower { 0% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.05); opacity: 0.9 } 100% { transform: scale(1); opacity: 1 } }
        .animate-pulse-slower { animation: pulse-slower 2.8s ease-in-out infinite; }
        @keyframes spin-slow { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        .animate-spin-slow { animation: spin-slow 3s linear infinite; }
        @keyframes loading-bar { 0% { transform: translateX(-100%);} 50% { transform: translateX(-20%);} 100% { transform: translateX(100%);} }
        .animate-loading-bar { animation: loading-bar 2.2s linear infinite; }
        .animate-loading-bar-slow { animation: loading-bar 4s linear infinite; }
      `}</style>
      {/* Toolbar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-8 shadow-sm">
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
      {/* Loading overlay with animated visuals during analyzing/composing */}
      {(stage === 'analyzing' || stage === 'composing') && (
        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto bg-white/90 dark:bg-black/80 rounded-2xl p-8 shadow-xl flex items-center gap-6 w-[min(760px,calc(100%-48px))]">
            <div className="w-24 h-24 flex items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 animate-pulse-slower">
              <svg className="h-12 w-12 text-white animate-spin-slow" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="60" strokeLinecap="round"/></svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-800">{stage === 'analyzing' ? 'Analyzing drawing' : 'Composing music'}</div>
              <div className="mt-2 text-xs text-gray-600">This may take up to a minute. We&apos;re generating a musical composition that matches your drawing.</div>
              <div className="mt-4 w-full bg-gray-100 h-2 rounded overflow-hidden">
                <div className={`h-2 bg-gradient-to-r from-blue-500 to-indigo-500 ${stage === 'composing' ? 'animate-loading-bar' : 'animate-loading-bar-slow'}`} style={{ width: stage === 'composing' ? '60%' : '30%' }} />
              </div>
            </div>
            <div>
              <button onClick={cancelAnalyze} className="px-4 py-2 rounded-lg bg-white border">Cancel</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Music Generation Button & Result */}
      <div className="mt-8 flex flex-col items-center">
        <button
          onClick={analyzeDrawing}
          disabled={analyzing}
          className="px-6 py-3 rounded-xl border border-blue-700 bg-blue-700 text-white font-semibold shadow hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          {analyzing ? 'Analyzing...' : 'Generate Music from Drawing'}
        </button>
        <p className="mt-3 max-w-xl text-sm text-gray-600 text-center">
          Convert this drawing into a short musical interpretation, a way to represent your visual art into a musical
          piece (works for scenes, patterns, and realistic drawings alike).
        </p>
        <p className="mt-2 max-w-xl text-xs text-gray-500 italic text-center"></p>
        {convertedMusic && (
          <div className="mt-6 p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl text-blue-900 max-w-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <strong className="text-lg">Generated Music</strong>
            </div>
            <div className="mt-4">
              {convertedMusic.startsWith('data:audio') || convertedMusic.match(/^https?:\/\//) ? (
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  {/* Hidden audio element for actual playback */}
                  <audio
                    ref={audioRef}
                    src={convertedMusic}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                    className="hidden"
                  />
                  
                  {/* Custom Audio Player */}
                  <div className="space-y-4">
                    {/* Play/Pause Button */}
                    <div className="flex justify-center">
                      <button
                        onClick={togglePlayPause}
                        className="w-16 h-16 bg-blue-600 hover:bg-blue-700 rounded-full flex items-center justify-center text-white shadow-lg transition-all duration-200 hover:scale-105"
                      >
                        {isPlaying ? (
                          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                          </svg>
                        ) : (
                          <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div
                        className="w-full h-2 bg-gray-200 rounded-full cursor-pointer hover:h-3 transition-all duration-200"
                        onClick={handleSeek}
                        onMouseDown={handleMouseDown}
                        onMouseUp={handleMouseUp}
                      >
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-200 hover:from-blue-600 hover:to-indigo-700"
                          style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                        >
                          <div className="w-4 h-4 bg-white rounded-full shadow-md float-right -mt-1 -mr-2 hover:scale-110 transition-transform duration-200"></div>
                        </div>
                      </div>
                      
                      {/* Time Display */}
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <pre className="text-left whitespace-pre-wrap bg-white p-3 rounded-md text-sm text-gray-800">{convertedMusic}</pre>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Progressive Compositing Stepper */}
      <div className="mt-8 w-full max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          {/* Stepper */}
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
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
                  <div key={step.id} className="flex-1 flex items-center gap-3">
                    <div className={`w-10 h-10 flex items-center justify-center rounded-full ${completed ? 'bg-blue-600 text-white' : active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {active && stage !== 'done' ? (
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="60" strokeLinecap="round"/></svg>
                      ) : completed ? (
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                      ) : (
                        <span className="text-sm font-medium">{idx + 1}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className={`text-sm font-semibold ${completed ? 'text-gray-800' : active ? 'text-blue-700' : 'text-gray-500'}`}>{step.label}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {stage !== 'analyzing' && stage !== 'composing' && (
              <button
                onClick={() => {
                  analyzeDrawing();
                }}
                className="px-6 py-3 rounded-xl border border-blue-700 bg-blue-700 text-white font-semibold shadow hover:bg-blue-800 transition-all"
              >
                {stage === 'idle' ? 'Start' : stage === 'done' ? 'Analyze Again' : 'Analyze'}
              </button>
            )}

            {(stage === 'analyzing' || stage === 'composing') && (
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeDasharray="60" strokeLinecap="round"/></svg>
                <button onClick={cancelAnalyze} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm">Cancel</button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm text-gray-600">Convert your drawing into a musical piece — compose high-quality music from your drawing.</p>
        </div>

        {/* Results area */}
        <div className="mt-6">
          {stage === 'done' && convertedMusic && (
            <div className="mt-6 p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl text-blue-900 max-w-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                <strong className="text-lg">Generated Music</strong>
              </div>
              <div className="mt-4">
                {convertedMusic.startsWith('data:audio') || convertedMusic.match(/^https?:\/\//) ? (
                  <div className="w-full">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (!audioRef.current) return;
                          if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
                          else { audioRef.current.play(); setIsPlaying(true); }
                        }}
                        className="px-3 py-2 rounded-md bg-white border"
                      >{isPlaying ? 'Pause' : 'Play'}</button>
                      <div className="flex-1 bg-gray-200 h-3 rounded overflow-hidden">
                        <div style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} className="h-3 bg-blue-600" />
                      </div>
                    </div>
                    <audio ref={audioRef} src={convertedMusic} className="hidden" />
                  </div>
                ) : (
                  <pre className="text-left whitespace-pre-wrap bg-white p-3 rounded-md text-sm text-gray-800">{convertedMusic}</pre>
                )}
              </div>
            </div>
          )}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
