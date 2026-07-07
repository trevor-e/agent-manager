import { describe, it, expect } from 'vitest';
import { parsePorcelainZ, parseNumstat, formatAddOnlyDiff, clampDiff, isBinary } from './git.ts';

describe('parsePorcelainZ', () => {
  it('parses a plain modified file', () => {
    const entries = parsePorcelainZ(' M file.txt\0');
    expect(entries).toEqual([{ path: 'file.txt', oldPath: null, status: 'M' }]);
  });

  it('parses a staged addition', () => {
    const entries = parsePorcelainZ('A  new.txt\0');
    expect(entries).toEqual([{ path: 'new.txt', oldPath: null, status: 'A' }]);
  });

  it('parses a deletion', () => {
    const entries = parsePorcelainZ(' D gone.txt\0');
    expect(entries).toEqual([{ path: 'gone.txt', oldPath: null, status: 'D' }]);
  });

  it('parses an untracked file without consuming a following token as its rename source', () => {
    const entries = parsePorcelainZ('?? untracked.txt\0M  other.txt\0');
    expect(entries).toEqual([
      { path: 'untracked.txt', oldPath: null, status: '??' },
      { path: 'other.txt', oldPath: null, status: 'M' },
    ]);
  });

  it('parses a rename, consuming the following token as the old path', () => {
    const entries = parsePorcelainZ('R  new.txt\0old.txt\0');
    expect(entries).toEqual([{ path: 'new.txt', oldPath: 'old.txt', status: 'R' }]);
  });

  it('parses a copy, consuming the following token as the source path', () => {
    const entries = parsePorcelainZ('C  copy.txt\0source.txt\0');
    expect(entries).toEqual([{ path: 'copy.txt', oldPath: 'source.txt', status: 'C' }]);
  });

  it('does not misparse a subsequent entry as a rename source', () => {
    // Rename consumes exactly one extra token; the entry after that must parse normally.
    const entries = parsePorcelainZ('R  new.txt\0old.txt\0M  after.txt\0');
    expect(entries).toEqual([
      { path: 'new.txt', oldPath: 'old.txt', status: 'R' },
      { path: 'after.txt', oldPath: null, status: 'M' },
    ]);
  });

  it('ignores empty tokens from trailing/duplicate NUL separators', () => {
    const entries = parsePorcelainZ('\0 M file.txt\0\0');
    expect(entries).toEqual([{ path: 'file.txt', oldPath: null, status: 'M' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parsePorcelainZ('')).toEqual([]);
  });
});

describe('parseNumstat', () => {
  it('extracts additions and deletions for the target path', () => {
    const out = '5\t3\tfile.txt\n1\t1\tother.txt\n';
    expect(parseNumstat(out, 'file.txt')).toEqual({ additions: 5, deletions: 3, binary: false });
  });

  it('picks the correct line among several', () => {
    const out = '1\t1\ta.txt\n10\t20\tb.txt\n2\t2\tc.txt\n';
    expect(parseNumstat(out, 'b.txt')).toEqual({ additions: 10, deletions: 20, binary: false });
  });

  it('treats "-\t-" as binary and zeroes the counts', () => {
    const out = '-\t-\timage.png\n';
    expect(parseNumstat(out, 'image.png')).toEqual({ additions: 0, deletions: 0, binary: true });
  });

  it('returns zero/non-binary when the target path is not present', () => {
    const out = '5\t3\tother.txt\n';
    expect(parseNumstat(out, 'missing.txt')).toEqual({ additions: 0, deletions: 0, binary: false });
  });

  it('ignores blank lines', () => {
    const out = '\n5\t3\tfile.txt\n\n';
    expect(parseNumstat(out, 'file.txt')).toEqual({ additions: 5, deletions: 3, binary: false });
  });
});

describe('formatAddOnlyDiff', () => {
  it('formats a file with a trailing newline, one "+" line per source line', () => {
    const diff = formatAddOnlyDiff('a.txt', 'line1\nline2\n');
    expect(diff).toBe(
      'diff --git a/a.txt b/a.txt\n' +
        'new file\n' +
        '--- /dev/null\n' +
        '+++ b/a.txt\n' +
        '@@ -0,0 +1,2 @@\n' +
        '+line1\n' +
        '+line2\n'
    );
  });

  it('appends a "No newline at end of file" marker when the source has none', () => {
    const diff = formatAddOnlyDiff('a.txt', 'line1\nline2');
    expect(diff).toBe(
      'diff --git a/a.txt b/a.txt\n' +
        'new file\n' +
        '--- /dev/null\n' +
        '+++ b/a.txt\n' +
        '@@ -0,0 +1,2 @@\n' +
        '+line1\n' +
        '+line2\n' +
        '\\ No newline at end of file\n'
    );
  });

  it('formats an empty file with a zero-line hunk and no body', () => {
    const diff = formatAddOnlyDiff('empty.txt', '');
    expect(diff).toBe(
      'diff --git a/empty.txt b/empty.txt\n' +
        'new file\n' +
        '--- /dev/null\n' +
        '+++ b/empty.txt\n' +
        '@@ -0,0 +1,0 @@\n'
    );
  });
});

describe('clampDiff', () => {
  it('passes short diffs through untruncated', () => {
    expect(clampDiff('short diff')).toEqual({ diff: 'short diff', truncated: false });
  });

  it('truncates diffs over the byte limit', () => {
    const big = 'x'.repeat(2_000_001);
    const { diff, truncated } = clampDiff(big);
    expect(truncated).toBe(true);
    expect(diff.length).toBe(2_000_000);
  });
});

describe('isBinary', () => {
  it('returns false for plain text', () => {
    expect(isBinary(Buffer.from('hello world', 'utf8'))).toBe(false);
  });

  it('returns true when a NUL byte appears within the scan window', () => {
    expect(isBinary(Buffer.from([104, 105, 0, 116, 104, 101, 114, 101]))).toBe(true);
  });

  it('ignores NUL bytes beyond the 8000-byte scan window', () => {
    const buf = Buffer.alloc(8100, 65); // all 'A'
    buf[8050] = 0;
    expect(isBinary(buf)).toBe(false);
  });
});
