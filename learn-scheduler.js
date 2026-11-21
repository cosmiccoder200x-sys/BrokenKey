export const REVIEW_RATINGS = Object.freeze(['Again', 'Hard', 'Good', 'Easy']);
export const DEFAULT_REVIEW_CONFIG = Object.freeze({
  initialMinutes: 10,
  hardMinutes: 60,
  firstGoodDays: 1,
  firstEasyDays: 4,
  maxIntervalDays: 365,
  minEase: 1.3,
  maxEase: 3.5
});
const DAY_MS = 86400000;
const MINUTE_MS = 60000;

export function toTimestamp(value) {
  const millis = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isFinite(millis) || millis < 0 || millis > 8640000000000000) throw new RangeError('Invalid timestamp');
  return millis;
}
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function configWithDefaults(options = {}) {
  const config = { ...DEFAULT_REVIEW_CONFIG, ...options };
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Invalid review configuration: ' + key);
  }
  if (config.maxEase < config.minEase) throw new RangeError('maxEase must be >= minEase');
  return config;
}
export function createReviewRecord(now, options = {}) {
  const timestamp = toTimestamp(now);
  configWithDefaults(options);
  return {
    repetitions: 0,
    intervalMinutes: 0,
    easeFactor: 2.5,
    lastReviewedAt: null,
    nextReviewAt: new Date(timestamp).toISOString(),
    failedAttempts: 0,
    reviewCount: 0,
    lastRating: null
  };
}
export function scheduleReview(previous, rating, now, options = {}) {
  if (!REVIEW_RATINGS.includes(rating)) throw new RangeError('Unknown recall rating');
  const config = configWithDefaults(options);
  const timestamp = toTimestamp(now);
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new TypeError('Invalid review record');
  const reps = previous.repetitions, interval = previous.intervalMinutes, ease = previous.easeFactor;
  if (!Number.isSafeInteger(reps) || reps < 0 || !Number.isFinite(interval) || interval < 0 ||
      !Number.isFinite(ease) || ease < config.minEase ||
      !Number.isSafeInteger(previous.reviewCount) || previous.reviewCount < 0 ||
      !Number.isSafeInteger(previous.failedAttempts) || previous.failedAttempts < 0) {
    throw new RangeError('Invalid review record values');
  }
  const maxMinutes = config.maxIntervalDays * 1440;
  let repetitions = reps;
  let easeFactor = ease;
  let intervalMinutes;
  let failedAttempts = previous.failedAttempts;
  switch (rating) {
    case 'Again':
      repetitions = 0;
      failedAttempts += 1;
      easeFactor = clamp(ease - 0.2, config.minEase, config.maxEase);
      intervalMinutes = config.initialMinutes;
      break;
    case 'Hard':
      repetitions += 1;
      easeFactor = clamp(ease - 0.15, config.minEase, config.maxEase);
      intervalMinutes = reps === 0 ? config.hardMinutes : Math.max(config.hardMinutes, interval * 1.2);
      break;
    case 'Good':
      repetitions += 1;
      intervalMinutes = reps === 0 ? config.firstGoodDays * 1440 :
        reps === 1 ? Math.max(config.firstGoodDays * 1440, interval * 3) : interval * easeFactor;
      break;
    case 'Easy':
      repetitions += 1;
      easeFactor = clamp(ease + 0.15, config.minEase, config.maxEase);
      intervalMinutes = reps === 0 ? config.firstEasyDays * 1440 : Math.max(config.firstEasyDays * 1440, interval * easeFactor * 1.3);
      break;
  }
  intervalMinutes = clamp(Math.round(intervalMinutes), 1, maxMinutes);
  return {
    repetitions,
    intervalMinutes,
    easeFactor: Math.round(easeFactor * 100) / 100,
    lastReviewedAt: new Date(timestamp).toISOString(),
    nextReviewAt: new Date(timestamp + intervalMinutes * MINUTE_MS).toISOString(),
    failedAttempts,
    reviewCount: previous.reviewCount + 1,
    lastRating: rating
  };
}
export function deriveMastery(record) {
  if (!record) return 'New';
  if (record.reviewCount === 0) return 'Learning';
  if (record.lastRating === 'Again') return 'Needs Attention';
  if (record.reviewCount >= 3 && record.repetitions >= 3 && record.intervalMinutes >= 14 * 1440) return 'Strong';
  if (record.repetitions >= 2 && record.intervalMinutes >= 3 * 1440) return 'Developing';
  return 'Reviewing';
}
export function buildReviewQueue(progress, lessons, now) {
  const timestamp = toTimestamp(now);
  const records = progress?.reviewsByLesson || {};
  const due = [], upcoming = [];
  for (const lesson of lessons) {
    const record = records[lesson.id];
    if (!record) continue;
    const next = Date.parse(record.nextReviewAt);
    if (!Number.isFinite(next)) continue;
    const item = { lessonId: lesson.id, title: lesson.title, categoryId: lesson.categoryId, nextReviewAt: record.nextReviewAt, mastery: deriveMastery(record), failedAttempts: record.failedAttempts };
    if (next <= timestamp) due.push(item);
    else upcoming.push(item);
  }
  due.sort((a,b) => Date.parse(a.nextReviewAt)-Date.parse(b.nextReviewAt) || a.lessonId.localeCompare(b.lessonId));
  upcoming.sort((a,b) => Date.parse(a.nextReviewAt)-Date.parse(b.nextReviewAt) || a.lessonId.localeCompare(b.lessonId));
  return { due, upcoming };
}
export function getReviewStats(progress, lessons, now) {
  const { due, upcoming } = buildReviewQueue(progress, lessons, now);
  const records = progress?.reviewsByLesson || {};
  const distribution = { New: 0, Learning: 0, Reviewing: 0, Developing: 0, Strong: 0, 'Needs Attention': 0 };
  let reviewsCompleted = 0;
  for (const lesson of lessons) {
    const record = records[lesson.id];
    distribution[deriveMastery(record)] += 1;
    reviewsCompleted += record?.reviewCount || 0;
  }
  return { dueCount: due.length, upcomingCount: upcoming.length, reviewsCompleted, distribution };
}
