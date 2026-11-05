# HtmlParser

JavaScript tool that reads an HTML document, splits it into pages, and lists the unique authors on each page. The parser, the report formatter, and the command-line runner are all in `parsehtml.js`.

Requires Node.js 18 or newer. The only dependency is [linkedom](https://github.com/WebReflection/linkedom), which supplies a DOM so the file is walked as HTML instead of matched with regular expressions.

## Run

```bash
npm install
node parsehtml.js document.html
```

That prints a report:

```text
Page Number: 1
Author: Sarah Johnson (Machine Learning Engineer)
Author: Olivia Moore (Developer)

Page Number: 2
Author: Jacky Johnson (Engineer)
Author: Sophia Moore (Tester)
```

`--json` prints the same result as data. Each `authors` entry is `Name` or `Name (Role)`.

```bash
node parsehtml.js document.html --json
```

```json
[
  {
    "page": 1,
    "authors": [
      "Sarah Johnson (Machine Learning Engineer)",
      "Olivia Moore (Developer)"
    ]
  }
]
```

The command reads the whole file into one string, then parses it. A document larger than Node's maximum string length cannot be loaded this way.

## How a document is read

`parsePages` parses the HTML into a document and walks every element in order.

1. A page marker opens a new page. Anything after it belongs to that page until the next marker. Text before the first marker is ignored, so a `<meta name="author">` in the document head is not copied onto page 1.
2. On the current page, each element's own text is scanned for `Author:` lines. A `<br>` is treated as a line break, so two authors in one element are both seen.
3. If an element has no `Author:` line, it can still contribute an author through the semantic markup below. The walk does not descend into that element, so a nested name is not counted twice.
4. Each accepted author is recorded on the open page. `formatPages` prints the page number and those labels.

Repeated page numbers stay as separate sections, in the order they appear. A page with no authors is still printed, as a header with no `Author:` lines.

## Page markers

A marker is a `div` whose class list contains both `t` and `i`. Extra classes are fine, and `class="i t"` is the same as `class="t i"`. The element's full text must be one of:

```html
<div class="t i">Page Number: 1</div>
<div class="t i">Page 13</div>
```

The number may have a trailing period (`Page 13.`). A `div` with only class `t`, or the words `Page 10` outside a `div.t.i`, does not start a page.

## Author lines

An author line is text that begins with `Author:` followed by a name. An optional role sits in parentheses at the end:

```html
<div class="t">Author: Sarah Johnson (Machine Learning Engineer)</div>
<div class="t">Author: Marcus Lee</div>
```

Two author lines may share one element when they are separated by a newline. `Co-Author:` and `Authors:` do not match, because the line must start with the singular label `Author:`.

Whitespace is collapsed, including non-breaking spaces, and a leading `By ` is removed.

## Uniqueness

Comparison is by name only, after whitespace is collapsed and case is ignored. The role is not part of the identity.

- The same line printed twice on one page is listed once.
- `Sarah Johnson`, `Sarah   Johnson`, and `sarah johnson` are one person. The first spelling is the one that is printed.
- `Daniel Kim (Product Manager)` followed by `Daniel Kim (Engineering Manager)` is one person. The first role is kept.
- The same person on a later page is listed again. Uniqueness does not cross pages.

## Semantic markup

An element can also name a person with:

- `itemprop="author"`, using a nested `itemprop="name"` when one is present
- `rel="author"`
- class `author` or `byline`
- `<meta name="author" content="...">` or `<meta itemprop="author" content="...">`

For this markup, the recorded value is the element text. A value such as `Ada Lovelace and Grace Hopper` is split on `and` or `&`. A parenthetical role is stripped only from `Author:` lines, not from this markup. `Author:` lines take priority when both appear on the same element.

## Use it from JavaScript

Running `parsehtml.js` directly reads an HTML path and prints the report. Importing it does not read a file.

```js
import { readFile } from "node:fs/promises";
import { formatPages, parsePages } from "./parsehtml.js";

const html = await readFile("document.html", "utf8");
const pages = parsePages(html);
console.log(formatPages(pages));
```

`parsePages` returns `{ page: number, authors: string[] }[]`. `formatPages` turns that array into the text report. `parsePages` throws a `TypeError` if it is given anything other than a string.
