/**
 * Soft Peacekeeper: detect frustrated / aggressive / threatening tone and suggest a calmer rewrite.
 * Never auto-blocks disagreement - callers always allow post-as-is.
 */

const AGGRESSIVE_PATTERNS: RegExp[] = [
  /\b(idiot|stupid|dumb|moron|useless|pathetic|shut\s*up|wtf|bs|bullshit|damn|bloody|hell)\b/i,
  /\bwhat\s+the\s+hell\b/i,
  /\b(hate|disgusting|worst|garbage|trash|scam|fraud|liar)\b/i,
  /\b(fix\s+this|screw\s+this|get\s+lost|go\s+to\s+hell)\b/i,
  /\b(beat\s+you|kill\s+you|murder|threaten|to\s+the\s+death|punch\s+you|slap\s+you|hurt\s+you)\b/i,
  /\bi\s+will\s+(beat|kill|hurt|destroy|ruin)\b/i,
  /\b(think\s+about\s+yourself|who\s+do\s+you\s+think)\b/i,
  /[!?]{3,}/,
  /\b(YOU\s+(ALWAYS|NEVER|MUST)|ALWAYS\s+BROKEN|NEVER\s+WORKS)\b/,
];

const CALM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bidiot\b/gi, 'issue'],
  [/\bstupid\b/gi, 'frustrating'],
  [/\bdumb\b/gi, 'odd'],
  [/\bmoron\b/gi, 'neighbour'],
  [/\buseless\b/gi, 'not working well'],
  [/\bpathetic\b/gi, 'disappointing'],
  [/\bshut\s*up\b/gi, 'please pause'],
  [/\bwtf\b/gi, 'what happened'],
  [/\bwhat\s+the\s+hell\b/gi, 'what'],
  [/\bhell\b/gi, ''],
  [/\bbs\b/gi, 'problem'],
  [/\bbullshit\b/gi, 'concern'],
  [/\bdamn\b/gi, ''],
  [/\bbloody\b/gi, ''],
  [/\bhate\b/gi, 'dislike'],
  [/\bdisgusting\b/gi, 'hard to accept'],
  [/\bworst\b/gi, 'difficult'],
  [/\bgarbage\b/gi, 'poor quality'],
  [/\btrash\b/gi, 'poor quality'],
  [/\bscam\b/gi, 'concern'],
  [/\bfraud\b/gi, 'concern'],
  [/\bliar\b/gi, 'incorrect'],
  [/\bfix\s+this\b/gi, 'please help resolve this'],
  [/\bscrew\s+this\b/gi, 'this is frustrating'],
  [/\bget\s+lost\b/gi, 'please step back'],
  [/\bgo\s+to\s+hell\b/gi, 'this is upsetting'],
  [/\bi\s+will\s+beat\s+you\s+to\s+the\s+death\b/gi, 'I am very upset and want this resolved'],
  [/\bbeat\s+you\s+to\s+the\s+death\b/gi, 'really need this fixed'],
  [/\bbeat\s+you\b/gi, 'disagree strongly with you'],
  [/\bkill\s+you\b/gi, 'strongly disagree'],
  [/\bpunch\s+you\b/gi, 'push back'],
  [/\bslap\s+you\b/gi, 'push back'],
  [/\bhurt\s+you\b/gi, 'push back'],
  [/\bto\s+the\s+death\b/gi, ''],
  [/\bi\s+will\s+(beat|kill|hurt|destroy|ruin)\b/gi, 'I am frustrated and want to resolve'],
  [/\bwho\s+do\s+you\s+think\s+you\s+are\b/gi, 'I disagree with how this was handled'],
  [/\bthink\s+about\s+yourself\b/gi, 'reconsider this'],
  [/[!?]{3,}/g, '!'],
];

export type PeacekeeperResult = {
  needsNudge: boolean;
  reason: string;
  calmerVersion: string;
};

function rewriteCalm(text: string): string {
  let calmer = text;
  for (const [re, repl] of CALM_REPLACEMENTS) {
    calmer = calmer.replace(re, repl);
  }
  calmer = calmer.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim();
  return calmer;
}

export function assessPeacekeeperTone(raw: string): PeacekeeperResult {
  const text = (raw || '').trim();
  if (!text || text.length < 8) {
    return { needsNudge: false, reason: '', calmerVersion: text };
  }

  const hits = AGGRESSIVE_PATTERNS.filter((re) => re.test(text));
  if (hits.length === 0) {
    return { needsNudge: false, reason: '', calmerVersion: text };
  }

  let calmer = rewriteCalm(text);

  // Soft lead-in if still heated or barely changed
  if (calmer === text || AGGRESSIVE_PATTERNS.some((re) => re.test(calmer))) {
    calmer = rewriteCalm(
      `I wanted to raise this calmly with neighbours: ${text.replace(/[!?]{2,}/g, '.')}`,
    );
  }

  // Threat-heavy copy: prefer a clear neighbour-safe rewrite
  if (/\b(beat|kill|murder|to\s+the\s+death|punch|slap)\b/i.test(text)) {
    calmer =
      'I am really upset about this. Can we please talk this through calmly as neighbours?';
  }

  return {
    needsNudge: true,
    reason: 'Your message sounds frustrated or threatening.',
    calmerVersion: calmer,
  };
}
