import Whiteboard from "./_components/Whiteboard";

export default function Page() {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="container mx-auto px-6 py-12 md:px-8 md:py-16">
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-light text-gray-900 mb-6 tracking-tight">
            SketchTunes
          </h1>
          <p className="text-xl text-gray-600 mb-4 font-light">
            Draw it. Hear it. Feel it.
          </p>
          <p className="text-base text-gray-500 max-w-3xl mx-auto leading-relaxed">
            Sketch freely on the canvas below. Use the eraser to correct mistakes, adjust colors and brush size, 
            then Export to download your creation. Your drawings will be analyzed to generate music in the next step.
          </p>
        </div>
        
        <Whiteboard />
        
        <div className="mt-12 text-center">
          <p className="text-sm text-gray-400 font-light">
            Tip: Try drawing a scene or situation and storyboards to see how they translate to sound!
          </p>
        </div>
      </main>
    </div>
  );
}
