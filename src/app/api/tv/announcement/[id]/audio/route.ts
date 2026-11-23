/**
 * STUB — owned by E2 (contract C3). Replace this file when E2 ships TTS.
 * Contract: GET → 200 with `content-type: audio/*` and the announcement audio, or any
 * non-audio / non-200 response, in which case the TV plays /chime.mp3.
 */
export function GET() {
  return new Response(null, { status: 204 });
}
