# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

PREFIX  ?= /usr/local
BINDIR  ?= $(PREFIX)/bin
DESTDIR ?=

GO      ?= go

SOURCES := $(shell find go -name '*.go') go/go.mod go/go.sum

.PHONY: all test check conformance conformance-fixtures fuzz install uninstall clean

all: vexyl

vexyl: $(SOURCES)
	cd go && $(GO) build -trimpath -o ../$@ ./cmd/vexyl

test:
	cd go && $(GO) test ./...

check: test
	cd go && $(GO) vet ./...
	python3 -m unittest discover -s tools
	@test -z "$$(gofmt -l go)" || { gofmt -l go; exit 1; }

conformance: vexyl
	python3 conformance/run.py ./vexyl

# Changes what every implementation must do, so review the diff.
conformance-fixtures: vexyl
	cd go && $(GO) test . -update
	python3 tools/build_conformance.py ./vexyl resvg

fuzz:
	cd go && $(GO) test -run '^$$' -fuzz '^FuzzSanitize$$' -fuzztime 60s .
	cd go && $(GO) test -run '^$$' -fuzz '^FuzzParse$$' -fuzztime 60s .

install: vexyl
	install -Dm755 vexyl $(DESTDIR)$(BINDIR)/vexyl

uninstall:
	rm -f $(DESTDIR)$(BINDIR)/vexyl

clean:
	rm -f vexyl
