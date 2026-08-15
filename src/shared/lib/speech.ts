let current: { text: string; utterance: SpeechSynthesisUtterance } | null = null;

/** Speak a string with the Web Speech API. Returns false when unsupported. */
export function speak(text: string): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const clean = text.replace(/[*_#`>\-]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onend = () => {
    current = null;
  };
  current = { text: clean, utterance };
  window.speechSynthesis.speak(utterance);
  return true;
}

/** Stop any in-flight speech. */
export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  current = null;
}

/** True when a given text is currently being spoken. */
export function isSpeaking(text: string): boolean {
  return current?.text === text && window.speechSynthesis?.speaking === true;
}

/** Toggle: speaks when idle, stops when already speaking the same text. */
export function toggleSpeak(text: string): void {
  if (isSpeaking(text)) stopSpeaking();
  else speak(text);
}
