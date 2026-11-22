import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewRecord, scheduleReview, deriveMastery, buildReviewQueue, getReviewStats, toTimestamp } from './learn-scheduler.js';
const t = '2026-11-21T12:00:00.000Z';
const lessons = [{id:'a', title:'A', categoryId:'db'}, {id:'b',title:'B',categoryId:'api'}];
test('new lesson starts due and first review is deterministic', () => {
  const initial = createReviewRecord(t);
  assert.equal(initial.nextReviewAt,t);
  const good = scheduleReview(initial,'Good',t);
  assert.equal(good.nextReviewAt,'2026-11-22T12:00:00.000Z');
  assert.equal(good.repetitions,1);
  assert.equal(good.reviewCount,1);
  assert.deepEqual(good,scheduleReview(initial,'Good',t));
});
test('Again retries sooner and tracks failures',()=>{
  const good=scheduleReview(createReviewRecord(t),'Good',t);
  const again=scheduleReview(good,'Again',t);
  assert.equal(again.intervalMinutes,10);
  assert.equal(again.repetitions,0);
  assert.equal(again.failedAttempts,1);
  assert.equal(deriveMastery(again),'Needs Attention');
});
test('Hard, Good and Easy produce increasing first intervals',()=>{
  const start=createReviewRecord(t);
  const intervals=['Hard','Good','Easy'].map(x=>scheduleReview(start,x,t).intervalMinutes);
  assert.ok(intervals[0]<intervals[1] && intervals[1]<intervals[2]);
});
test('successful reviews progress and easy is longer than good',()=>{
  let r=createReviewRecord(t);
  r=scheduleReview(r,'Good',t);
  const good=scheduleReview(r,'Good',t);
  const easy=scheduleReview(r,'Easy',t);
  assert.ok(easy.intervalMinutes>good.intervalMinutes);
  const third=scheduleReview(good,'Good',t);
  assert.ok(third.intervalMinutes>good.intervalMinutes);
});
test('ease factor floor and interval ceiling enforced',()=>{
  let r=createReviewRecord(t);
  for(let i=0;i<50;i++) r=scheduleReview(r,'Hard',t);
  assert.equal(r.easeFactor,1.3);
  r=createReviewRecord(t);
  for(let i=0;i<25;i++) r=scheduleReview(r,'Easy',t);
  assert.ok(r.intervalMinutes<=365*1440);
  assert.ok(r.easeFactor<=3.5);
});
test('invalid ratings, timestamps and records are rejected',()=>{
  assert.throws(()=>scheduleReview(createReviewRecord(t),'Unknown',t));
  assert.throws(()=>createReviewRecord('broken'));
  assert.throws(()=>toTimestamp(Infinity));
  assert.throws(()=>scheduleReview({repetitions:-1},'Good',t));
});
test('clock boundary and exact due timestamp',()=>{
  const record=createReviewRecord('2026-12-31T23:55:00.000Z');
  const retry=scheduleReview(record,'Again','2026-12-31T23:55:00.000Z');
  assert.equal(retry.nextReviewAt,'2027-01-01T00:05:00.000Z');
  const progress={ reviewsByLesson:{a:retry} };
  assert.equal(buildReviewQueue(progress,lessons,'2027-01-01T00:04:59.999Z').due.length,0);
  assert.equal(buildReviewQueue(progress,lessons,'2027-01-01T00:05:00.000Z').due.length,1);
});
test('queue sorts overdue and upcoming, ignores unknown ids',()=>{
  const p={ reviewsByLesson:{a:createReviewRecord(t),b:createReviewRecord('2026-11-20T12:00:00.000Z'),fake:createReviewRecord(t)} };
  const q=buildReviewQueue(p,lessons,t);
  assert.deepEqual(q.due.map(x=>x.lessonId),['b','a']);
  assert.equal(q.upcoming.length,0);
  assert.equal(getReviewStats(p,lessons,t).dueCount,2);
});
test('mastery derives from actual review history',()=>{
  assert.equal(deriveMastery(null),'New');
  assert.equal(deriveMastery(createReviewRecord(t)),'Learning');
  let r=createReviewRecord(t);
  for(let i=0;i<4;i++)r=scheduleReview(r,'Easy',t);
  assert.equal(deriveMastery(r),'Strong');
});
