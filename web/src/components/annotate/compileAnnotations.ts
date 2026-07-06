import type { Annotation } from './types';

export function compileAnnotations(annotations: Annotation[]): string {
  return annotations
    .map((a) => {
      const quote = a.quote
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `${quote}\n${a.comment.trim()}`;
    })
    .join('\n\n');
}
