#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Parser } from "htmlparser2";

const PAGE_NUMBER_LABEL = /^Page\s+Number:\s*(\d+)\.?$/i;
const PAGE_LABEL = /^Page\s+(\d+)\.?$/i;
const AUTHOR_LINE = /^Author:\s*(.+)$/i;
const NAME_AND_ROLE = /^(.*?)\s*\(([^)]*)\)\s*$/;
const CONJUNCTION = /\s+(?:and|&)\s+/i;
const TEXT_LIMIT = 200;

export function parsePages(html) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }

  const state = createState();
  const parser = createParser(state);
  parser.write(html);
  parser.end();
  return result(state);
}

export async function parseFile(file) {
  const state = createState();
  const parser = createParser(state);
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => parser.write(chunk));
    stream.on("end", () => {
      parser.end();
      resolve();
    });
    stream.on("error", reject);
  });
  return result(state);
}

export function formatPages(pages) {
  return pages
    .map(({ page, authors }) => [`Page Number: ${page}`, ...authors.map((author) => `Author: ${author}`)].join("\n"))
    .join("\n\n");
}

function createState() {
  return { pages: [], current: null, stack: [], awaitingAuthorValue: false };
}

function result(state) {
  return state.pages.map(({ page, authors }) => ({ page, authors }));
}

function createParser(state) {
  return new Parser(
    {
      onopentag(tag, attribs) {
        const classes = classTokens(attribs.class);
        const ancestorAuthor = state.stack.some((frame) => frame.isAuthor);
        state.stack.push({
          trackText: tag === "div" && classes.has("t") && classes.has("i"),
          text: "",
          directText: "",
          isAuthor: !ancestorAuthor && isAuthorElement(tag, attribs),
          authorText: "",
          authorMark: state.current ? state.current.authors.length : 0,
          pageIndex: state.pages.length,
        });
      },
      ontext(text) {
        const top = state.stack[state.stack.length - 1];
        if (top) top.directText += text;

        const collapsed = collapse(text);
        if (state.awaitingAuthorValue && state.current && collapsed && !/^author$/i.test(collapsed)) {
          const author = authorCredit(stripMarkup(collapsed), state.current.page);
          if (author) addAuthor(state.current, author);
          state.awaitingAuthorValue = false;
        }

        for (const frame of state.stack) {
          if (frame.trackText) {
            frame.text += text;
            if (!shouldKeepTracking(frame.text)) {
              frame.trackText = false;
              frame.text = "";
            }
          }
          if (frame.isAuthor) frame.authorText += text;
        }
        if (
          top?.trackText &&
          !top.authorArmed &&
          collapse(top.directText).toLowerCase() === "author"
        ) {
          top.authorArmed = true;
          state.awaitingAuthorValue = true;
        }
        if (state.current && /author\s*:/i.test(text)) {
          for (const author of authorLines(text)) addAuthor(state.current, author);
        }
      },
      onclosetag() {
        const frame = state.stack.pop();
        if (!frame) return;

        if (frame.isAuthor && state.current) {
          for (const author of namesFromText(frame.authorText)) addAuthor(state.current, author);
        }

        if (!frame.trackText) return;
        const num = pageNumber(frame.text);
        if (num != null) {
          const parent = state.stack[state.stack.length - 1];
          const parentNum = parent?.trackText ? pageNumber(parent.text) : null;
          if (parentNum != null) return;
          rollback(state, frame);
          startPage(state, num);
          return;
        }

        if (state.current && collapse(frame.directText).toLowerCase() === "author") {
          const value = collapse(frame.text).replace(/^author/i, "");
          const author = authorCredit(stripMarkup(value), state.current.page);
          if (author) addAuthor(state.current, author);
        }
      },
    },
    { decodeEntities: true },
  );
}

function shouldKeepTracking(text) {
  const collapsed = collapse(text);
  if (!collapsed) return true;
  if (collapsed.length > TEXT_LIMIT) return false;
  return /^(page|author)/i.test(collapsed);
}

function startPage(state, page) {
  state.current = { page, authors: [], seen: new Set() };
  state.pages.push(state.current);
}

function rollback(state, frame) {
  const page = state.current;
  if (!page || frame.pageIndex !== state.pages.length) return;
  page.authors.length = frame.authorMark;
  page.seen = new Set(page.authors.map((author) => authorKey(author)));
}

function addAuthor(page, author) {
  if (page.seen.has(author.key)) return;
  page.seen.add(author.key);
  page.authors.push(author.label);
}

function authorLines(text) {
  const authors = [];
  for (const line of text.split(/\r?\n/)) {
    const match = AUTHOR_LINE.exec(line.trim());
    if (!match) continue;
    const author = authorCredit(match[1]);
    if (author) authors.push(author);
  }
  return authors;
}

function namesFromText(text) {
  const value = clean(stripMarkup(text));
  if (!value) return [];
  return value
    .split(CONJUNCTION)
    .map((part) => authorCredit(part))
    .filter(Boolean);
}

function authorCredit(value, page) {
  const body = collapse(value);
  const roleMatch = NAME_AND_ROLE.exec(body);
  const name = stripInsertedPageNumber(clean(roleMatch ? roleMatch[1] : body), page);
  if (!isPersonName(name)) return null;
  const role = roleMatch ? collapse(roleMatch[2]) : "";
  const label = role && !/^facebook:/i.test(role) ? `${name} (${role})` : name;
  return { key: name.toLocaleLowerCase(), label };
}

function stripInsertedPageNumber(name, page) {
  if (page == null) return name;
  const match = new RegExp(`^(.+?)\\s+${page}(?=\\p{L})(.*)$`, "u").exec(name);
  if (!match) return name;
  return collapse(`${match[1]} ${match[2]}`);
}

function isPersonName(name) {
  if (!name || !/\p{L}/u.test(name)) return false;
  if (/^(body|sent|page|author|authors|thread)$/i.test(name)) return false;
  if (/^\d{4}-\d{2}-\d{2}\b/.test(name)) return false;
  return true;
}

function authorKey(label) {
  const roleMatch = NAME_AND_ROLE.exec(label);
  return clean(roleMatch ? roleMatch[1] : label).toLocaleLowerCase();
}

function isAuthorElement(tag, attribs) {
  if (tag === "meta" && (attribs.name || "").toLowerCase() === "author") return true;
  if (hasToken(attribs.itemprop, "author")) return true;
  if (hasToken(attribs.rel, "author")) return true;
  const classes = classTokens(attribs.class);
  return classes.has("author") || classes.has("byline");
}

function classTokens(value) {
  return new Set((value || "").split(/\s+/).filter(Boolean));
}

function hasToken(value, token) {
  if (!value) return false;
  return value.split(/\s+/).includes(token);
}

function stripMarkup(value) {
  const marker = value.search(/<|\\<\/div>/i);
  return marker >= 0 ? value.slice(0, marker) : value;
}

function pageNumber(text) {
  const collapsed = collapse(text);
  const match = PAGE_NUMBER_LABEL.exec(collapsed) || PAGE_LABEL.exec(collapsed);
  return match ? Number(match[1]) : null;
}

function collapse(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function clean(value) {
  return collapse(value).replace(/^by\s+/i, "");
}

async function resolveInput(file) {
  const info = await stat(file);
  if (!info.isDirectory()) return file;

  const nested = path.join(file, path.basename(file));
  try {
    const nestedInfo = await stat(nested);
    if (nestedInfo.isFile()) return nested;
  } catch {
    // The directory does not contain a same-named HTML file.
  }
  throw new Error(`${file} is a directory`);
}

function outputPath(inputFile, requested, json) {
  if (requested) return requested;
  const base = path.basename(inputFile, path.extname(inputFile));
  return `${base}.${json ? "json" : "txt"}`;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const json = args.includes("--json");
  const positional = args
    .filter((arg) => arg !== "--json")
    .map((arg) => (arg.startsWith("--") ? arg.slice(2) : arg));
  const inputArg = positional[0];
  const outputArg = positional[1];

  if (!inputArg) {
    console.error("Usage: node parsehtml.js <document.html> [report.txt] [--json]");
    process.exit(1);
  }

  let file;
  try {
    file = await resolveInput(inputArg);
  } catch (error) {
    console.error(error.code === "ENOENT" ? `No such file: ${inputArg}` : error.message);
    process.exit(1);
  }

  const pages = await parseFile(file);
  const report = json ? JSON.stringify(pages, null, 2) : formatPages(pages);
  const output = outputPath(file, outputArg, json);
  await writeFile(output, report ? `${report}\n` : "");
  console.log(`Wrote ${pages.length} pages to ${output}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
