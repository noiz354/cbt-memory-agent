export interface CrisisHit {
  reason: string;
  phrase: string;
}

const PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(suicid(al|e)?|kill myself|killing myself|end my life|end it all)\b/i, reason: "Language suggesting suicidal intent was detected locally." },
  { re: /\b(want to die|wanna die|better off dead|no reason to live)\b/i, reason: "Language suggesting a wish to die was detected locally." },
  { re: /\b(self[-\s]?harm|cut myself|hurt myself|overdose)\b/i, reason: "Language suggesting self-harm was detected locally." },
  { re: /\b(planning to (die|jump|hang)|have a plan to)\b/i, reason: "Language suggesting a plan for harm was detected locally." },
  { re: /\b(bunuh diri|ingin mati|mau mati|lebih baik mati|tak ingin hidup)\b/i, reason: "Frasa yang mengarah pada niat menyakiti diri terdeteksi di perangkat ini." },
  { re: /\b(melukai diri|menyakiti diri|overdosis)\b/i, reason: "Frasa yang mengarah pada self-harm terdeteksi di perangkat ini." },
];

export function detectCrisis(text: string): CrisisHit | null {
  const sample = text.trim();
  if (sample.length < 4) return null;
  for (const rule of PATTERNS) {
    const match = sample.match(rule.re);
    if (match) {
      return { reason: rule.reason, phrase: match[0] };
    }
  }
  return null;
}
