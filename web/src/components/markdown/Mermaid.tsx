import { useEffect, useId, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
let initialized = false;

async function getMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid');
  const mermaid = (await mermaidPromise).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      themeVariables: {
        background: '#161b22',
        primaryColor: '#1f2630',
        primaryTextColor: '#e6edf3',
        primaryBorderColor: '#2a313c',
        lineColor: '#8b949e',
        secondaryColor: '#1f2937',
        tertiaryColor: '#0e1116',
      },
    });
    initialized = true;
  }
  return mermaid;
}

let renderCounter = 0;

export type MermaidNodeClick = { quote: string; rect: DOMRect };

export function Mermaid({
  source,
  onNodeClick,
}: {
  source: string;
  onNodeClick?: (info: MermaidNodeClick) => void;
}) {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const latestSource = useRef(source);
  latestSource.current = source;

  useEffect(() => {
    const timer = setTimeout(async () => {
      const currentSource = latestSource.current;
      try {
        const mermaid = await getMermaid();
        const id = `mermaid-${reactId}-${++renderCounter}`;
        const { svg: rendered } = await mermaid.render(id, currentSource);
        if (latestSource.current === currentSource) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (latestSource.current === currentSource) setFailed(true);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [source, reactId]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onNodeClick) return;
    const target = e.target as Element;
    const group = target.closest('g') as SVGGElement | null;
    if (!group) return;
    const text = group.textContent?.trim();
    if (!text) return;
    onNodeClick({ quote: text, rect: group.getBoundingClientRect() });
  }

  if (!svg) {
    return (
      <pre className={`mermaid-fallback ${failed ? 'mermaid-failed' : 'mermaid-pending'}`}>
        <code>{source}</code>
      </pre>
    );
  }

  return (
    <div className="mermaid-wrap" onClick={handleClick}>
      <TransformWrapper minScale={0.5} maxScale={4} centerOnInit>
        <TransformComponent wrapperClass="mermaid-transform-wrapper" contentClass="mermaid-transform-content">
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
