/**
 * Turns a sermon transcript into a handful of short title suggestions, without sending anything
 * anywhere. No model, no API key - just the words that were actually said.
 *
 * The method is deliberately plain, and it works theme first. A sermon says what it is about out
 * loud and keeps coming back to it, so the words that carry its themes are the ones that are both
 * frequent and spread right across it - a word used throughout is a theme, where a word used
 * heavily for one minute is an anecdote. Those themes are ranked, and each one is given a
 * suggestion of its own: a real phrase, said in the sermon, containing that word. Taking the best
 * phrase per theme rather than the best phrases overall is what stops the list being seven
 * rewordings of whichever sentence the preacher happened to repeat most. Scripture the passage
 * keeps naming is treated as a theme of its own.
 *
 * Nothing here is invented: every suggestion is words that were actually said, in the order they
 * were said in. It is a thematic choice among real phrases, not a generated sentence.
 *
 * This will never write as well as a person would. It is meant to be a starting point that is
 * usually in the right territory, not a finished title, which is why the app offers several and
 * lets you cycle rather than filling the field in for you.
 */

// Words that carry no topic on their own. A phrase made only of these is noise; one that merely
// contains them (e.g. "the heart of worship") is fine, and often better English than without.
const STOPWORDS = new Set(`
a about actually after again all also am an and another any are as at back be because been before
being but by came can cant come comes coming could couldnt did didnt do does doesnt doing dont down
each even ever every for from get gets getting go goes going gone good got had hadnt has hasnt have
havent having he her here hers herself him himself his how i if im in into is isnt it its itself
just kind know known let lets like little look looking lot made make makes making many may maybe me
mean means might mine more most much must my myself never new no nor not now of off oh ok okay on
once one only or other our ours out over own people put really right said same saw say says see
seen shall she should shouldnt so some something sort still such sure take than that thats the
their theirs them themselves then there these they thing things think this those though thought
through time to today together too took turn two up upon us use used very want was wasnt way we
well went were what when where which while who whom why will with within without wont would
wouldnt yeah yes yet you your yours yourself
`.trim().split(/\s+/));

// Sermon-specific filler. These recur constantly and would otherwise dominate, but they describe
// the act of preaching rather than what is being preached.
// Note what is NOT here: "brother", "father", "son" and the like. They look like forms of address
// and they are, half the time - but they are also what half the parables are about, and excluding
// "brother" quietly cost a sermon on the prodigal son its entire second half.
const SERMON_FILLER = new Set(`
amen bible chapter church congregation friends morning scripture sermon verse verses
pastor passage preaching read reading says text today together turn week sunday
`.trim().split(/\s+/));

// A title can open with one of these and still read as a title - "the father ran", "by grace you
// have been saved" - so a phrase starting with one is kept as long as a real word follows.
const LEADING_WORDS = new Set(`
a an the my our your his her their
by in for from with through without into
`.trim().split(/\s+/));

// Words that give away a phrase as the middle of a sentence rather than a whole thought. "love with
// which he loved" is a grammatical offcut, not a title.
const MID_SENTENCE = new Set(`
that which who whom whose because though although unless whether therefore but than
according regarding concerning including instead anyway maybe probably basically
cant dont didnt doesnt isnt wasnt arent werent hasnt havent wont wouldnt couldnt shouldnt
yeah okay ok oh um uh
`.trim().split(/\s+/));

// Fine at the front of a title, a seam anywhere else. "What God Requires" is a title; "Ask what am
// I supposed" is the middle of a sentence someone was quoting.
const OPENERS_ONLY = new Set(`
what how why when where whenever however if i am
`.trim().split(/\s+/));

// A title cannot end on a word that is still waiting for the rest of its sentence. "Ask What Am I
// Supposed" ends mid-thought; so would "Dead in Your Trespasses Trying".
const CANNOT_END = new Set(`
supposed going trying able willing meant used gonna wanna
talking saying telling asking wondering thinking looking
hammering pointing bringing holding keeping putting showing giving taking making
`.trim().split(/\s+/));

const BOOKS_OF_THE_BIBLE = `
genesis exodus leviticus numbers deuteronomy joshua judges ruth samuel kings chronicles ezra
nehemiah esther job psalm psalms proverbs ecclesiastes song isaiah jeremiah lamentations ezekiel
daniel hosea joel amos obadiah jonah micah nahum habakkuk zephaniah haggai zechariah malachi
matthew mark luke john acts romans corinthians galatians ephesians philippians colossians
thessalonians timothy titus philemon hebrews james peter jude revelation
`.trim().split(/\s+/);

// Three, not two. Two-word phrases were tried and made the list worse rather than longer: they
// add no themes the three-word ones miss, and being shorter they score above the fuller phrase
// and then crowd it out - "Older Brother" winning over "The Older Brother", which is the title
// anyone would actually write.
const MIN_WORDS = 3;
const MAX_WORDS = 6;
const MAX_SUGGESTIONS = 10;
// How few real suggestions it takes before the weaker, said-once candidates are worth offering.
const MIN_BEFORE_GUESSING = 6;
// A theme is a word the sermon keeps returning to across the whole of it. Measuring "across the
// whole of it" means cutting the transcript into stretches and counting how many a word turns up
// in - ten is enough to tell a theme from a story told once at length.
const SPREAD_BUCKETS = 10;

// Stands in for the end of a sentence once the punctuation itself is gone. Phrases are not allowed
// to run across one: "...gave it to his son. Now Jesus says..." is two thoughts, and the words
// where they meet were never said together.
const BREAK = '\u0000';

function normalise(transcript) {
  return String(transcript || '')
    .toLowerCase()
    // Timestamps and bracketed annotations whisper sometimes leaves behind.
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.?!;:\n]+/g, ` ${BREAK} `)
    .replace(new RegExp(`[^a-z0-9'\\s${BREAK}]`, 'g'), ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isContentWord(word) {
  return word.length > 2 && !STOPWORDS.has(word) && !SERMON_FILLER.has(word);
}

/** Is this run of words shaped like a title rather than a slice out of the middle of a sentence? */
function readsAsTitle(phrase) {
  if (phrase.includes(BREAK)) return false;
  // "I Am the Bread of Life" and the rest of John's I AM sayings are the one place a second-word
  // opener belongs, and they get preached often enough to be worth the exception.
  const isIAm = (word, i) => i === 1 && word === 'am' && phrase[0] === 'i';
  if (phrase.some((word, i) => i > 0 && OPENERS_ONLY.has(word) && !isIAm(word, i))) return false;
  const last = phrase[phrase.length - 1];
  if (CANNOT_END.has(last)) return false;
  // Must end on something meaningful - "the kingdom of God" reads as a title, "of the kingdom of"
  // does not.
  if (!isContentWord(last)) return false;
  // It can open on a real word, or on an article or possessive that introduces one.
  if (!isContentWord(phrase[0]) && !(LEADING_WORDS.has(phrase[0]) && isContentWord(phrase[1]))) {
    return false;
  }
  // Must carry at least two ideas, or it is one word padded out with filler.
  const content = phrase.filter(isContentWord);
  if (content.length < 2) return false;
  // "Luke chapter fifteen Luke" - a word coming round twice is a seam, not a title.
  if (new Set(content).size !== content.length) return false;
  return !phrase.some((word) => MID_SENTENCE.has(word));
}

/** Counts every n-word run, for n across the title lengths worth offering. */
function countPhrases(words) {
  const counts = new Map();
  for (let n = MIN_WORDS; n <= MAX_WORDS; n += 1) {
    for (let i = 0; i + n <= words.length; i += 1) {
      const phrase = words.slice(i, i + n);
      if (!readsAsTitle(phrase)) continue;
      const key = phrase.join(' ');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Drops phrases that only ever appeared inside a longer one. If "grace you have been saved" turns up
 * exactly as often as "by grace you have been saved", the short one is not its own phrase - it is
 * the long one with the front chopped off, and the preacher said the whole thing.
 */
function dropTruncations(repeated) {
  // Only phrases said exactly as often can be the same phrase, so compare within those groups
  // rather than across the whole transcript.
  const byCount = new Map();
  for (const [phrase, count] of repeated) {
    if (!byCount.has(count)) byCount.set(count, []);
    byCount.get(count).push(phrase);
  }
  const kept = new Map();
  for (const [phrase, count] of repeated) {
    const swallowed = byCount.get(count).some((other) => (
      other.length > phrase.length
      && (other.startsWith(`${phrase} `) || other.endsWith(` ${phrase}`) || other.includes(` ${phrase} `))
    ));
    if (!swallowed) kept.set(phrase, count);
  }
  return kept;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

function titleCase(phrase) {
  return phrase
    .split(' ')
    .map((word, i, all) => {
      if (i !== 0 && i !== all.length - 1 && SMALL_WORDS.has(word)) return word;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * How much two candidates say the same thing, judged on their real words only - "God is rich" and
 * "rich in mercy" are one idea twice, even though only a third of their words match.
 */
function overlapsWith(candidate, chosen, { looseness }) {
  if (candidate.includes(chosen) || chosen.includes(candidate)) return true;
  const a = new Set(candidate.split(' ').filter(isContentWord));
  const b = new Set(chosen.split(' ').filter(isContentWord));
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared >= Math.max(1, Math.ceil(Math.min(a.size, b.size) * looseness));
}

/**
 * The words this sermon is about, strongest first.
 *
 * Frequency alone picks up whatever the longest story in the sermon was about. What separates a
 * theme from an anecdote is that the preacher keeps coming back to it, so a word's weight is how
 * often it was said multiplied by how much of the sermon it was said across. A word spread over
 * eight stretches of ten beats one said twice as often but all in the same two.
 */
function themeWords(words) {
  const bucketSize = Math.max(1, Math.ceil(words.length / SPREAD_BUCKETS));
  const stats = new Map();
  words.forEach((word, i) => {
    if (!isContentWord(word)) return;
    if (!stats.has(word)) stats.set(word, { count: 0, buckets: new Set() });
    const entry = stats.get(word);
    entry.count += 1;
    entry.buckets.add(Math.floor(i / bucketSize));
  });
  return [...stats.entries()]
    // Said once in one place is not a theme, whatever else is true of it.
    .filter(([, { count }]) => count > 1)
    .map(([word, { count, buckets }]) => ({ word, weight: count * Math.sqrt(buckets.size) }))
    .sort((a, b) => b.weight - a.weight)
    .map(({ word }) => word);
}

/**
 * Returns up to ten suggestions, best first. Fewer if the transcript is too thin to get that many
 * distinct ones - the caller shows what it gets rather than padding with rubbish.
 */
function suggestTitles(transcript) {
  const text = normalise(transcript);
  if (!text) return [];
  const words = text.split(' ');

  const allPhrases = countPhrases(words);
  const repeated = [...allPhrases].filter(([, count]) => count > 1);
  const scored = [...dropTruncations(repeated)]
    .map(([phrase, count]) => {
      const parts = phrase.split(' ');
      const contentWords = parts.filter(isContentWord).length;
      // Repetition is the main signal; a little weight for phrases carrying more than one idea,
      // and a nudge toward the 3-4 word titles that read best.
      const lengthBonus = parts.length <= 4 ? 1.15 : parts.length === 5 ? 1 : 0.85;
      return { phrase, score: count * (1 + contentWords * 0.35) * lengthBonus };
    })
    .sort((a, b) => b.score - a.score);

  // One suggestion per theme, strongest theme first: the best real phrase the sermon said about
  // it. Going theme by theme rather than straight down the list of phrases is what makes the ten
  // suggestions ten different angles on the sermon instead of one sentence worded ten ways.
  const chosen = [];
  for (const theme of themeWords(words)) {
    if (chosen.length >= MAX_SUGGESTIONS) break;
    const best = scored.find(({ phrase }) => (
      phrase.split(' ').includes(theme)
      && !chosen.includes(phrase)
      && !chosen.some((existing) => overlapsWith(phrase, existing, { looseness: 0.5 }))
    ));
    if (best) chosen.push(best.phrase);
  }

  // Then anything strong that no theme happened to claim. The first pass takes only the clearly
  // distinct ones; the second accepts near neighbours rather than leaving the list short.
  for (const looseness of [0.5, 1]) {
    for (const { phrase } of scored) {
      if (chosen.length >= MAX_SUGGESTIONS) break;
      if (chosen.includes(phrase)) continue;
      if (chosen.some((existing) => overlapsWith(phrase, existing, { looseness }))) continue;
      chosen.push(phrase);
    }
  }

  // Not every sermon repeats itself, and a short clip gives less to repeat - which left this
  // offering two suggestions where seven were asked for. So when the repeated phrases run out,
  // phrases said only once are allowed in, judged by how central their words are to the sermon
  // as a whole rather than by their own repetition. A phrase built from the words this sermon
  // keeps coming back to is still about the sermon.
  //
  // Only up to a handful, though, and never to fill all seven: these are the weakest candidates
  // this makes, and seven suggestions with a clunker at number five is worse than four good ones.
  // Seven is a limit, not a quota.
  if (chosen.length < MIN_BEFORE_GUESSING) {
    const wordCounts = new Map();
    for (const word of words) {
      if (isContentWord(word)) wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
    const onceOnly = [...allPhrases]
      .filter(([, count]) => count === 1)
      .map(([phrase]) => {
        const content = phrase.split(' ').filter(isContentWord);
        const counts = content.map((word) => wordCounts.get(word) || 0);
        return { phrase, weakest: Math.min(...counts), score: counts.reduce((a, b) => a + b, 0) / content.length };
      })
      // Every word in it has to be one the sermon actually dwells on, or this picks up a passing
      // aside that happens to sit next to a common word.
      .filter(({ weakest }) => weakest >= 3)
      .sort((a, b) => b.score - a.score);

    for (const { phrase } of onceOnly) {
      if (chosen.length >= MIN_BEFORE_GUESSING) break;
      if (chosen.some((existing) => overlapsWith(phrase, existing, { looseness: 0.5 }))) continue;
      chosen.push(phrase);
    }
  }

  // Scripture the sermon keeps returning to, if there is room left - a recognisable fallback
  // when the wording itself is too varied to repeat a phrase.
  if (chosen.length < MAX_SUGGESTIONS) {
    const bookCounts = new Map();
    for (const book of BOOKS_OF_THE_BIBLE) {
      const hits = words.filter((w) => w === book).length;
      if (hits > 2) bookCounts.set(book, hits);
    }
    for (const [book] of [...bookCounts.entries()].sort((a, b) => b[1] - a[1])) {
      if (chosen.length >= MAX_SUGGESTIONS) break;
      const candidate = `a study in ${book}`;
      if (!chosen.some((existing) => overlapsWith(candidate, existing, { looseness: 1 }))) {
        chosen.push(candidate);
      }
    }
  }

  return chosen.map(titleCase);
}

module.exports = { suggestTitles, MAX_SUGGESTIONS };
