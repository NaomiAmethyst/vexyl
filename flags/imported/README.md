# Imported flags

These are country and pride flags converted mechanically from SVG files on
[Wikimedia Commons](https://commons.wikimedia.org/), by [`tools/`](../../tools). They
exist to stress test the format.

**They aren't checked against any official construction.** Each describes a drawing,
whose accuracy is whatever its source's is. For flags written by hand and checked
against their sources, see [`flags/`](..).

There are 231 country flags and 73 pride flags. 179 of the 304 use only native
vocabulary, and the rest keep some artwork as inline SVG, such as seals, emblems and
curved shapes. [`report.tsv`](report.tsv) lists each flag's counts and how far its
render differs from its source.

## Rights

Each file's `license` and `encoder` come from its Commons page, and its `source` links
there. Where Commons credits the author only in a page's file history, the file has no
`encoder`, and the page has the credit.

These cover the drawings. Designs can have their own terms: some pride flags' designers
set conditions for using them, and many countries legally restrict how their flags and
emblems are used. Check those before using a flag.

Left out are two flags with licenses the importer couldn't identify (Oman and one
lesbian pride flag), and the Commons drawing of the Progress Pride flag, whose design
has its own terms. It's covered by [`flags/progress-pride.kdl`](../progress-pride.kdl),
along with a note about them. Some flags here build on that design too, so the same
terms may apply to them.

## Regenerating

```sh
tools/fetch_flags.py CORPUS
go build -o vexyl ./cmd/vexyl
tools/import_flags.py CORPUS OUT ./vexyl flags/imported
```

Comparison needs `google-chrome`, and Python with NumPy and Pillow.
