# HtmlParser

JavaScript tool that reads an HTML document, splits it into pages, and lists the unique authors on each page. The parser, the report formatter, and the command-line runner are all in `parsehtml.js`.

Requires Node.js 18 or newer. The only dependency is [htmlparser2](https://github.com/fb55/htmlparser2). The command streams the file, so a large document does not have to fit in one string.

## Run

```bash
npm install
node parsehtml.js document.html
```

The first argument is the HTML file. The report is written in the current directory, named from that file: `document.html` produces `document.txt`. A second argument chooses the output path.

```bash
node parsehtml.js document.html report.txt
node parsehtml.js huge_chat_export.html
```

A path that is a directory is read from the same-named file inside it. `huge_chat_export.html` is the folder that contains `huge_chat_export.html/huge_chat_export.html`, and that command writes `huge_chat_export.txt`.

`--json` writes the same pages as data, to `document.json` unless you pass an output path. Each `authors` entry is `Name` or `Name (Role)`.

```bash
node parsehtml.js document.html --json
```

```json
[
  {
    "page": 1,
    "authors": [
      "Dr. Helena Kovacs (Research Lead)",
      "David Lee"
    ]
  }
]
```

## Report

Each page is a header followed by its unique authors. The labeled page author is first. Chat participants from `class="author"` follow, with a Facebook id left off the name.

```text
Page Number: 1
Author: Dr. Helena Kovacs (Research Lead)
Author: David Lee
Author: ليلى محمد

Page Number: 2
Author: Marcus Chen-Williams (Senior Engineer)
Author: David Lee
```

A page with no authors is still written, as a header with no `Author:` lines. The same person can appear again on a later page.

## How a document is read

`parseFile` streams the HTML. A page starts at a marker and continues until the next one. Text before the first marker is ignored.

1. A `div` with both classes `t` and `i` opens a page when its text is a page label. Class order does not matter, and extra classes are fine.
2. On that page, `Author:` lines and an `Author` field are recorded.
3. Elements with `class="author"`, `class="byline"`, `rel="author"`, `itemprop="author"`, or `<meta name="author">` are recorded too.
4. Names are compared with case and extra spaces ignored. The first spelling and role are kept.

```html
<div class="t i">Page Number: 1</div>
<div class="t i">Page 13</div>
<div class="t i">Page <div></div>14</div>
```

The number may have a trailing period (`Page 13.`). A label split by a blank element or a line break still counts. A `div` with only class `t`, or the words `Page 10` outside a `div.t.i`, does not start a page. The same page number later in the file starts another section.

## Authors

An author line begins with `Author:` and a name. An optional role sits in parentheses. `Co-Author:` and `Authors:` do not match.

```html
<div class="t">Author: Sarah Johnson (Machine Learning Engineer)</div>
<div class="t">Author: Marcus Lee</div>
```

A field with the label `Author` is the same kind of entry. The name is the text that follows the label:

```html
<div class="t i">Author<div class="m"><div>Dr. Helena Kovacs (Research Lead)</div></div>
```

Some exports insert the page number immediately before the surname, as in `Helena 1Kovacs` on page 1 or `Carlos 10Mendoza` on page 10. That number is removed when it matches the page, so the name is `Helena Kovacs` or `Carlos Mendoza`. The role stays.

Whitespace is collapsed, including non-breaking spaces, and a leading `By ` is removed. Two author lines may share one element when a newline or `<br>` separates them. A value such as `Ada Lovelace and Grace Hopper` is split on `and` or `&`.

`class="author"` text like `David Lee (Facebook: 062239831674842)` is stored as `David Lee`. A different Facebook id does not make a second person. Job roles in parentheses are kept. Timestamps, and the field labels `Body`, `Sent`, `Page`, and `Author`, are not names.

The same name on one page is listed once. `Sarah Johnson`, `Sarah   Johnson`, and `sarah johnson` are one person. `Daniel Kim (Product Manager)` followed by `Daniel Kim (Engineering Manager)` keeps the first role.

## Use it from JavaScript

Importing `parsehtml.js` does not read a file or write a report. `parseFile` streams a path. `parsePages` parses a string and throws a `TypeError` for anything else. Both return `{ page: number, authors: string[] }[]`. `formatPages` turns that array into the text report.

```js
import { formatPages, parseFile } from "./parsehtml.js";
import { writeFile } from "node:fs/promises";

const pages = await parseFile("huge_chat_export.html/huge_chat_export.html");
await writeFile("huge_chat_export.txt", formatPages(pages) + "\n");
```
