# Changelog

Add-on versions track the app image they wrap (`ghcr.io/illianoaoi/wiim-dashboard`).

## 0.3.11

- Initial Home Assistant add-on (beta). Wraps the published multi-arch image
  (amd64 + aarch64); maps add-on options to the app's environment; auto-generates
  and persists `AUTH_SECRET`; stores the SQLite database in the add-on's `/data`.
