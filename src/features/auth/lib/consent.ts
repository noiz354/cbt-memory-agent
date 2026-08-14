export interface ConsentClause {
  id: string;
  title: string;
  body: string;
}

export const CONSENT_CLAUSES: ConsentClause[] = [
  {
    id: "scope",
    title: "What this agent is",
    body: "CBT Memory Agent is a structured cognitive-behavioral workspace. It helps you name automatic thoughts, collect evidence, and keep a private memory vault. It is not a licensed clinician, a diagnosis, or an emergency service.",
  },
  {
    id: "crisis",
    title: "Crisis override",
    body: "If language or sensors suggest acute risk, the session hard-halts and the crisis protocol takes the screen (call 988 / 119). That overlay is the only path that may leave this device, and only because you slide to dial.",
  },
  {
    id: "on-device",
    title: "Zero-cloud media",
    body: "Camera frames and microphone samples are processed in Web Workers on this device (vision + Web Audio). Raw media is never uploaded. Snapshots you drop into chat stay in local state until you purge them.",
  },
  {
    id: "memory",
    title: "Memory & transcripts",
    body: "Core memories, session notes, and mood traces live in this browser profile. You may export a JSON bundle or hard-purge the vault at any time from Privacy & Security. Decay does not equal deletion until you confirm.",
  },
  {
    id: "limits",
    title: "Limits of the model",
    body: "Generated language can be wrong, incomplete, or poorly timed. You decide what is true in your life. Do not use this agent as the sole support for severe depression, psychosis, or active suicidal planning — involve a human clinician.",
  },
  {
    id: "revoke",
    title: "Your right to stop",
    body: "Consent is versioned (2026.08-cbt-1) and can be withdrawn. Withdrawing signs you out, locks the vault, and offers a hard purge. Continuing means you have read these clauses and accept them for this device.",
  },
];
