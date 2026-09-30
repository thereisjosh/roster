const SHORTHAND: Record<string, string> = {
  "tmr": "tomorrow", "tdy": "today", "nxt": "next",
  "sched": "schedule",
  "wrk": "work", "sry": "sorry", "alr": "already",
  "yup": "yes", "yep": "yes", "ya": "yes", "nah": "no",
  "boleh": "can", "can't": "cannot", "cant": "cannot",
  "cannt": "cannot", "nt": "not", "wat": "what",
  "availble": "available", "avail": "available",
  "wk": "week", "n": "and", "2day": "today",
};

const PARTICLES = /\b(lah|la|lor|leh|ah|hor|sia|nia|meh)\b/gi;

export function normalise(text: string): string {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 0);
  // Only strip particles if the message has more than one substantive word
  // remaining, so short responses like "cannot lah" stay intact for the LLM.
  const withoutParticles = lower.replace(PARTICLES, "").replace(/\s{2,}/g, " ").trim();
  const substantiveWords = withoutParticles.split(/\s+/).filter(w => w.length > 0);
  const base = substantiveWords.length >= 2 || words.length <= 1 ? withoutParticles : lower.trim();
  return base
    .split(/\s+/)
    .map(word => SHORTHAND[word] ?? word)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
