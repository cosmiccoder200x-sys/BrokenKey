import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARN_LESSONS } from './learn-content.js';
import { LEARN_PROGRESS_KEY, LEGACY_LEARN_PROGRESS_KEY, createInitialProgress, completeLesson, initializeLegacyReviews, loadProgress, saveProgress, rateLessonRecall, normalizeProgress } from './learn-progress.js';
import { buildReviewQueue } from './learn-scheduler.js';
const ids=LEARN_LESSONS.map(x=>x.id);
const now='2026-11-21T12:00:00.000Z';
function storage() {
  const values=new Map();
  return {values,getItem(k){return values.get(k)??null;},setItem(k,v){values.set(k,String(v));}};
}
test('v1 migrates without losing original backup, completions or accuracies',()=>{
  const s=storage();
  const v1={version:1,completedLessonIds:[ids[0],ids[1]],lastAccessedLessonId:ids[1],bestAccuracyByLesson:{[ids[0]]:97,[ids[1]]:83}};
  s.setItem(LEGACY_LEARN_PROGRESS_KEY,JSON.stringify(v1));
  let p=loadProgress(s,ids);
  assert.equal(p.version,2);
  assert.deepEqual(p.completedLessonIds,v1.completedLessonIds);
  assert.deepEqual(p.bestAccuracyByLesson,v1.bestAccuracyByLesson);
  assert.equal(p.lastAccessedLessonId,ids[1]);
  p=initializeLegacyReviews(p,now,ids);
  assert.equal(Object.keys(p.reviewsByLesson).length,2);
  assert.equal(saveProgress(s,p),true);
  assert.equal(s.getItem(LEGACY_LEARN_PROGRESS_KEY),JSON.stringify(v1));
  assert.deepEqual(loadProgress(s,ids),p);
});
test('initial review is scheduled once, repeat completions do not duplicate',()=>{
  let p=completeLesson(createInitialProgress(),ids[0],ids,now);
  p=completeLesson(p,ids[0],ids,'2026-11-22T12:00:00.000Z');
  assert.equal(p.reviewsByLesson[ids[0]].nextReviewAt,now);
  assert.deepEqual(p.completedLessonIds,[ids[0]]);
});
test('ratings persist, update only selected lesson and leave typing accuracy intact',()=>{
  const s=storage();
  let p=completeLesson(createInitialProgress(),ids[0],ids,now);
  p.bestAccuracyByLesson[ids[0]]=92;
  p=rateLessonRecall(p,ids[0],'Good',now,ids);
  assert.equal(p.reviewsByLesson[ids[0]].reviewCount,1);
  assert.equal(p.bestAccuracyByLesson[ids[0]],92);
  assert.equal(saveProgress(s,p),true);
  assert.deepEqual(loadProgress(s,ids),p);
});
test('unknown and duplicate review IDs are discarded, invalid records isolated',()=>{
  let p=completeLesson(createInitialProgress(),ids[0],ids,now);
  p.reviewsByLesson.unknown={...p.reviewsByLesson[ids[0]]};
  p.reviewsByLesson[ids[1]]={nextReviewAt:'not-a-date'};
  const cleaned=normalizeProgress(p,ids);
  assert.deepEqual(Object.keys(cleaned.reviewsByLesson),[ids[0]]);
});
test('malformed v2 falls back to intact v1 without crashing',()=>{
  const s=storage();
  s.setItem(LEARN_PROGRESS_KEY,'{broken');
  s.setItem(LEGACY_LEARN_PROGRESS_KEY,JSON.stringify({version:1,completedLessonIds:[ids[0]],bestAccuracyByLesson:{},lastAccessedLessonId:null}));
  assert.deepEqual(loadProgress(s,ids).completedLessonIds,[ids[0]]);
});
test('unavailable storage recovers and failed writes do not erase v1 backup',()=>{
  const s=storage();
  s.setItem(LEGACY_LEARN_PROGRESS_KEY,JSON.stringify({version:1,completedLessonIds:[ids[0]],bestAccuracyByLesson:{},lastAccessedLessonId:null}));
  const readBroken={getItem(){throw Error('denied');}};
  assert.deepEqual(loadProgress(readBroken,ids),createInitialProgress());
  const writeBroken={setItem(){throw Error('quota');}};
  assert.equal(saveProgress(writeBroken,createInitialProgress()),false);
  assert.ok(s.getItem(LEGACY_LEARN_PROGRESS_KEY));
});
test('due queue handles simultaneous lessons and category filtering safely',()=>{
  let p=createInitialProgress();
  p=completeLesson(p,ids[0],ids,now);
  p=completeLesson(p,ids[2],ids,now);
  const q=buildReviewQueue(p,LEARN_LESSONS,now);
  assert.equal(q.due.length,2);
  const category='databases';
  assert.equal(q.due.filter(x=>x.categoryId===category).length,1);
  assert.equal(buildReviewQueue(p,LEARN_LESSONS,'2026-11-20T12:00:00.000Z').due.length,0);
});
