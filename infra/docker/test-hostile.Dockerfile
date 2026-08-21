# raven/test-hostile — the image the runner's sandbox suite attacks itself with
# (10_INTEGRATIONS.md §13 point 4, 15_SECURITY.md §9).
#
# It contains nothing hostile by itself: the *test* supplies the hostile command, and this image
# only guarantees the shell utilities those commands need (sh, wget, head, yes, cp). Building it is
# CI's job (`.github/workflows/ci.yml`, docker job); on a machine without it the suite skips by name.
#
#   docker build -f infra/docker/test-hostile.Dockerfile -t raven/test-hostile:latest .
FROM alpine:3.21

# busybox already provides sh/wget/head/yes/cp; `true` is used by the exec-from-workdir assertion.
RUN adduser -D -u 65534 nobody2 || true
USER 65534:65534
WORKDIR /work
ENTRYPOINT []
CMD ["/bin/sh", "-c", "echo raven/test-hostile ready"]
