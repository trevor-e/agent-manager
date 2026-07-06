import { isValidElement, memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { all, common } from 'lowlight';
import { Mermaid, type MermaidNodeClick } from './markdown/Mermaid';

export type BlockRenderer = (args: {
  Tag: keyof JSX.IntrinsicElements;
  tagProps: Record<string, any>;
  children: ReactNode;
  blockId: string;
  text: string;
}) => ReactNode;

const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'] as const;

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isValidElement(node)) return textContent((node.props as any)?.children);
  return '';
}

function makeComponents(
  onMermaidNodeClick: ((info: MermaidNodeClick) => void) | undefined,
  blockWrap: BlockRenderer | undefined
) {
  const counter = { n: 0 };

  function block(tag: (typeof BLOCK_TAGS)[number]) {
    return function BlockComponent(props: any) {
      const { node, children, ...tagProps } = props;
      if (!blockWrap) {
        const Tag = tag as any;
        return <Tag {...tagProps}>{children}</Tag>;
      }
      const blockId = `b${counter.n++}`;
      return blockWrap({ Tag: tag, tagProps, children, blockId, text: textContent(children) });
    };
  }

  const components: Record<string, any> = {
    a: (props: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    code(props: any) {
      const { className, children, node, ...rest } = props;
      if (/(?:^|\s)language-mermaid(?:\s|$)/.test(className || '')) {
        return <Mermaid source={textContent(children)} onNodeClick={onMermaidNodeClick} />;
      }
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
    pre(props: any) {
      const { children, node, ...rest } = props;
      if (isValidElement(children) && (children as any).type === Mermaid) return children;
      return <pre {...rest}>{children}</pre>;
    },
  };

  if (blockWrap) {
    for (const tag of BLOCK_TAGS) components[tag] = block(tag);
  }

  return components;
}

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm];
const REHYPE_PLUGINS: Options['rehypePlugins'] = [
  [rehypeHighlight, { detect: true, languages: all, subset: Object.keys(common) }],
];

export const Markdown = memo(function Markdown({
  children,
  onMermaidNodeClick,
  blockWrap,
}: {
  children: string;
  onMermaidNodeClick?: (info: MermaidNodeClick) => void;
  blockWrap?: BlockRenderer;
}) {
  const components = useMemo(
    () => makeComponents(onMermaidNodeClick, blockWrap),
    [onMermaidNodeClick, blockWrap]
  );
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
