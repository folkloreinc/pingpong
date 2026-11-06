#!/bin/sh
# Entry point of the Pingpong image. `serve`, `migrate`, `projects …` and `doctor` run the pingpong
# CLI, `pingpong …` too, and any other command runs as is (`sh`, `node -v`…).
set -eu

case "${1:-}" in
    '')
        echo 'Usage: docker run ghcr.io/folkloreinc/pingpong serve|migrate|projects …|doctor' >&2
        exit 64
        ;;
    serve | migrate | projects | doctor | --help)
        set -- pingpong "$@"
        ;;
esac

exec "$@"
