# The Vexyl editor

A static site for reading, editing, comparing and sharing [Vexyl](../README.md) flags. There's no server
of any kind: everything happens in the browser, and it works from any static host, under any path.

```sh
make web         # builds it into web/dist
make check-web   # type checks, builds, and runs the unit and end-to-end tests
```

Serve `web/dist` with anything that serves files. To try it, `npx http-server web/dist` will do, or
`python3 -m http.server -d web/dist`. A browser won't run it from `file://`, because module scripts and
workers need an origin.

## How it's put together

- **Preact**, with no other framework. The page is forms and lists, and Preact's small renderer turns strings into
  text nodes with no way to write HTML by accident. Nothing here uses `dangerouslySetInnerHTML`.
- **CodeMirror 6** for Source, with a small KDL tokenizer. It lives in a shadow root, because there its styles
  are constructed style sheets, which a strict Content Security Policy allows.
- **A worker reads every document.** `src/worker.ts` is the only code that parses a file, validates it, draws it or
  changes it, using the library in `../ts`. The page only gets plain data back, so a 2 MB flag can't stall it.
- **One document.** Form and Source edit the same text. The form sends the worker changes to make through
  `@bgotink/kdl`'s format-preserving model (`src/document.ts`), which touches only what it's asked to, and
  `make check-web` tests that comments, order and spacing come through byte for byte.
- **Two editors over one file.** Advanced is `src/form.tsx`, in the format's own words, for writing a flag from a law or a construction sheet.
  Basic is `src/basic.tsx`, in plain names, with handles on the flag (`src/handles.tsx`), for making one without knowing the format. It works out what a
  drag means in `src/snap.ts` and `src/flagdrag.ts` and reads the file through `src/flagview.ts`. It only edits what it's asked to, through the same model, and it lists
  whatever it has no control for. Fractions and turns are only ever on screen: the file keeps plain numbers and degrees.
- **Table-driven.** `src/vocab.ts` holds the format's terms as tables, and `src/form.tsx` draws the form from them. Anything
  in a file that isn't in a table is listed as being only in the source, and it's left alone.
- **A flag is always an image.** What's shown is an `<img>` of the library's sanitized SVG, from a `blob:` URL, so it
  can't run anything, and it looks exactly as it will when exported. Under it, invisible, is a tree of the same
  geometry from a tagged render, built with DOM calls, which says what's under a click. It holds only numbers and paths,
  with inline artwork as a box, because that selects as a whole.

## Security

Every opened file, link and paste is untrusted. The page's Content Security Policy is in `src/index.html`:

| Directive | Why |
|---|---|
| `default-src 'none'` | Nothing's allowed that isn't named below |
| `script-src 'self'`, `worker-src 'self'` | Only this site's own files, so no inline script and no `eval` |
| `style-src 'self'` | Only this site's own style sheet. Styles set from script use the DOM, which this allows |
| `img-src 'self' blob:` | The favicon, and flags drawn here |
| `font-src 'self'` | The fonts are served from here, never from a font service |
| `connect-src https:` | Any https site, because the Link tab can open a file from anywhere |
| `base-uri 'none'`, `form-action 'none'` | Nothing can change where links lead, or send a form |
| `require-trusted-types-for 'script'`, `trusted-types vexyl-worker` | In browsers that have it, no string can become HTML or script. The one policy makes the worker's URL |

`connect-src` is the one trade-off. Without the Link tab it could be `https://api.github.com https://raw.githubusercontent.com
https://gist.githubusercontent.com`. Since a meta tag can't change after the page loads, it has to allow what the Link tab might
need. What keeps that safe is that no code but this site's can run, so nothing can use it to send anything anywhere. A meta tag
also can't set `frame-ancestors`, so a host that wants to stop the page being framed has to send that as a header.

Downloads and files stop at 16 MB, share links at 8 MiB. Links from a file only go to `http` and `https`, with
`noopener noreferrer nofollow`, and requests carry no credentials or referrer. No analytics, and nothing else is ever requested.

## Testing

`test/unit` needs only Node. `test/e2e` runs the built site from a subpath on a plain file server, in Chromium, with
every request to GitHub answered from a checkout of vexyl-flags next to this repository (or `$VEXYL_FLAGS`). They use
`playwright-core` with a browser already on the machine: the newest in Playwright's cache, or `$VEXYL_CHROME`.
`node test/shots/shots.mjs DIR` takes a picture of every screen.
