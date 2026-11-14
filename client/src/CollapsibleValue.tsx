import { useId, useState, type ReactNode } from "react";

type Props = { value: string; render?: (text: string) => ReactNode };

/** Display-only disclosure: never truncates or writes the underlying CRM value. */
export default function CollapsibleValue(props: Props) {
  return <ValueDisclosure key={props.value} {...props} />;
}

function ValueDisclosure({ value, render = text => text }: Props) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const lines = value.split(/\r?\n/);
  const long = value.length > 240 || lines.length > 4;
  const preview = (lines.length > 4 ? lines.slice(0, 3).join('\n') : value).slice(0, 240).trimEnd() + '…';
  const typography = { color: 'inherit', fontSize: 'inherit', overflowWrap: 'anywhere' as const, whiteSpace: 'pre-wrap' as const };
  if (!long) return <>{render(value)}</>;
  return <span style={{ ...typography, display: 'block', minWidth: 0 }}>
    <span id={id} style={typography}>{render(long && !expanded ? preview : value)}</span>
    {long && <button type="button" className="button ghost small" style={{ display: 'flex', marginTop: 6 }} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(current => !current)}>
      {expanded ? 'Afficher moins' : 'Afficher plus'}
    </button>}
  </span>;
}
