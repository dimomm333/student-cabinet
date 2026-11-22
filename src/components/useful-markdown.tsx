import type { ReactNode } from "react";
import Link from "next/link";
import { usefulLink, usefulPath } from "@/lib/useful-catalog";

export function UsefulMarkdown({ text, visibleIds }: { text: string; visibleIds: ReadonlySet<string> }) {
  function inline(line: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let end = 0;
    for (const match of line.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*/g)) {
      const index = match.index;
      nodes.push(line.slice(end, index));
      if (match[3]) {
        nodes.push(<strong key={index}>{match[3]}</strong>);
      } else {
        const href = usefulLink(match[2]);
        const linkedEntry = href?.startsWith(usefulPath + "/") ? href.slice(usefulPath.length + 1) : null;
        if (!href || (linkedEntry && !visibleIds.has(linkedEntry))) nodes.push(match[1]);
        else if (href.startsWith("/")) nodes.push(<Link key={index} href={href}>{match[1]}</Link>);
        else nodes.push(<a key={index} href={href} rel="noreferrer">{match[1]}</a>);
      }
      end = index + match[0].length;
    }
    nodes.push(line.slice(end));
    return nodes;
  }

  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const listItem = /^(?:(\d+)\. |[-*] )(.+)$/;
  const heading = /^#{1,6}\s+(.+)$/;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const key = index++;
    if (!line) continue;
    const title = heading.exec(line);
    if (title) {
      blocks.push(<h2 key={key}>{inline(title[1])}</h2>);
      continue;
    }
    const first = listItem.exec(line);
    if (first) {
      const Tag = first[1] ? "ol" : "ul";
      const items = [<li key={key}>{inline(first[2])}</li>];
      for (let next = listItem.exec(lines[index] ?? ""); next && Boolean(next[1]) === Boolean(first[1]); next = listItem.exec(lines[index] ?? "")) {
        items.push(<li key={index++}>{inline(next[2])}</li>);
      }
      blocks.push(<Tag key={key}>{items}</Tag>);
      continue;
    }
    let paragraph = line;
    while (lines[index] && !heading.test(lines[index]) && !listItem.test(lines[index])) paragraph += " " + lines[index++];
    blocks.push(<p key={key}>{inline(paragraph)}</p>);
  }
  return <div className="useful-markdown">{blocks}</div>;
}
