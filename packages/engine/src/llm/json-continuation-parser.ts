/**
 * JSON response text helpers
 *
 * Strip markdown fences and surrounding prose from LLM JSON responses.
 * Truncated responses are not repaired: callers must receive complete,
 * schema-valid output or an error.
 */

/**
 * Clean markdown code blocks from content
 */
export function cleanMarkdownCodeBlocks(content: string): string {
  let cleaned = content.trim();

  // Remove markdown code fences
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    const jsonStartIndex = lines.findIndex(
      (line) => line.trim().startsWith('{') || line.trim().startsWith('[')
    );
    if (jsonStartIndex !== -1) {
      cleaned = lines.slice(jsonStartIndex).join('\n');
    }
    cleaned = cleaned.replace(/```\s*$/g, '').trim();
  }

  // Remove any remaining code fence markers
  cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');

  return cleaned.trim();
}

/**
 * Extract JSON from text that may contain prose
 */
export function extractJsonFromText(content: string): string {
  // If it already starts with JSON, return as-is
  if (content.startsWith('{') || content.startsWith('[')) {
    return content;
  }

  // Try to find JSON object or array in the text
  const jsonMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch?.[1]) {
    return jsonMatch[1];
  }

  return content;
}
