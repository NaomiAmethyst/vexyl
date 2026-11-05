# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Naomi Persephone Amethyst <naomi@amethyst.name>

PREFIX  ?= /usr/local
BINDIR  ?= $(PREFIX)/bin
DESTDIR ?=

GO      ?= go

SOURCES := $(shell find . -name '*.go') go.mod go.sum

.PHONY: all test check fuzz install uninstall clean

all: vexyl

vexyl: $(SOURCES)
	$(GO) build -trimpath -o $@ ./cmd/vexyl

test:
	$(GO) test ./...

check: test
	$(GO) vet ./...
	@test -z "$$(gofmt -l .)" || { gofmt -l .; exit 1; }

fuzz:
	$(GO) test -run '^$$' -fuzz '^FuzzSanitize$$' -fuzztime 60s .
	$(GO) test -run '^$$' -fuzz '^FuzzParse$$' -fuzztime 60s .

install: vexyl
	install -Dm755 vexyl $(DESTDIR)$(BINDIR)/vexyl

uninstall:
	rm -f $(DESTDIR)$(BINDIR)/vexyl

clean:
	rm -f vexyl
