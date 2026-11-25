import React from "react";

// Renders the assistant's plain text safely: "- " lines become bullets, **bold** is honoured.
export default function RichText({ text }) {
  const bold = (line) => line.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const blocks = [];
  let list = null;
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { (list ||= []).push(<li key={i}>{bold(m[1])}</li>); return; }
    if (list) { blocks.push(<ul key={`u${i}`}>{list}</ul>); list = null; }
    if (line.trim()) blocks.push(<p key={i}>{bold(line)}</p>);
  });
  if (list) blocks.push(<ul key="uend">{list}</ul>);
  return <>{blocks}</>;
}
