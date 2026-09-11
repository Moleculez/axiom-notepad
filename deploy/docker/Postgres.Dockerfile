FROM postgres:16-bookworm
# Copy rather than execute a host-mounted script (some workspace mounts are
# noexec). Non-executable .sh init scripts are sourced by the official entrypoint.
COPY --chmod=644 deploy/docker/init-database.sh /docker-entrypoint-initdb.d/10-axiom.sh
