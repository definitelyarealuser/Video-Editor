/**
 * Turns per-chunk transcript text into a ranked list of candidate sermon
 * windows. No ML here - just word-density heuristics over fixed-size chunks:
 * singing/music produces sparse, garbled, or repetitive transcription (low
 * words-per-minute), while a sermon is a long, sustained run of normal-paced
 * speech. Short "talking head" segments look similar to a sermon in density
 * but are filtered out by scoring candidates against a target duration
 * window instead of just picking the longest run.
 */

const DEFAULT_OPTIONS = {
  minWordsPerMinute: 60, // below this, a chunk is treated as non-speech (music/silence/crowd noise)
  maxGapChunks: 2, // tolerate up to this many consecutive weak chunks mid-run (a pause, a Scripture reading in a hushed voice, etc.) without splitting it
  idealMinutes: 25, // typical sermon length to score candidates against
  scoreSigmaMinutes: 12, // how forgiving the duration scoring is around idealMinutes
  minCandidateMinutes: 5, // ignore runs shorter than this outright
};

function wordsPerMinute(chunk) {
  const durationMin = (chunk.end - chunk.start) / 60;
  if (durationMin <= 0) return 0;
  const wordCount = chunk.text ? chunk.text.split(/\s+/).filter(Boolean).length : 0;
  return wordCount / durationMin;
}

function findSermonCandidates(chunks, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!chunks.length) return [];

  const flags = chunks.map((c) => wordsPerMinute(c) >= opts.minWordsPerMinute);

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
    const totalWords = run.reduce((sum, c) => sum + (c.text ? c.text.split(/\s+/).filter(Boolean).length : 0), 0);
    const avgWpm = durationMin > 0 ? totalWords / durationMin : 0;

    const durationScore = Math.exp(-((durationMin - opts.idealMinutes) ** 2) / (2 * opts.scoreSigmaMinutes ** 2));
    const wpmScore = Math.min(avgWpm / 130, 1);
    const score = durationScore * wpmScore;

    return { start, end, durationSec: end - start, avgWpm: Math.round(avgWpm), score };
  });

  return candidates
    .filter((c) => c.durationSec / 60 >= opts.minCandidateMinutes)
    .sort((a, b) => b.score - a.score);
}

module.exports = { findSermonCandidates, wordsPerMinute };
