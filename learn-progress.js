import { createReviewRecord, scheduleReview, REVIEW_RATINGS } from './learn-scheduler.js';

export const LEARN_PROGRESS_KEY = 'brokenkey.learn-progress.v2';
export const LEGACY_LEARN_PROGRESS_KEY = 'brokenkey.learn-progress.v1';
export const LEARN_PROGRESS_VERSION = 2;

export function createInitialProgress() {
  return {
    version: LEARN_PROGRESS_VERSION,
    completedLessonIds: [],
    lastAccessedLessonId: null,
    bestAccuracyByLesson: {},
    reviewsByLesson: {}
  };
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validTimestamp(value, nullable = false) {
  return nullable && value === null || typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}
function normalizeRecord(value) {
  if (!isObject(value)) return null;
  const keys = ['repetitions', 'intervalMinutes', 'easeFactor', 'failedAttempts', 'reviewCount'];
  if (keys.some((key) => !Number.isFinite(value[key]) || value[key] < 0)) return null;
  if (!Number.isSafeInteger(value.repetitions) || !Number.isSafeInteger(value.failedAttempts) || !Number.isSafeInteger(value.reviewCount)) return null;
  if (value.easeFactor < 1.3 || value.easeFactor > 3.5 || value.intervalMinutes > 365*1440) return null;
  if (!validTimestamp(value.nextReviewAt) || !validTimestamp(value.lastReviewedAt,true)) return null;
  if (value.lastRating !== null && !REVIEW_RATINGS.includes(value.lastRating)) return null;
  if (value.reviewCount === 0 && value.lastReviewedAt !== null) return null;
  return {
    repetitions: value.repetitions,
    intervalMinutes: value.intervalMinutes,
    easeFactor: value.easeFactor,
    failedAttempts: value.failedAttempts,
    reviewCount: value.reviewCount,
    lastReviewedAt: value.lastReviewedAt,
    nextReviewAt: value.nextReviewAt,
    lastRating: value.lastRating
  };
}

export function normalizeProgress(value, validLessonIds = []) {
  const initial = createInitialProgress();
  const validIds = new Set(validLessonIds);
  if (!isObject(value) || ![1,LEARN_PROGRESS_VERSION].includes(value.version)) return initial;
  const completedLessonIds = Array.isArray(value.completedLessonIds)
    ? [...new Set(value.completedLessonIds.filter((id) => typeof id === 'string' && validIds.has(id)))]
    : [];
  const bestAccuracyByLesson = {};
  if (isObject(value.bestAccuracyByLesson)) {
    Object.entries(value.bestAccuracyByLesson).forEach(([id, accuracy]) => {
      if (!validIds.has(id) || typeof accuracy !== 'number' || !Number.isFinite(accuracy)) return;
      bestAccuracyByLesson[id] = Math.max(0, Math.min(100, accuracy));
    });
  }
  const reviewsByLesson = {};
  if (value.version === LEARN_PROGRESS_VERSION && isObject(value.reviewsByLesson)) {
    Object.entries(value.reviewsByLesson).forEach(([id, review]) => {
      if (!validIds.has(id)) return;
      const normalized = normalizeRecord(review);
      if (normalized) reviewsByLesson[id] = normalized;
    });
  }
  return {
    version: LEARN_PROGRESS_VERSION,
    completedLessonIds,
    lastAccessedLessonId: validIds.has(value.lastAccessedLessonId) ? value.lastAccessedLessonId : null,
    bestAccuracyByLesson,
    reviewsByLesson
  };
}
export function parseProgress(serialized, validLessonIds = []) {
  if (typeof serialized !== 'string' || serialized.length === 0) return createInitialProgress();
  try { return normalizeProgress(JSON.parse(serialized),validLessonIds); }
  catch { return createInitialProgress(); }
}
export function loadProgress(storage, validLessonIds = []) {
  if (!storage) return createInitialProgress();
  try {
    const newer = storage.getItem(LEARN_PROGRESS_KEY);
    if (newer) {
      try {
        const decoded = JSON.parse(newer);
        if (isObject(decoded) && decoded.version === LEARN_PROGRESS_VERSION) return normalizeProgress(decoded,validLessonIds);
      } catch { /* Fall back to intact v1 data. */ }
    }
    const legacy = storage.getItem(LEGACY_LEARN_PROGRESS_KEY);
    if (legacy) return parseProgress(legacy,validLessonIds);
    return createInitialProgress();
  } catch { return createInitialProgress(); }
}
export function saveProgress(storage, progress) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(LEARN_PROGRESS_KEY,JSON.stringify(progress));
    return true;
  } catch { return false; }
}
export function setLastAccessed(progress, lessonId, validLessonIds = []) {
  const next = normalizeProgress(progress,validLessonIds);
  if (new Set(validLessonIds).has(lessonId)) next.lastAccessedLessonId = lessonId;
  return next;
}
export function recordLessonAccuracy(progress, lessonId, accuracy, validLessonIds = []) {
  const next = normalizeProgress(progress,validLessonIds);
  if (!new Set(validLessonIds).has(lessonId)) return next;
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy)) return next;
  next.bestAccuracyByLesson[lessonId] = Math.max(next.bestAccuracyByLesson[lessonId] || 0, Math.max(0,Math.min(100,accuracy)));
  next.lastAccessedLessonId = lessonId;
  return next;
}
export function completeLesson(progress, lessonId, validLessonIds = [], now = Date.now()) {
  const next = normalizeProgress(progress,validLessonIds);
  if (!new Set(validLessonIds).has(lessonId)) return next;
  if (!next.completedLessonIds.includes(lessonId)) next.completedLessonIds.push(lessonId);
  if (!next.reviewsByLesson[lessonId]) next.reviewsByLesson[lessonId] = createReviewRecord(now);
  next.lastAccessedLessonId = lessonId;
  return next;
}
export function rateLessonRecall(progress, lessonId, rating, now, validLessonIds = []) {
  const next = normalizeProgress(progress,validLessonIds);
  if (!new Set(validLessonIds).has(lessonId)) return next;
  const prior = next.reviewsByLesson[lessonId] || createReviewRecord(now);
  next.reviewsByLesson[lessonId] = scheduleReview(prior,rating,now);
  next.lastAccessedLessonId = lessonId;
  return next;
}
export function initializeLegacyReviews(progress, now, validLessonIds = []) {
  const next = normalizeProgress(progress, validLessonIds);
  for (const id of next.completedLessonIds) {
    if (!next.reviewsByLesson[id]) next.reviewsByLesson[id] = createReviewRecord(now);
  }
  return next;
}
export function getProgressSummary(progress, validLessonIds = []) {
  const normalized = normalizeProgress(progress,validLessonIds);
  const total = validLessonIds.length, completed = normalized.completedLessonIds.length;
  return {total,completed,remaining:Math.max(0,total-completed),percentage:total===0?0:Math.round(completed/total*100)};
}
