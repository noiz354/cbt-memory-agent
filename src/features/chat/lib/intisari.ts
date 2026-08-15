import type { ChatMessage } from "@/features/chat/types";
import type { MoodLabel } from "@/shared/types";

/**
 * Rule-based session summary ("intisari") generator — no LLM required.
 *
 * Produces a structured digest from the raw transcript: dominant topics,
 * emotional cues, the last user "thought", and a deterministic reframe built
 * from CBT-adjacent templates. This replaces the previously hardcoded
 * { mood: 5, moodLabel: "grounded", reframe: null } metadata in finalize().
 */

export interface Intisari {
  excerpt: string;
  mood: number;
  moodLabel: MoodLabel;
  reframe: string | null;
}

const TOPIC_KEYWORDS: { topic: string; words: RegExp }[] = [
  { topic: "work", words: /\b(slack|work|boss|colleague|meeting|deadline|office|project|job)\b/i },
  { topic: "family", words: /\b(family|parent|mother|father|sister|brother|kid|child|marriage|home)\b/i },
  { topic: "relationship", words: /\b(partner|boyfriend|girlfriend|relationship|breakup|date|marriage|spouse)\b/i },
  { topic: "anxiety", words: /\b(anxious|anxiety|worry|worried|panic|fear|scared|afraid|stress)\b/i },
  { topic: "self-esteem", words: /\b(failure|fail|worthless|not good enough|impostor|doubt|ashamed|guilt|shame)\b/i },
  { topic: "sleep", words: /\b(sleep|insomnia|tired|exhausted|awake at|can't sleep)\b/i },
];

const MOOD_CUES: { mood: number; label: MoodLabel; words: RegExp }[] = [
  { mood: 1, label: "agitated", words: /\b(hopeless|desperate|can't go on|want to die|suicide|terrible)\b/i },
  { mood: 2, label: "low", words: /\b(sad|down|empty|depressed|crying|miserable|awful)\b/i },
  { mood: 3, label: "anxious", words: /\b(anxious|panic|worried|scared|afraid|on edge|nervous)\b/i },
  { mood: 4, label: "numb", words: /\b(okay|fine|confused|unsure|tired|overwhelmed)\b/i },
  { mood: 6, label: "grounded", words: /\b(calm|better|lighter|relieved|peaceful|settled)\b/i },
  { mood: 7, label: "hopeful", words: /\b(hopeful|optimistic|excited|stronger|clearer|confident)\b/i },
];

const REFRAME_TEMPLATES: { when: RegExp; reframe: string }[] = [
  {
    when: /\b(always|never|every time|nothing ever)\b/i,
    reframe:
      "Notice the absolutist language (\"always / never\"). A single event rarely defines a permanent pattern — look for the one concrete exception and test the belief against it.",
  },
  {
    when: /\b(should|must|have to|ought to)\b/i,
    reframe:
      "\"Should\" statements are a demand on yourself or others. Swap the demand for a preference (\"I'd prefer…\") and see whether the pressure eases.",
  },
  {
    when: /\b(worse|ruin|disaster|catastroph|end of the world)\b/i,
    reframe:
      "That sounds like catastrophizing — assuming the worst-case outcome. Ask: what is the most likely outcome, and what would I do if the worst case actually happened?",
  },
  {
    when: /\b(failure|failed|worthless|not good enough|useless)\b/i,
    reframe:
      "You're evaluating yourself against a single outcome. Separate what happened (an event) from who you are (a person) — failure at one task is evidence about one task, not about you.",
  },
  {
    when: /\b(impostor|faking|don't belong|fraud)\b/i,
    reframe:
      "That feeling of being an impostor is the belief that your success isn't earned. List one piece of concrete evidence that you do belong — the feeling is a thought, not a fact.",
  },
];

function countTopicHits(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function generateIntisari(messages: ChatMessage[]): Intisari {
  const userTurns = messages.filter((m) => m.role === "user");
  const assistantTurns = messages.filter((m) => m.role === "assistant");
  const transcript = userTurns.map((m) => m.content).join("\n");
  const fullText = messages.map((m) => m.content).join("\n");

  // Dominant topic (by keyword frequency across user turns).
  const topicHits = TOPIC_KEYWORDS.map((t) => ({ topic: t.topic, hits: countTopicHits(transcript, t.words) }))
    .filter((t) => t.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const dominantTopic = topicHits[0]?.topic ?? "general";

  // Mood from strongest cue present anywhere in the transcript.
  let mood = 5;
  let moodLabel: MoodLabel = "grounded";
  for (const cue of MOOD_CUES) {
    if (cue.words.test(fullText)) {
      mood = cue.mood;
      moodLabel = cue.label;
      break;
    }
  }

  // Deterministic reframe: first matching template, else none.
  let reframe: string | null = null;
  for (const tpl of REFRAME_TEMPLATES) {
    if (tpl.when.test(transcript)) {
      reframe = tpl.reframe;
      break;
    }
  }

  const lastUser = userTurns.at(-1)?.content.trim() ?? "";
  const turnCount = userTurns.length + assistantTurns.length;
  const topicLine = dominantTopic === "general" ? "multi-topic" : dominantTopic;
  const excerpt =
    `${topicLine} session · ${turnCount} turns` +
    (mood !== 5 ? ` · mood: ${moodLabel}` : "") +
    (lastUser ? ` · focus: ${lastUser.slice(0, 120)}` : "");

  return { excerpt, mood, moodLabel, reframe };
}
