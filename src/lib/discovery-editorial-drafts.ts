import { deepSeekConfigured, deepSeekRecommendations } from './deepseek-recommendations';
import { catalogIdentity } from './recommendation-catalog';
import { publishedEditorial } from './discovery-editorial';
import { discoveryTransaction } from './discovery-storage';
interface Drafts { week: string; attempts: number; generatedAt?: string; candidates: { title: string; year: string; reason: string }[] }
/** Public seed metadata only. Drafts live outside the serving manifest and require human review. */
export async function warmEditorialDraft() {
  if (!deepSeekConfigured()) return;
  const issue = publishedEditorial()[0]; if (!issue?.works.length) return;
  const claimed = await discoveryTransaction<Drafts, boolean>('editorial-draft', () => ({ week: '', attempts: 0, candidates: [] }), d => {
    if (d.week !== issue.publishedAt) Object.assign(d, { week: issue.publishedAt, attempts: 0, candidates: [], generatedAt: undefined });
    if (d.attempts >= 2 || d.generatedAt) return false;
    d.attempts++; return true;
  }, true);
  if (!claimed) return;
  try {
    const candidates = await deepSeekRecommendations(issue.works[0], true, AbortSignal.timeout(28000));
    const verified = candidates.flatMap(candidate => {
      const known = catalogIdentity(candidate); return known && candidate.aiReason ? [{ title: known.title, year: known.year, reason: candidate.aiReason }] : [];
    });
    await discoveryTransaction<Drafts, void>('editorial-draft', () => ({ week: issue.publishedAt, attempts: 1, candidates: [] }), d => {
      if (d.week === issue.publishedAt && verified.length) { d.candidates = verified; d.generatedAt = new Date().toISOString(); }
    }, true);
  } catch { /* Already-published selections remain available. */ }
}
