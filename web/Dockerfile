# The editor, served by nginx on port 8080 as an unprivileged user. Build from the repository's
# root: docker build -f web/Dockerfile -t vexyl-web .
#
# Base images are pinned by version and digest. To update one, pick the new tag and run
# `docker buildx imagetools inspect IMAGE:TAG` for its digest.

# The build is the same files on every platform, so it runs natively.
FROM --platform=$BUILDPLATFORM node:22.22.3-alpine3.24@sha256:e58326d0d441090181ac150dc2078d3e2cf6a0d42e809aebba3ef5880935ffdd AS build
WORKDIR /src
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund
COPY LICENSE NOTICE ./
COPY docs/logo/ docs/logo/
COPY ts/tsconfig.json ts/
COPY ts/src/ ts/src/
COPY web/ web/
RUN node web/build.mjs /out

FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out/ /usr/share/nginx/html/
EXPOSE 8080
