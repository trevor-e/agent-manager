import { memo } from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { all, common } from 'lowlight';

const components = {
  a: (props: any) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm];
const REHYPE_PLUGINS: Options['rehypePlugins'] = [
  [rehypeHighlight, { detect: true, languages: all, subset: Object.keys(common) }],
];

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
