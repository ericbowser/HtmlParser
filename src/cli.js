#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { formatPages, parsePages } from "./parsePages.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const file = args.find((arg) => !arg.startsWith("--"));

if (!file) {
  console.error("Usage: node src/cli.js <document.html> [--json]");
  process.exit(1);
}

const html = await readFile(file, "utf8");
const pages = parsePages(html);

if (json) {
  console.log(JSON.stringify(pages, null, 2));
} else {
  const report = formatPages(pages);
  if (report) console.log(report);
}
