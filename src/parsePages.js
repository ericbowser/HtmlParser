import { parseHTML } from "linkedom";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const PAGE_NUMBER_LABEL = /^Page\s+Number:\s*(\d+)\.?$/i;
const PAGE_LABEL = /^Page\s+(\d+)\.?$/i;
const AUTHOR_LINE = /^Author:\s*(.+)$/i;
const NAME_AND_ROLE = /^(.*?)\s*\(([^)]*)\)\s*$/;
const CONJUNCTION = /\s+(?:and|&)\s+/i;

export function parsePages(html) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }

  const { document } = parseHTML(html);
  const state = { current: null, pages: [] };
  walk(document, state);

  return state.pages.map(({ page, authors }) => ({ page, authors }));
}

export function formatPages(pages) {
  return pages
    .map(({ page, authors }) => [`Page Number: ${page}`, ...authors.map((author) => `Author: ${author}`)].join("\n"))
    .join("\n\n");
}

function walk(node, state) {
  for (const child of node.childNodes) {
    if (child.nodeType !== ELEMENT_NODE) continue;

    const page = pageNumber(child);
    if (page != null) {
      state.current = { page, authors: [], seen: new Set() };
      state.pages.push(state.current);
      continue;
    }

    if (state.current) {
      const fromLines = authorLines(directText(child));
      if (fromLines.length > 0) {
        for (const name of fromLines) addAuthor(state.current, name);
      } else if (isAuthorElement(child)) {
        for (const name of authorNames(child)) addAuthor(state.current, name);
        continue;
      }
    }

    walk(child, state);
  }
}

function pageNumber(element) {
  if (element.tagName !== "DIV") return null;
  if (!element.classList.contains("t") || !element.classList.contains("i")) {
    return null;
  }

  const text = collapse(element.textContent);
  const match = PAGE_NUMBER_LABEL.exec(text) || PAGE_LABEL.exec(text);
  return match ? Number(match[1]) : null;
}

function directText(element) {
  let text = "";
  for (const child of element.childNodes) {
    if (child.nodeType === TEXT_NODE) text += child.textContent;
    else if (child.nodeType === ELEMENT_NODE && child.tagName === "BR") text += "\n";
  }
  return text;
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

function authorCredit(value) {
  const body = collapse(value);
  const roleMatch = NAME_AND_ROLE.exec(body);
  if (!roleMatch) return named(body);

  const author = named(roleMatch[1]);
  if (!author) return null;
  const role = collapse(roleMatch[2]);
  if (role) author.label = `${author.label} (${role})`;
  return author;
}

function named(value) {
  const name = clean(value);
  if (!name) return null;
  return { key: name.toLocaleLowerCase(), label: name };
}

function isAuthorElement(element) {
  if (
    element.tagName === "META" &&
    (element.getAttribute("name") || "").toLowerCase() === "author"
  ) {
    return true;
  }

  if (hasToken(element.getAttribute("itemprop"), "author")) return true;
  if (hasToken(element.getAttribute("rel"), "author")) return true;
  return element.classList.contains("author") || element.classList.contains("byline");
}

function authorNames(element) {
  const structured = structuredNames(element);
  if (structured.length > 0) return structured;

  const text = clean(rawName(element));
  if (!text) return [];
  return text.split(CONJUNCTION).map(named).filter(Boolean);
}

function structuredNames(element) {
  const nodes = [];
  if (hasToken(element.getAttribute("itemprop"), "name")) nodes.push(element);
  if (element.querySelectorAll) {
    nodes.push(...element.querySelectorAll("[itemprop~='name']"));
  }

  const authors = [];
  for (const node of nodes) {
    const author = named(rawName(node));
    if (author) authors.push(author);
  }
  return authors;
}

function rawName(element) {
  if (element.tagName === "META") return element.getAttribute("content") || "";

  const dataName = element.getAttribute("data-name");
  if (dataName) return dataName;

  if (element.childElementCount === 0) {
    const content = element.getAttribute("content");
    if (content) return content;
  }

  return element.textContent || "";
}

function addAuthor(page, author) {
  if (page.seen.has(author.key)) return;
  page.seen.add(author.key);
  page.authors.push(author.label);
}

function hasToken(value, token) {
  if (!value) return false;
  return value.split(/\s+/).includes(token);
}

function collapse(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function clean(value) {
  return collapse(value).replace(/^by\s+/i, "");
}
