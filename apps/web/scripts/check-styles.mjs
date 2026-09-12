// Design hard rules (plan: Pass 4 / litmus 7), enforced at lint time:
//   no decorative box-shadows, no gradients, no icon-in-circle grids, no
//   system default font stacks as the primary typeface.
// Allowed: focus rings (outline), Tailwind `shadow-none`, `boxShadow: "none"`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src", import.meta.url));
const RULES = [
  { name: "box-shadow", re: /\b(shadow-(?!none)[a-z0-9]+|box-shadow\s*:\s*(?!none))/i },
  { name: "gradient", re: /gradient/i },
  { name: "system font stack as primary", re: /font-family\s*:\s*(system-ui|-apple-system|Inter\b)/i },
];

let failures = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|css)$/.test(name)) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/check-styles:allow/.test(line)) return;
        for (const rule of RULES) {
          if (rule.re.test(line)) {
            failures++;
            console.error(`${p}:${i + 1}: ${rule.name}: ${line.trim()}`);
          }
        }
      });
    }
  }
}
walk(ROOT);
if (failures) {
  console.error(`\n${failures} style-rule violation(s). See docs/architecture.md → design rules.`);
  process.exit(1);
}
console.log("check-styles: ok");
