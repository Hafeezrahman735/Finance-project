import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import React from "react";
import { Link } from "react-router-dom";
import { shortDate } from "../../lib/format";

/**
 * Renders a brief sentence with every number underlined; each opens a popover
 * naming the metric behind it (plan: Design specification §4, "every number
 * tappable to evidence"). A number that matches no metric is shown plain,
 * which the server-side validator makes rare.
 */
const NUMBER_RE = /\$?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b|%|x\b)?/g;

function parse(token) {
  const t = token.replace(/[$,\s]/g, "");
  const m = /^(\d+(?:\.\d+)?)([kKmM]|%|x)?$/.exec(t);
  if (!m) return null;
  let value = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  const approximate = suffix === "k" || suffix === "m";
  if (suffix === "k") value *= 1000;
  if (suffix === "m") value *= 1_000_000;
  return { value, approximate, integer: !m[1].includes(".") && !approximate };
}

function valuesOf(display) {
  return (display.match(NUMBER_RE) ?? []).map(parse).filter(Boolean).map((p) => p.value);
}

function matches(token, allowed) {
  if (Math.abs(token.value - allowed) < 0.005) return true;
  if (token.integer && Math.abs(token.value - allowed) < 0.5) return true;
  if (token.approximate && allowed !== 0 && Math.abs(token.value - allowed) / Math.abs(allowed) <= 0.05) return true;
  return false;
}

/** Find the metric a number token refers to: evidence ids first, then everything. */
function metricForToken(token, metrics, evidenceIds = []) {
  const parsed = parse(token);
  if (!parsed) return null;
  const order = [...evidenceIds, ...Object.keys(metrics).filter((id) => !evidenceIds.includes(id))];
  for (const id of order) {
    const m = metrics[id];
    if (!m) continue;
    if (valuesOf(m.display).some((v) => matches(parsed, v))) return { id, ...m, which: "display" };
    if (m.prev && valuesOf(m.prev).some((v) => matches(parsed, v))) return { id, ...m, which: "prev" };
  }
  return null;
}

function transactionsLink(id) {
  if (id.startsWith("recurring:")) return null; // memo search is added by the caller who knows the memo
  if (id.startsWith("uncategorized")) return "/transactions?filter=queue";
  return "/transactions";
}

export default function EvidenceText({ text, metrics, evidenceIds = [], recurringMemos = {} }) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(NUMBER_RE)) {
    const token = match[0];
    const start = match.index;
    if (start > last) parts.push(text.slice(last, start));
    const metric = metricForToken(token, metrics, evidenceIds);
    if (!metric) {
      parts.push(token);
    } else {
      const slug = metric.id.startsWith("recurring:") ? metric.id.split(":")[1] : null;
      const link = slug && recurringMemos[slug] ? `/transactions?q=${encodeURIComponent(recurringMemos[slug])}` : transactionsLink(metric.id);
      parts.push(
        <Popover key={start} className="inline">
          <PopoverButton className="tnum rounded-ui underline decoration-accent decoration-2 underline-offset-2 hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {token.trim()}
          </PopoverButton>
          <PopoverPanel anchor="bottom start" className="z-50 mt-1 w-72 rounded-ui border border-line bg-surface p-3 text-sm text-text focus:outline-none">
            <p className="font-medium">{metric.label}</p>
            <p className="tnum mt-1 text-base">
              {metric.display}
              {metric.prev && <span className="text-muted"> · was {metric.prev}</span>}
            </p>
            {metric.window && (
              <p className="tnum mt-1 text-muted">
                {shortDate(metric.window.from)} – {shortDate(metric.window.to)}
              </p>
            )}
            {metric.note && <p className="mt-1 text-muted">{metric.note}</p>}
            {link && (
              <Link to={link} className="mt-2 inline-block">
                See transactions
              </Link>
            )}
          </PopoverPanel>
        </Popover>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
