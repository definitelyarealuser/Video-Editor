/**
 * Turns per-chunk transcript text (and, optionally, per-chunk spectral flatness) into a
 * ranked list of candidate sermon windows. No ML here - just heuristics over fixed-size
 * chunks: singing/music tends to produce sparse or repetitive transcription (low effective
 * word density), while a sermon is a long, sustained run of normal-paced, non-repetitive
 * speech. Short "talking head" segments look similar to a sermon in density but are filtered
 * out by scoring candidates against a target duration window instead of just picking the
 * longest run.
 *
 * Word count alone isn't enough to rule out music: sung lyrics can transcribe just fine and
 * produce a normal-looking word count. Two extra signals catch that case even when the words
 * came through clearly:
 *  - Repeated-phrase text (a chorus repeating "Alleluia, alleluia...") has a low unique-word
 *    ratio, which natural continuous speech essentially never does.
 *  - Low spectral flatness (tonal/harmonic audio - sustained notes, chords) is a property of
 *    the *audio itself*, independent of what Whisper transcribed, so it catches instrumental
 *    or sung content even where the repeated-phrase check doesn't apply.
 */

const DEFAULT_OPTIONS = {
  minWordsPerMinute: 60, // below this, a chunk is treated as non-speech (music/silence/crowd noise)
  maxGapChunks: 2, // tolerate up to this many consecutive weak chunks mid-run (a pause, a Scripture reading in a hushed voice, etc.) without splitting it
  idealMinutes: 35, // typical sermon length to score candidates against (church reports 30-45min, ~35 average)
  scoreSigmaMinutes: 12, // how forgiving the duration scoring is around idealMinutes
  minCandidateMinutes: 5, // ignore runs shorter than this outright
  skipPenalties: false, // ignore the repeated-phrase/spectral-flatness discounts - used as a fallback pass
};

// Cheap content signal on top of the duration/density scoring: sermons here tend to open with
// a greeting/self-introduction and (often, not always) close with a prayer. These are soft
// multiplicative boosts, not requirements, since neither is guaranteed every week.
const OPENING_WINDOW_SEC = 60;
const OPENING_PATTERNS = [/good\s+(morning|afternoon|evening)/i, /my name('s| is)?\s+\w/i];
const OPENING_BOOST = 1.15;

const CLOSING_WINDOW_SEC = 90;
const CLOSING_PATTERNS = [/\bpray(er|ing)?\b/i, /\bamen\b/i, /in (jesus'?|his) name/i, /father god/i];
const CLOSING_BOOST = 1.08;

function textMatchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

// A repeated-chorus chunk ("Alleluia, alleluia, alleluia...") has very few distinct words
// relative to its length; natural continuous speech - even accounting for common function
// words like "the"/"and" - reads well above this in practice. Chunks with too few words to
// judge reliably are left alone (ratio isn't meaningful on a handful of words).
const REPETITION_MIN_WORDS = 8;
const REPETITION_RATIO_THRESHOLD = 0.35;
const REPETITION_PENALTY = 0.3;

// Below this spectral flatness, the audio itself is tonal/harmonic enough (sustained notes,
// chords) to likely be singing/instruments rather than speech, regardless of transcribed word
// count. Calibrated against synthetic tone (~0.004-0.05) vs. noise (~0.82-0.84); real speech
// and music will fall somewhere in between, so this is a conservative estimate pending
// real-world tuning. `flatness` is optional per chunk - chunks without it (or callers that
// never computed it) are simply not penalized on this signal.
const FLATNESS_MUSIC_THRESHOLD = 0.3;
const FLATNESS_PENALTY = 0.3;

function wordCount(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function uniqueWordRatio(text) {
  const words = (text || '').toLowerCase().match(/[a-z']+/g) || [];
  if (!words.length) return 1;
  return new Set(words).size / words.length;
}

// The count actually used for speech/music classification: raw word count, discounted when the
// text looks like a repeated chorus and/or the audio itself measures as tonal. `skipPenalties`
// disables both discounts - used as a fallback when the full scoring finds nothing at all,
// since a lower-confidence suggestion beats no suggestion.
function effectiveWordCount(chunk, skipPenalties = false) {
  let count = wordCount(chunk.text);
  if (skipPenalties) return count;
  if (count >= REPETITION_MIN_WORDS && uniqueWordRatio(chunk.text) < REPETITION_RATIO_THRESHOLD) {
    count *= REPETITION_PENALTY;
  }
  if (typeof chunk.flatness === 'number' && chunk.flatness < FLATNESS_MUSIC_THRESHOLD) {
    count *= FLATNESS_PENALTY;
  }
  return count;
}

function wordsPerMinute(chunk, skipPenalties = false) {
  const durationMin = (chunk.end - chunk.start) / 60;
  if (durationMin <= 0) return 0;
  return effectiveWordCount(chunk, skipPenalties) / durationMin;
}

function findSermonCandidates(chunks, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!chunks.length) return [];

  const flags = chunks.map((c) => wordsPerMinute(c, opts.skipPenalties) >= opts.minWordsPerMinute);

  const runs = [];
  let runStart = null;
  let lastSpeechIdx = -1;
  let gap = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (flags[i]) {
      if (runStart === null) runStart = i;
      lastSpeechIdx = i;
      gap = 0;
    } else if (runStart !== null) {
      gap++;
      if (gap > opts.maxGapChunks) {
        runs.push([runStart, lastSpeechIdx]);
        runStart = null;
        gap = 0;
      }
    }
  }
  if (runStart !== null) runs.push([runStart, lastSpeechIdx]);

  const candidates = runs.map(([startIdx, endIdx]) => {
    const run = chunks.slice(startIdx, endIdx + 1);
    const start = run[0].start;
    const end = run[run.length - 1].end;
    const durationMin = (end - start) / 60;
    const totalWords = run.reduce((sum, c) => sum + effectiveWordCount(c, opts.skipPenalties), 0);
    const avgWpm = durationMin > 0 ? totalWords / durationMin : 0;

    const durationScore = Math.exp(-((durationMin - opts.idealMinutes) ** 2) / (2 * opts.scoreSigmaMinutes ** 2));
    const wpmScore = Math.min(avgWpm / 130, 1);

    const openingText = run.filter((c) => c.start < start + OPENING_WINDOW_SEC).map((c) => c.text).join(' ');
    const closingText = run.filter((c) => c.end > end - CLOSING_WINDOW_SEC).map((c) => c.text).join(' ');
    const hasOpeningCue = textMatchesAny(openingText, OPENING_PATTERNS);
    const hasClosingCue = textMatchesAny(closingText, CLOSING_PATTERNS);

    const score =
      durationScore * wpmScore * (hasOpeningCue ? OPENING_BOOST : 1) * (hasClosingCue ? CLOSING_BOOST : 1);

    return {
      start,
      end,
      durationSec: end - start,
      avgWpm: Math.round(avgWpm),
      score,
      openingCue: hasOpeningCue,
      closingCue: hasClosingCue,
    };
  });

  return candidates
    .filter((c) => c.durationSec / 60 >= opts.minCandidateMinutes)
    .sort((a, b) => b.score - a.score);
}

module.exports = { findSermonCandidates, wordsPerMinute };
