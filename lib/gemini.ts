export type GeminiResponse = any;

export function extractTextFromGemini(data: GeminiResponse) {
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.output?.[0]?.content?.text ||
    // fallback to stringified payload so callers always get something
    JSON.stringify(data)
  );
}

export default extractTextFromGemini;
