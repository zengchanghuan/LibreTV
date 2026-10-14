import { describe, expect, it } from 'vitest';
import { PlaybackTracker, qualityScore, qualityLabel, updateQuality, QUALITY_TTL } from './playback-quality';
describe('actual playback quality', () => {
  it('records first frame once and counts active buffering', () => {
    const t = new PlaybackTracker(0); t.playing(1200);
    expect(t.drain(1200).startupMs).toBe(1200);
    t.waiting(11200); t.playing(14200);
    const delta = t.drain(24200);
    expect(delta).toMatchObject({playedMs:20000,stalledMs:3000,stalls:1}); expect(delta.startupMs).toBeUndefined();
  });
  it('excludes user pause, seeks, hidden tabs and autoplay rejection waiting', () => {
    const t = new PlaybackTracker(0); t.pause(100); t.play(60100); t.playing(61100);
    expect(t.drain(61100).startupMs).toBe(1100);
    t.seek(62100,true);t.waiting(62150);t.seek(72100,false);
    t.visibility(73100,true);t.waiting(74000);t.visibility(83000,false);
    t.pause(84000);t.waiting(85000);t.play(94000);t.playing(94000);
    expect(t.drain(95000)).toMatchObject({playedMs:4000,stalledMs:0,stalls:0});
  });
  it('reports buffering on teardown and ignores tiny stalls', () => {
    const t=new PlaybackTracker(0);t.playing(1000);t.drain(1000);t.waiting(5000);t.playing(5100);
    t.waiting(10000);expect(t.drain(13000,true)).toMatchObject({stalledMs:3000,stalls:1,failed:true});
  });
  it('ranks smooth playback above a faster start with frequent stalls', () => {
    const smooth=updateQuality(undefined,{startupMs:3000,playedMs:60000,stalledMs:0,stalls:0},100000);
    const stalling=updateQuality(undefined,{startupMs:700,playedMs:40000,stalledMs:15000,stalls:3},100000);
    expect(qualityScore(smooth,100001)).toBeLessThan(qualityScore(stalling,100001));
    expect(qualityLabel(stalling,100001)).toContain('有卡顿');
  });
  it('expires stale results, penalizes failures and recovers after real playback', () => {
    const failed=updateQuality(undefined,{playedMs:0,stalledMs:0,stalls:0,failed:true},100000);
    expect(qualityScore(failed,100001)).toBeGreaterThan(qualityScore(undefined));
    const good=updateQuality(failed,{startupMs:1000,playedMs:20000,stalledMs:0,stalls:0},100100);
    expect(qualityScore(good,100101)).toBeLessThan(qualityScore(failed,100101));
    expect(qualityScore(good,100101+QUALITY_TTL)).toBe(8000);
  });
  it('labels probing separately from actual first-frame timing', () => {
    const q={at:100000,starts:0,playedMs:0,stalledMs:0,stalls:0,probe:{at:100000,ok:true,ms:500}};
    expect(qualityLabel(q,100001)).toBe('媒体测速 0.5s');
    expect(qualityLabel(q,500001)).toBe('待测速');
  });
});
