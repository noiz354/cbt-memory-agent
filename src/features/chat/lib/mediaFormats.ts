/**
 * Media format helpers for the attachment pipeline.
 * Extension derives from the recorded container so iOS MP4 output is no longer
 * stored as webm, and timeline sampling always yields at least one frame.
 */

export function extFromMimeType(mimeType: string): string {
  const type = (mimeType || "").toLowerCase();
  if (type.startsWith("audio/")) {
    if (type.includes("mpeg")) return "mp3";
    if (type.includes("m4a") || type.includes("mp4") || type.includes("aac")) return "m4a";
    if (type.includes("ogg") || type.includes("opus")) return "ogg";
    if (type.includes("wav")) return "wav";
    return "webm";
  }
  if (type.startsWith("video/")) {
    if (type.includes("mp4") || type.includes("m4v")) return "mp4";
    if (type.includes("quicktime")) return "mov";
    return "webm";
  }
  if (type.startsWith("image/")) {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    return "jpg";
  }
  return "bin";
}

export function timelineStops(durationMs: number, stepMs: number): number[] {
  const stops: number[] = [];
  const end = Math.max(0, durationMs - 1);
  for (let t = 0; t < durationMs; t += stepMs) {
    stops.push(Math.min(t, end));
  }
  if (stops.length === 0) stops.push(0);
  return stops;
}