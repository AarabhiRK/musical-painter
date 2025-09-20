import Whiteboard from "./_components/Whiteboard";

export default function Page() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <main className="container mx-auto px-4 py-8 md:px-8 md:py-12">
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            🎨 Musical Painter
          </h1>
          <p className="text-lg text-gray-600 mb-2">
            Draw to Music — Interactive Whiteboard
          </p>
          <p className="text-sm text-gray-500 max-w-2xl mx-auto">
            Sketch freely on the canvas below. Use the eraser to correct mistakes, adjust colors and brush size, 
            then click "Export PNG" to download your creation. Your drawings will be analyzed to generate music in the next step.
          </p>
        </div>
        
        <Whiteboard />
        
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">
            Tip: Try drawing different shapes, patterns, or musical symbols to see how they translate to sound!
          </p>
        </div>
      </main>
    </div>
  );
}
