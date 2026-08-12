# Home Assistant add-on wrapper for Wiim Dashboard.
#
# A thin layer over the published multi-arch image. All it adds is run.sh, which
# maps the add-on's options (written by the Supervisor to /data/options.json)
# onto the app's environment variables. The base image's own entrypoint still
# runs first — it fixes /data ownership and drops to the non-root app user
# (uid 1001) — and then execs run.sh, so run.sh runs unprivileged.
#
# Keep this tag in sync with `version:` in config.yaml — bump both together on
# each app release.
FROM ghcr.io/illianoaoi/wiim-dashboard:0.3.13

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
