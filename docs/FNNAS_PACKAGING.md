# fnOS Native Packaging

This project is packaged as a fnOS Native application that runs the Next.js standalone server with the system Node.js runtime.

## Build Flow

```bash
npm run build:fpk
```

Or run the stages separately:

```bash
npm run build
npm run prepare:fpk
npm run pack:fpk
```

The packer is built into the project and writes normalized Linux permissions and the `app.tgz` MD5 checksum. On Windows, the build wrapper dereferences pnpm links while Next.js creates the standalone directory, avoiding a second dependency installation.

## Runtime Notes

### Version 0.0.9

- Adds the read-only `find_device_usage` Web Agent tool, adapted from upstream PR #21, with incomplete-scan reporting and a 30-second request-wait budget.
- Uses the existing `nodejs_v22` dependency and Native lifecycle; no new dependency or permission is required.
- `package.json` is the version source. Keep `package-lock.json` in sync; `prepare:fpk` updates both manifests and `pack:fpk` writes `fnnas.mijia-geek-ai_<version>_x86.fpk`.
- The device-usage Skill reference is included under `server/.agents/` in `app.tgz` for runtime lookup.
- Local tests and FPK validation do not establish a successful real fnOS installation. After installing on a NAS, verify the displayed version, startup, retained settings and the new query tool.

### Paths and Configuration

- The package declares `install_dep_apps=nodejs_v22`.
- `cmd/main` starts `${TRIM_APPDEST}/server/server.js` on `${TRIM_SERVICE_PORT}` and falls back to port `3010`.
- Sessions are stored in `${TRIM_PKGVAR}/sessionstore` via `SESSION_STORE_DIR`.
- Runtime LLM, service port, and gateway settings are read from `${TRIM_PKGETC}/mijia-geek-ai.env`.
- `wizard/install` and `wizard/config` expose `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TEMPERATURE`, `APP_PORT`, `GATEWAY_TYPE`, and `GATEWAY_HOST`.
- Users select the Xiaomi hub version and enter only the gateway IP address; lifecycle scripts write `GATEWAY_URL=http://${GATEWAY_HOST}` for physical hubs and `GATEWAY_URL=http://${GATEWAY_HOST}:8086` for router hubs.
- `cmd/install_callback` and `cmd/config_callback` write those settings to `${TRIM_PKGETC}/mijia-geek-ai.env`; saving app settings restarts the service when it is already running.
