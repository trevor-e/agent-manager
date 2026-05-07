import { db } from '../src/db.ts';

const days = Number(process.argv[2] ?? 2);
if (!Number.isFinite(days) || days <= 0) {
  console.error(`usage: pnpm bulk-done <days>   (got: ${process.argv[2]})`);
  process.exit(1);
}

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const now = Date.now();

const preview = db
  .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_status = 'active' AND last_event_at < ?`)
  .get(cutoff) as { n: number };

const result = db
  .prepare(
    `UPDATE sessions
        SET user_status = 'done', updated_at = ?
      WHERE user_status = 'active'
        AND last_event_at < ?`
  )
  .run(now, cutoff);

console.log(`Marked ${result.changes} session${result.changes === 1 ? '' : 's'} as done`);
console.log(`  cutoff: ${new Date(cutoff).toISOString()} (${days} day${days === 1 ? '' : 's'} ago)`);
console.log(`  matched count (preview): ${preview.n}`);
