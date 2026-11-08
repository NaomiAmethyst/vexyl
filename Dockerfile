# The vexyl command. Build with: docker build -t vexyl .
#
# Base images are pinned by version and digest. To update one, pick the new tag and run
# `docker buildx imagetools inspect IMAGE:TAG` for its digest. Keep the Go version that of go/go.mod.

FROM --platform=$BUILDPLATFORM golang:1.25.7-alpine3.23@sha256:f6751d823c26342f9506c03797d2527668d095b0a15f1862cddb4d927a7a4ced AS build
ARG TARGETOS TARGETARCH
# Set for releases, so that `vexyl version` says which one this is.
ARG VERSION=
WORKDIR /src
COPY go/go.mod go/go.sum ./
RUN go mod download
COPY go/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/vexyl ./cmd/vexyl

FROM gcr.io/distroless/static-debian13:nonroot@sha256:25ac8f0c3b2334a9eb05452266bd4697864a8c8ef0ef71e5e6480d7f92868329
COPY --from=build /out/vexyl /usr/local/bin/vexyl
COPY LICENSE NOTICE /usr/share/doc/vexyl/
# Mount flags here: docker run --rm -v "$PWD:/work:ro" IMAGE check flags/sweden.kdl
WORKDIR /work
ENTRYPOINT ["vexyl"]
