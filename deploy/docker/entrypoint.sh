#!/bin/sh
set -eu
node --import tsx scripts/ops/validate-env.ts --runtime
exec "$@"
