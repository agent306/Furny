# 17 — Deployment & Operations

Read the master document, `01-architecture.md` (stack, system diagram, the three Coolify application resources, queues, scheduler, engine CLI) and `02-data-model.md` first. This file is normative for **how Furny is built, configured, deployed, backed up, monitored and operated**. It gives complete file contents and click-by-click Coolify steps; an agent or the owner must be able to deploy from this file alone without asking questions.

Conventions used below:

- `furny.example.com` is the placeholder production domain. **Replace every occurrence** (including `ws.`, `cdn.`, `coolify.` sub-domains) with the real domain. Staging uses `staging.furny.example.com`, `ws-staging.furny.example.com`, `cdn-staging.furny.example.com`, `mail-staging.furny.example.com`.
- `<…>` marks a value you generate or copy from a provider dashboard; how to obtain each one is stated next to it.
- "Coolify" means **Coolify v4** (self-hosted, current 4.x release as of 2026-10). UI labels are quoted as they appear; where Coolify has renamed a toggle across 4.x releases, both names are given.

---

## 1. Decisions (summary)

| # | Decision | Rationale |
|---|---|---|
| O1 | Build pack **Nixpacks** for `furny-app`, `furny-reverb`, `furny-vision` | Owner's choice (master D2). Nixpacks is in maintenance mode upstream but fully supported by Coolify and used in Coolify's Laravel guide. Railpack migration path in Appendix A. |
| O2 | One container runs nginx + php-fpm + Horizon + scheduler + `pulse:check` under supervisord (`CONTAINER_ROLE=all`) | Coolify's documented Laravel pattern; cheapest at v1 scale. `start.sh` already supports `web`/`worker` roles for the later split (§15). |
| O3 | Supervisor confs, `php.ini`, `php-fpm.conf`, `start.sh` live as **real files in `docker/`** (not `[staticAssets]` in `nixpacks.toml`) | Lintable, diffable, testable locally; matches the repository layout in `01 §3`. |
| O4 | PHP ini overrides via `PHPRC=/app/docker/php.ini` set as an image variable | Nix PHP loads extensions through its own scan dir; `PHPRC` adds a main `php.ini` without touching that scan dir, and applies to every PHP process (php-fpm, Horizon, Reverb's start command, Coolify terminal). |
| O5 | **Migrations run in `start.sh` of the new container** (`php artisan migrate --force --isolated`) before nginx starts, only where `RUN_MIGRATIONS=true` (`furny-app`). No pre-/post-deployment commands. | Coolify's pre-deployment command runs in the **old** container (old code, skipped on first deploy); its post-deployment command cannot fail a deploy. In `start.sh` a failed migration exits the container → health check never passes → Coolify keeps the old container (rolling update) and marks the deploy failed. `--isolated` takes a Redis lock so two containers never migrate concurrently. |
| O6 | Health check = Laravel `/up` (shallow: framework boots), excluded from maintenance mode. A separate token-protected `/up/deep` reports dependencies for external monitoring. | A dependency blip (DB/S3) must not make Traefik drop the container (users would get a proxy error instead of Laravel's error page). |
| O7 | Internal services (`furny-vision`, `furny-gotenberg`) are Coolify applications **without domains and without port mappings**, with **"Consistent Container Names" ON**; reached at `http://<resource-uuid>:<port>` on the `coolify` Docker network | Stable hostname across deploys; never internet-exposed (`01 §9`). Cost: no rolling updates for these two (seconds of downtime per deploy; jobs retry). |
| O8 | Laravel publishes broadcasts to Reverb through its **public** hostname (`https://ws.furny.example.com:443`) | Reverb's container name changes on each rolling deploy; Traefik always routes to the healthy one. |
| O9 | `REVERB_SCALING_ENABLED=true` (Redis pub/sub) even with one Reverb container | During a rolling deploy two Reverb containers overlap; scaling mode delivers events to clients on both. |
| O10 | Object storage: **Cloudflare R2** (production + staging). MinIO only for local dev or air-gapped installs. | Zero egress fees, S3 API, custom domain for the public bucket. MinIO's community edition has been in maintenance mode since late 2025 (no new official images). |
| O11 | Backups to **Backblaze B2** (a different provider from R2): Postgres via Coolify scheduled backups (daily 14 days + monthly 12 months); objects via nightly `rclone sync` into a versioned bucket (deleted/overwritten versions kept 30 days) | A provider or account compromise must not take primary data and backups together. R2 has no object versioning we rely on. |
| O12 | Mail transport **Postmark** (`MAIL_MAILER=postmark`, per `12 §8`) | Best transactional deliverability; message streams; env-only switch to Resend/SES/SMTP. |
| O13 | DNS on Cloudflare, **DNS-only (grey cloud)** records for app, ws and Coolify; TLS by Coolify's Traefik (Let's Encrypt HTTP-01) | Correct client IPs for rate limiting/OTP abuse protection, no proxy timeouts on WebSockets/imports, R2 custom domain requires the zone on Cloudflare anyway. |
| O14 | Local dev = **native PHP 8.4 / Node 22 / Python 3.12 + `compose.dev.yaml` for backing services** (not Sail) | Sail's single PHP container cannot host the vision service and slows Vite HMR; native processes match CI; backing services are pinned to production versions. Windows developers use WSL2 (Horizon needs `pcntl`). |
| O15 | Branches: `develop` → staging, `main` → production; deploys triggered by GitHub Actions **after CI passes** via the Coolify API; Coolify auto-deploy OFF | Maps 1:1 to Coolify's branch-tracking resources; nothing reaches an environment without green CI. |
| O16 | Error tracking: **Sentry SaaS (optional)**, enabled only when DSNs are set | One tool for PHP, Vue and Python; self-hosted Sentry needs ≥ 16 GB RAM. |
| O17 | Uptime: **Better Stack Uptime (free tier)**, external to the server | A monitor on the same server cannot report the server being down. |
| O18 | Hosting: one **4 vCPU / 8 GB** VPS (production, also runs Coolify) + one **2 vCPU / 4 GB** VPS (staging), Ubuntu 24.04 LTS | Fits the memory budget in §4.2; staging isolated so experiments cannot starve production. |

---

## 2. Environments

| Env | Where | `APP_ENV` | Branch | Data | AI provider | Messaging | Purpose |
|---|---|---|---|---|---|---|---|
| local | developer machine | `local` | any | `DemoSeeder` | `none` or owner's keys | mail → Mailpit, SMS `log`, WhatsApp off | development |
| ci | GitHub Actions | `testing` | PRs, `develop`, `main` | factories | faked | faked | tests |
| staging | staging VPS via Coolify | `staging` | `develop` | `DemoSeeder` + manual tests; never production copies | `anthropic` with `claude-haiku-5-5` (cheap) | mail → Mailpit (staging), SMS `log`, WhatsApp only with Meta test number | release candidate verification |
| production | production VPS via Coolify | `production` | `main` | real | per owner settings (`02 §13 ai`) | all live | customers |

Rules: production data is never copied to staging or local (privacy, `13`). Restore drills (§12.5) restore into a **throw-away database on the staging server** and drop it afterwards.

---

## 3. Local development

### 3.1 Prerequisites

PHP 8.4 with extensions `pdo_pgsql redis gd exif intl bcmath pcntl posix zip fileinfo sodium` (macOS: Laravel Herd or `brew install php@8.4` + `pecl install redis`; Linux: `ppa:ondrej/php`; Windows: WSL2 Ubuntu), Composer 2, Node 22.12+ (`nvm install 22`), Python 3.12 + `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`), Docker with Compose v2.

### 3.2 `compose.dev.yaml` (repository root)

```yaml
# Backing services for local development. App processes run natively (see 17 §3.3).
name: furny-dev

services:
  pgsql:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: furny
      POSTGRES_USER: furny
      POSTGRES_PASSWORD: secret
    ports: ["127.0.0.1:5432:5432"]
    volumes:
      - pgsql:/var/lib/postgresql          # PG 18 images keep data under /var/lib/postgresql/18/docker
      - ./docker/dev/pg-init.sql:/docker-entrypoint-initdb.d/10-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U furny -d furny"]
      interval: 5s
      retries: 20

  redis:
    image: redis:7.4-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    ports: ["127.0.0.1:6379:6379"]
    volumes: [redis:/data]

  minio:
    image: minio/minio:latest   # frozen community image; local dev only (17 §1 O10)
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: furny
      MINIO_ROOT_PASSWORD: furny-secret
      MINIO_API_CORS_ALLOW_ORIGIN: "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5173"
    ports: ["127.0.0.1:9000:9000", "127.0.0.1:9001:9001"]
    volumes: [minio:/data]

  minio-init:
    image: minio/mc:latest
    depends_on: [minio]
    restart: "no"
    entrypoint: >
      /bin/sh -c "
      until mc alias set local http://minio:9000 furny furny-secret; do sleep 1; done;
      mc mb -p local/furny-private local/furny-public;
      mc anonymous set download local/furny-public;
      exit 0"

  gotenberg:
    image: gotenberg/gotenberg:8
    ports: ["127.0.0.1:3000:3000"]

  mailpit:
    image: axllent/mailpit:latest
    ports: ["127.0.0.1:1025:1025", "127.0.0.1:8025:8025"]

volumes:
  pgsql: {}
  redis: {}
  minio: {}
```

`docker/dev/pg-init.sql`:

```sql
CREATE DATABASE furny_test OWNER furny;
```

### 3.3 Running the app

`composer.json` `scripts.dev` (replaces the starter-kit script):

```json
"dev": [
    "Composer\\Config::disableProcessTimeout",
    "npx concurrently -c \"#93c5fd,#c4b5fd,#fb7185,#fdba74,#86efac,#fde047\" \"php artisan serve --port=8000\" \"php artisan horizon\" \"php artisan reverb:start --debug\" \"php artisan schedule:work\" \"php artisan pail --timeout=0\" \"npm run dev\" --names=server,horizon,reverb,schedule,logs,vite --kill-others"
]
```

First run:

```bash
docker compose -f compose.dev.yaml up -d
cp .env.example .env && php artisan key:generate
composer install && npm ci && npm run build:engine-cli
php artisan migrate --seed && php artisan db:seed --class=DemoSeeder
php artisan webpush:vapid                      # writes VAPID_* into .env
composer dev                                   # http://localhost:8000, Mailpit http://localhost:8025, MinIO console http://localhost:9001
# vision service (second terminal):
cd vision && uv sync && uv run uvicorn app.main:app --reload --port 8001
```

`.env.example` must contain **every** variable of §6.1 with its "Local" column value (secrets empty). PDF Blade templates must embed images as data URIs (Gotenberg runs in Docker and cannot reach `localhost` URLs, and in production it must not need internet access).

---

## 4. Production topology on Coolify

### 4.1 Resources (one Coolify project `Furny`, environments `production` and `staging`)

| Resource | Coolify type | Source / image | Listens | Domain | Health check | Memory limit | Persistent storage |
|---|---|---|---|---|---|---|---|
| `furny-app` | Application, Nixpacks | repo, base dir `/`, branch `main` | 80 | `https://furny.example.com` | HTTP `GET /up` :80 | 2560m | none (stateless) |
| `furny-reverb` | Application, Nixpacks | same repo/branch, start command `php artisan reverb:start --host=0.0.0.0 --port=8080` | 8080 | `https://ws.furny.example.com` | CMD TCP probe :8080 | 384m | none |
| `furny-vision` | Application, Nixpacks (Python) | same repo, base dir `/vision` | 8000 | **none** | HTTP `GET /health` :8000 | 3584m | none (OCR models baked into image) |
| `furny-gotenberg` | Application, Docker Image | `gotenberg/gotenberg:8` | 3000 | **none** | HTTP `GET /health` :3000 | 1024m | none |
| `furny-postgres` | Database, PostgreSQL | `postgres:18-alpine` | 5432 | none (not public) | Coolify built-in | 2048m | Coolify volume |
| `furny-redis` | Database, Redis | `redis:7.4-alpine` | 6379 | none (not public) | Coolify built-in | 1024m | Coolify volume |
| `furny-mailpit` (staging only) | Service (one-click Mailpit) | — | 8025 | `https://mail-staging.furny.example.com` (Basic Auth) | — | 128m | none |

No resource has **Ports Mappings** (they bypass Traefik and block rolling updates). Everything talks over the Coolify destination network `coolify`.

### 4.2 Memory budget (production, 8 GB + 4 GB swap)

| Component | Typical | Peak / limit |
|---|---|---|
| Coolify stack (coolify, coolify-db, coolify-redis, realtime, Traefik) | 0.8 GB | 1.0 GB |
| `furny-app` (nginx, 12 FPM children, Horizon 9 workers, scheduler, pulse:check, engine CLI spawns) | 1.2 GB | 2.5 GB |
| `furny-reverb` | 0.1 GB | 0.4 GB |
| `furny-vision` (2 uvicorn workers, OpenCV/ONNX) | 1.0 GB | 3.5 GB |
| `furny-gotenberg` (Chromium) | 0.3 GB | 1.0 GB |
| `furny-postgres` | 0.8 GB | 2.0 GB |
| `furny-redis` | 0.1 GB | 1.0 GB |
| **Total** | **≈ 4.3 GB** | peaks absorbed by swap |

Upgrade trigger: swap used > 1 GB for more than an hour on 3 days in a week, or any OOM kill (exit code 137) of `furny-vision` → move to 8 vCPU / 16 GB (§15).

---

## 5. Repository deployment files (complete contents)

### 5.1 `.dockerignore` (repository root, used by `furny-app` and `furny-reverb` builds)

```
.git
.github
node_modules
vendor
vision
docs
tests/Browser/screenshots
storage/logs/*
storage/framework/cache/data/*
storage/framework/sessions/*
storage/framework/views/*
bootstrap/cache/*.php
.env
.env.*
!.env.example
compose.dev.yaml
```

### 5.2 `nixpacks.toml` (repository root)

```toml
# Nixpacks plan for furny-app and furny-reverb (PHP provider, Laravel detected via ./artisan).
# Spec: docs/superpowers/specs/2026-10-20-furny/17-deployment-ops.md §5.2

[variables]
NIXPACKS_NODE_VERSION = "22"          # Vite 8 needs Node >= 22.12; engine CLI needs Node 22 at RUNTIME
PHPRC = "/app/docker/php.ini"         # main php.ini for every PHP process (17 §1 O4)
NIXPACKS_PHP_ROOT_DIR = "/app/public"

[phases.setup]
# "..." keeps the provider defaults (php84 + composer ext-* extensions, nginx, nodejs_22).
nixPkgs = ["...", "python311Packages.supervisor", "curl", "rclone"]

[phases.install]
cmds = [
  "mkdir -p /var/log/nginx /var/cache/nginx /tmp/nginx",
  "composer install --no-interaction --prefer-dist --optimize-autoloader --ignore-platform-reqs",
  "npm ci --no-audit --no-fund",
]

[phases.build]
cmds = [
  "bash docker/check-runtime.sh",
  "npm run build",                      # app bundle + engine-cli/dist/cli.mjs (01 §5.4)
  "test -f engine-cli/dist/cli.mjs",
  "echo '{}' | node engine-cli/dist/cli.mjs version",
  "rm -rf node_modules",                # runtime needs no node_modules: the engine CLI is fully bundled
  "chmod +x docker/start.sh docker/check-runtime.sh docker/backup-objects.sh",
]

[start]
cmd = "bash /app/docker/start.sh"
```

Notes:
- `composer install` honours the build variable `COMPOSER_NO_DEV` (`1` in production, `0` in staging so Telescope is installed).
- `--ignore-platform-reqs` matches the Nixpacks default; extensions are asserted explicitly by `docker/check-runtime.sh` instead (clear error message).
- Do **not** add `nodejs_22` to `nixPkgs` while `"..."` is present: the provider already adds the Node package selected by `NIXPACKS_NODE_VERSION`, and two Node packages collide in the Nix environment. If the build fails with `Node 22 required`, see Appendix B.

### 5.3 `docker/check-runtime.sh`

```bash
#!/usr/bin/env bash
# Asserts the image has everything Furny needs. Runs at build time (nixpacks.toml) and at container start.
set -euo pipefail
fail() { echo "[check-runtime] FAIL: $*" >&2; exit 1; }

command -v node >/dev/null || fail "node not on PATH"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" = "22" ] || fail "Node 22 required (engine CLI + Vite 8), found $(node -v)"

php -r 'exit(PHP_MAJOR_VERSION === 8 && PHP_MINOR_VERSION === 4 ? 0 : 1);' \
  || fail "PHP 8.4 required, found $(php -r 'echo PHP_VERSION;')"

php -r '
$need = ["pdo_pgsql","redis","gd","exif","intl","bcmath","pcntl","posix","zip","fileinfo","sodium","Zend OPcache"];
$missing = array_values(array_filter($need, fn ($e) => !extension_loaded($e)));
if ($missing) { fwrite(STDERR, "missing PHP extensions: ".implode(", ", $missing)."\n"); exit(1); }
' || fail "required PHP extensions missing (declare them as ext-* in composer.json require)"

[ "$(php -r 'echo ini_get("memory_limit");')" = "512M" ] \
  || fail "docker/php.ini not loaded (PHPRC=${PHPRC:-unset}); see 17 Appendix B"

for bin in nginx php-fpm supervisord supervisorctl curl rclone; do
  command -v "$bin" >/dev/null || fail "$bin not on PATH"
done
id www-data >/dev/null 2>&1 || fail "user www-data missing in base image"

echo "[check-runtime] OK: node $(node -v), PHP $(php -r 'echo PHP_VERSION;'), $(nginx -v 2>&1)"
```

### 5.4 `docker/start.sh`

```bash
#!/usr/bin/env bash
# Entrypoint of furny-app (and furny-worker after the split, 17 §15).
# CONTAINER_ROLE: all (default) = nginx + php-fpm + horizon + scheduler + pulse-check
#                 web           = nginx + php-fpm
#                 worker        = horizon + scheduler + pulse-check
# RUN_MIGRATIONS=true runs `migrate --isolated` before any process starts (only on furny-app).
set -Eeuo pipefail
cd /app

ROLE="${CONTAINER_ROLE:-all}"
log() { echo "[start.sh] $(date -u +%FT%TZ) $*"; }

case "$ROLE" in
  all)    PROGRAMS=(php-fpm nginx horizon scheduler pulse-check) ;;
  web)    PROGRAMS=(php-fpm nginx) ;;
  worker) PROGRAMS=(horizon scheduler pulse-check) ;;
  *) log "Unknown CONTAINER_ROLE=$ROLE (expected all|web|worker)"; exit 1 ;;
esac

# 1. Image sanity (same checks as the build).
bash /app/docker/check-runtime.sh

# 2. Required configuration.
for v in APP_KEY APP_URL DB_HOST DB_DATABASE DB_USERNAME DB_PASSWORD REDIS_HOST; do
  [ -n "${!v:-}" ] || { log "Missing required env var $v"; exit 1; }
done
export ENGINE_NODE_BINARY="${ENGINE_NODE_BINARY:-$(command -v node)}"

# 3. Wait for Postgres and Redis (max 60 s each).
wait_for() {
  local name="$1"; shift
  for _ in $(seq 1 30); do
    if "$@" >/dev/null 2>&1; then log "$name reachable"; return 0; fi
    sleep 2
  done
  log "$name not reachable after 60 s"; return 1
}
wait_for postgres php -r '
  new PDO(sprintf("pgsql:host=%s;port=%s;dbname=%s;connect_timeout=2", getenv("DB_HOST"), getenv("DB_PORT") ?: "5432", getenv("DB_DATABASE")),
          getenv("DB_USERNAME"), getenv("DB_PASSWORD"));'
wait_for redis php -r '
  $r = new Redis(); $r->connect(getenv("REDIS_HOST"), (int) (getenv("REDIS_PORT") ?: 6379), 2.0);
  if (getenv("REDIS_PASSWORD")) { $r->auth(getenv("REDIS_PASSWORD")); }
  exit($r->ping() ? 0 : 1);'

# 4. Writable dirs + framework caches (env is only known at runtime, so caches are built here).
mkdir -p storage/framework/{cache/data,sessions,views,testing} storage/logs storage/app/private \
         storage/media-library/temp bootstrap/cache /tmp/nginx /var/log/nginx
php artisan optimize --no-interaction          # config, events, routes, views

# 5. Migrations (new code, new container, before traffic). Failure => container exits => deploy fails, old container keeps serving.
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  log "Running migrations"
  php artisan migrate --force --isolated --no-interaction
fi
chown -R www-data:www-data storage bootstrap/cache

# 6. Supervisor programs for this role.
CONF_DIR=/etc/supervisor/conf.d
rm -rf "$CONF_DIR" && mkdir -p "$CONF_DIR"
for p in "${PROGRAMS[@]}"; do cp "/app/docker/supervisor/$p.conf" "$CONF_DIR/"; done

# 7. Render nginx config: replace $!{nginx} with the Nix store path of the nginx package.
if [[ " ${PROGRAMS[*]} " == *" nginx "* ]]; then
  NGINX_PREFIX="$(dirname "$(dirname "$(readlink -f "$(command -v nginx)")")")"
  sed -e 's|\$!{nginx}|'"$NGINX_PREFIX"'|g' /app/nginx.template.conf > /etc/nginx.conf
  nginx -t -c /etc/nginx.conf
fi

log "Starting supervisord (role=$ROLE, programs=${PROGRAMS[*]})"
exec supervisord -n -c /app/docker/supervisor/supervisord.conf
```

### 5.5 `docker/php.ini`

```ini
; Main php.ini for all PHP processes (loaded via PHPRC, 17 §1 O4). Extensions are loaded by Nix's scan dir.
memory_limit = 512M
max_execution_time = 60          ; web requests (CLI is unlimited; job timeouts come from Horizon, 01 §7)
max_input_time = 60
max_input_vars = 5000
post_max_size = 55M
upload_max_filesize = 50M        ; browser uploads go to S3 via presigned PUT; this covers JSON autosave bodies and fallbacks
max_file_uploads = 20
expose_php = Off
date.timezone = UTC
default_charset = "UTF-8"
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = /dev/stderr
error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
zend.exception_ignore_args = On
realpath_cache_size = 4096K
realpath_cache_ttl = 600

opcache.enable = 1
opcache.enable_cli = 0
opcache.memory_consumption = 256
opcache.interned_strings_buffer = 32
opcache.max_accelerated_files = 50000
opcache.validate_timestamps = 0  ; images are immutable; a deploy is a new container
opcache.save_comments = 1        ; required by attribute-based packages (spatie/laravel-data)
opcache.jit = disable
```

### 5.6 `docker/php-fpm.conf`

```ini
[global]
error_log = /proc/self/fd/2
log_limit = 8192
daemonize = no

[www]
user = www-data
group = www-data
listen = 127.0.0.1:9000
pm = dynamic
pm.max_children = 12             ; ~60 MB typical per child → ~0.7 GB; raise with RAM (17 §15)
pm.start_servers = 4
pm.min_spare_servers = 2
pm.max_spare_servers = 6
pm.max_requests = 1000
request_terminate_timeout = 120s
clear_env = no                   ; Coolify env vars must reach PHP
catch_workers_output = yes
decorate_workers_output = no
```

### 5.7 Supervisor (`docker/supervisor/`)

`docker/supervisor/supervisord.conf`:

```ini
[unix_http_server]
file=/tmp/supervisor.sock
chmod=0700

[supervisord]
nodaemon=true
user=root
logfile=/dev/stdout
logfile_maxbytes=0
loglevel=info
pidfile=/tmp/supervisord.pid

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///tmp/supervisor.sock

[include]
files = /etc/supervisor/conf.d/*.conf
```

`docker/supervisor/php-fpm.conf`:

```ini
[program:php-fpm]
command=php-fpm --nodaemonize --fpm-config /app/docker/php-fpm.conf
priority=10
autostart=true
autorestart=true
startsecs=3
stopsignal=QUIT
stopwaitsecs=30
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
```

`docker/supervisor/nginx.conf`:

```ini
[program:nginx]
command=nginx -c /etc/nginx.conf
priority=20
autostart=true
autorestart=true
startsecs=3
stopsignal=QUIT
stopwaitsecs=30
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
```

`docker/supervisor/horizon.conf`:

```ini
[program:horizon]
command=php /app/artisan horizon
user=www-data
environment=HOME="/tmp"
priority=30
autostart=true
autorestart=true
startsecs=5
stopsignal=TERM
stopwaitsecs=120
killasgroup=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
```

`docker/supervisor/scheduler.conf`:

```ini
[program:scheduler]
command=php /app/artisan schedule:work
user=www-data
environment=HOME="/tmp"
priority=40
autostart=true
autorestart=true
startsecs=5
stopsignal=TERM
stopwaitsecs=60
killasgroup=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
```

`docker/supervisor/pulse-check.conf`:

```ini
[program:pulse-check]
command=php /app/artisan pulse:check
user=www-data
environment=HOME="/tmp"
priority=50
autostart=true
autorestart=true
startsecs=5
stopsignal=TERM
stopwaitsecs=15
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
redirect_stderr=true
```

There is **no** `queue:work` program: Horizon manages all queue workers (`01 §7`). Inspect processes in the Coolify terminal with `supervisorctl -c /app/docker/supervisor/supervisord.conf status`.

### 5.8 `nginx.template.conf` (repository root)

`docker/start.sh` renders it to `/etc/nginx.conf`, replacing `$!{nginx}` with the Nix nginx package path. Do not use `${…}` syntax anywhere in this file.

```nginx
user www-data www-data;
worker_processes auto;
daemon off;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
worker_rlimit_nofile 8192;

events {
    worker_connections 2048;
}

http {
    include       $!{nginx}/conf/mime.types;
    types {
        application/manifest+json webmanifest;
    }
    default_type  application/octet-stream;

    # Health checks are not logged.
    map $request_uri $furny_loggable {
        ~^/up(\?|$) 0;
        default     1;
    }
    log_format furny '$http_x_forwarded_for [$time_local] "$request" $status $body_bytes_sent '
                     '"$http_referer" "$http_user_agent" rt=$request_time';
    access_log /dev/stdout furny if=$furny_loggable;

    # HSTS only when the browser reached Traefik over HTTPS.
    map $http_x_forwarded_proto $furny_hsts {
        https   "max-age=31536000";
        default "";
    }
    map $http_x_forwarded_proto $furny_https {
        https   on;
        default "";
    }

    sendfile           on;
    tcp_nopush         on;
    tcp_nodelay        on;
    keepalive_timeout  65;
    server_tokens      off;
    types_hash_max_size 2048;
    server_names_hash_bucket_size 128;

    client_max_body_size    50m;
    client_body_buffer_size 1m;
    client_body_temp_path   /tmp/nginx/client_body;
    proxy_temp_path         /tmp/nginx/proxy;
    fastcgi_temp_path       /tmp/nginx/fastcgi;
    uwsgi_temp_path         /tmp/nginx/uwsgi;
    scgi_temp_path          /tmp/nginx/scgi;

    gzip              on;
    gzip_comp_level   5;
    gzip_min_length   1024;
    gzip_proxied      any;
    gzip_vary         on;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json
               application/xml application/manifest+json image/svg+xml font/ttf font/otf;

    server {
        listen 80 default_server;
        server_name _;
        root /app/public;
        index index.php;
        charset utf-8;

        # Static security headers are owned by nginx. CSP (with the Vite nonce) and X-Robots-Tag
        # are owned by Laravel middleware (13). Never set the same header in both places.
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
        add_header Strict-Transport-Security $furny_hsts always;

        # Vite build output: content-hashed file names → cache forever.
        location /build/ {
            access_log off;
            expires max;
            add_header Cache-Control "public, max-age=31536000, immutable" always;
            add_header X-Content-Type-Options "nosniff" always;
            try_files $uri =404;
        }

        # Web push service worker (12 §8.3): never cached, scope "/".
        location = /sw.js {
            add_header Cache-Control "no-cache" always;
            add_header Service-Worker-Allowed "/" always;
            add_header X-Content-Type-Options "nosniff" always;
            try_files $uri =404;
        }

        location = /favicon.ico { access_log off; log_not_found off; }
        location = /robots.txt  { access_log off; log_not_found off; }

        location / {
            try_files $uri $uri/ /index.php?$query_string;
        }

        error_page 404 /index.php;

        location ~ ^/index\.php(/|$) {
            fastcgi_pass 127.0.0.1:9000;
            fastcgi_split_path_info ^(.+\.php)(/.*)$;
            include $!{nginx}/conf/fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
            fastcgi_param DOCUMENT_ROOT   $realpath_root;
            fastcgi_param PATH_INFO       $fastcgi_path_info;
            fastcgi_param HTTPS           $furny_https if_not_empty;
            # Inertia responses carry large headers/bodies.
            fastcgi_buffer_size       32k;
            fastcgi_buffers           16 32k;
            fastcgi_busy_buffers_size 64k;
            fastcgi_read_timeout      120s;
            fastcgi_hide_header X-Powered-By;
        }

        location ~ \.php$ { return 404; }

        location ~ /\.(?!well-known).* { deny all; }
    }
}
```

### 5.9 `vision/nixpacks.toml`

```toml
# Nixpacks plan for furny-vision (Python provider). Coolify base directory: /vision
providers = ["python"]

[variables]
NIXPACKS_PYTHON_VERSION = "3.12"
PYTHONUNBUFFERED = "1"
PYTHONDONTWRITEBYTECODE = "1"
PIP_NO_CACHE_DIR = "1"
OMP_NUM_THREADS = "2"               # OpenCV/ONNX threads per worker; prevents CPU oversubscription

[phases.setup]
nixPkgs = ["...", "curl"]
# rapidocr pulls opencv-python (non-headless), which needs libGL/glib at import time.
nixLibs = ["...", "libGL", "glib", "zlib", "stdenv.cc.cc.lib"]
aptPkgs = ["libgl1", "libglib2.0-0"]

[phases.build]
cmds = [
  'python -c "import cv2, numpy, scipy, shapely, onnxruntime, rapidocr, pdfplumber, pypdfium2, ezdxf, pi_heif, fastapi; print(cv2.__version__)"',
  'python -c "from rapidocr import RapidOCR; RapidOCR()"',
]

[start]
cmd = "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-graceful-shutdown 30"
```

- The default Python install phase (`python -m venv /opt/venv && pip install -r requirements.txt`) is kept. `vision/requirements.txt` is **generated** from `vision/pyproject.toml` + `uv.lock` with `uv export --frozen --no-dev --no-hashes --no-emit-project -o requirements.txt` and committed; CI fails if it is stale (§10.3).
- The second build command downloads the RapidOCR ONNX models into the image so the first recognition does not download at runtime.
- No `Procfile`: `[start] cmd` is the single source of truth.

`vision/.dockerignore`:

```
.venv
__pycache__
.pytest_cache
.mypy_cache
.ruff_cache
```

### 5.10 `docker/backup-objects.sh` (object-storage backup, run by a Coolify Scheduled Task, §12.3)

```bash
#!/usr/bin/env bash
# Mirrors both object-storage buckets into the versioned Backblaze B2 bucket.
# B2 keeps overwritten/deleted versions (lifecycle: 30 days), so `sync` is safe.
set -euo pipefail
[ "${OBJECT_BACKUP_ENABLED:-false}" = "true" ] || { echo "object backup disabled"; exit 0; }

export RCLONE_CONFIG_SRC_TYPE=s3
export RCLONE_CONFIG_SRC_PROVIDER="${OBJECT_BACKUP_SRC_PROVIDER:-Cloudflare}"   # Cloudflare | Minio
export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SRC_ENDPOINT="$AWS_ENDPOINT"
export RCLONE_CONFIG_SRC_REGION="${AWS_DEFAULT_REGION:-auto}"
export RCLONE_CONFIG_DST_TYPE=b2
export RCLONE_CONFIG_DST_ACCOUNT="$OBJECT_BACKUP_B2_KEY_ID"
export RCLONE_CONFIG_DST_KEY="$OBJECT_BACKUP_B2_APP_KEY"

for bucket in "$AWS_BUCKET" "$AWS_PUBLIC_BUCKET"; do
  echo "Syncing $bucket"
  rclone sync "src:$bucket" "dst:$OBJECT_BACKUP_B2_BUCKET/$bucket" \
    --fast-list --transfers 8 --checkers 16 --stats-one-line --stats 60s
done
echo "object backup finished"
```

### 5.11 Laravel configuration required by deployment

These are code requirements the implementing agents must satisfy (also listed in the appendix for the owning documents):

1. **Trusted proxies** — `bootstrap/app.php`: `$middleware->trustProxies(at: '*');` Safe because containers are reachable only through Traefik (no port mappings).
2. **Maintenance mode must not break health checks** — `$middleware->preventRequestsDuringMaintenance(except: ['up', 'up/deep']);` and `APP_MAINTENANCE_DRIVER=cache`, `APP_MAINTENANCE_STORE=redis` so `php artisan down` affects every container.
3. **No DB/Redis/HTTP access while booting** (service providers, config files): the image build runs `artisan` (Wayfinder generation in `npm run build`) without databases, and `/up` must answer while Postgres is down.
4. **Queue connections** — `config/queue.php`: connection `redis` (`retry_after` 180) for `default`, `engine`, `pdf`, `notify`; connection `redis-long` (same Redis, `retry_after` 720) for `imports` (timeout 660 s, `01 §7`). `retry_after` must always exceed the longest job timeout on the connection or jobs run twice. Horizon supervisors reference these connections; `config/horizon.php` has an `environments.staging` block with 1 process per queue.
5. **Scheduler** — every task in `routes/console.php` uses `->onOneServer()->withoutOverlapping()` (during a rolling deploy two schedulers overlap for up to a minute).
6. **Filesystems** — `config/filesystems.php`:

   ```php
   's3' => [
       'driver' => 's3',
       'key' => env('AWS_ACCESS_KEY_ID'),
       'secret' => env('AWS_SECRET_ACCESS_KEY'),
       'region' => env('AWS_DEFAULT_REGION', 'auto'),
       'bucket' => env('AWS_BUCKET'),
       'url' => env('AWS_URL'),
       'endpoint' => env('AWS_ENDPOINT'),
       'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', true),
       'visibility' => 'private',
       'throw' => true,
       'report' => true,
   ],
   's3-public' => [
       'driver' => 's3',
       'key' => env('AWS_ACCESS_KEY_ID'),
       'secret' => env('AWS_SECRET_ACCESS_KEY'),
       'region' => env('AWS_DEFAULT_REGION', 'auto'),
       'bucket' => env('AWS_PUBLIC_BUCKET'),
       'url' => env('AWS_PUBLIC_URL'),
       'endpoint' => env('AWS_ENDPOINT'),
       'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', true),
       'visibility' => 'public',
       'throw' => true,
       'report' => true,
   ],
   ```

   R2 ignores object ACLs; public read for `s3-public` comes from the bucket's custom domain (§7.4).
7. **Reverb** — `config/reverb.php` app entry: `'allowed_origins' => explode(',', env('REVERB_ALLOWED_ORIGINS', '*'))`; scaling reads `REVERB_SCALING_ENABLED`/`REVERB_SCALING_CHANNEL` (package defaults).
8. **Engine CLI binary** — `App\Support\Engine\EngineCli` uses `config('engine.node_binary')` (`config/engine.php`: `'node_binary' => env('ENGINE_NODE_BINARY', 'node')`) instead of the literal `'node'`; `start.sh` exports the absolute path.
9. **App version** — `config('app.version')` = `env('APP_VERSION') ?: substr((string) env('SOURCE_COMMIT', 'dev'), 0, 7)`; shared as `app.version` (`01 §6`). Coolify provides `SOURCE_COMMIT` when "Include Source Commit in Build" is ON.
10. **Telescope** — `composer.json` `extra.laravel.dont-discover: ["laravel/telescope"]`; `AppServiceProvider::register()` registers `TelescopeServiceProvider` only when `class_exists(\Laravel\Telescope\TelescopeServiceProvider::class) && config('telescope.enabled')` (`TELESCOPE_ENABLED`).
11. **Stale chunk recovery** — `resources/js/app.ts`: `window.addEventListener('vite:preloadError', () => window.location.reload())` (a lazy editor chunk can 404 for a user whose page was rendered by the previous release).
12. **Dashboards** — gates `viewHorizon`, `viewPulse`, `viewTelescope` allow only staff with role `owner` or `admin`.
13. **Health endpoints** — `/up` (framework default, shallow). `GET /up/deep` (route name `health.deep`, controller `App\Http\Controllers\HealthController`) requires header `X-Health-Token` or query `?token=` equal to `HEALTH_CHECK_TOKEN` (else 404); returns JSON `{status: "ok"|"degraded"|"down", version, checks: {database, redis, horizon, scheduler, storage, vision, gotenberg, reverb}}` where each check is `{ok: bool, ms: int, error?: string}`. HTTP 200 when `database`, `redis`, `horizon`, `scheduler` are ok (status `ok` or `degraded`), else 503. `scheduler` is ok when the cache key `health:scheduler:heartbeat` (written every minute by a scheduled closure) is younger than 3 minutes; `horizon` uses `MasterSupervisorRepository::all()` non-empty and not paused; `storage` = `Storage::disk('s3')->exists('health/probe.txt')` (file written by the first-deploy runbook); `vision` = `GET {VISION_SERVICE_URL}/health`; `gotenberg` = `GET {GOTENBERG_URL}/health`; `reverb` = `Broadcast::connection('reverb')->getPusher()->get('/channels')`. Each external check has a 3-second timeout.

---

## 6. Environment variables

### 6.1 `furny-app` and `furny-reverb` (identical blocks)

"B" = must be marked **build-time** in Coolify ("Available at Buildtime" / older UI: "Build Variable?"); all variables are also runtime. "Req" = required in production.

| Variable | Production value / how to get it | Local | Req | Notes |
|---|---|---|---|---|
| `APP_NAME` | business brand, e.g. `Furny` | `Furny` | ✔ | display name only (master header) |
| `APP_ENV` | `production` | `local` | ✔ | staging: `staging` |
| `APP_KEY` | `base64:<php artisan key:generate --show>` | generated | ✔ | **never change** without `APP_PREVIOUS_KEYS`; store in password manager |
| `APP_PREVIOUS_KEYS` | empty | empty | | comma-separated old keys during key rotation |
| `APP_DEBUG` | `false` | `true` | ✔ | `false` on staging too |
| `APP_URL` | `https://furny.example.com` | `http://localhost:8000` | ✔ | |
| `APP_LOCALE` / `APP_FALLBACK_LOCALE` | `en` / `en` | same | ✔ | |
| `APP_FAKER_LOCALE` | `en_IN` | `en_IN` | | |
| `APP_MAINTENANCE_DRIVER` | `cache` | `file` | ✔ | §14 |
| `APP_MAINTENANCE_STORE` | `redis` | — | ✔ | |
| `APP_VERSION` | empty (derived from `SOURCE_COMMIT`) | `dev` | | §5.11 item 9 |
| `BCRYPT_ROUNDS` | `12` | `12` | | |
| `CONTAINER_ROLE` | `all` | — | | `web`/`worker` after split (§15) |
| `RUN_MIGRATIONS` | `true` on `furny-app`; `false` on `furny-reverb` | — | ✔ | the only per-resource difference |
| `LOG_CHANNEL` | `stack` | `stack` | ✔ | |
| `LOG_STACK` | `stderr` | `single` | ✔ | Coolify captures stdout/stderr |
| `LOG_LEVEL` | `info` | `debug` | ✔ | staging: `debug` |
| `LOG_DEPRECATIONS_CHANNEL` | `null` | `null` | | |
| `DB_CONNECTION` | `pgsql` | `pgsql` | ✔ | |
| `DB_HOST` | `<furny-postgres UUID>` (from its "Postgres URL (internal)") | `127.0.0.1` | ✔ | |
| `DB_PORT` | `5432` | `5432` | ✔ | |
| `DB_DATABASE` | `furny` | `furny` | ✔ | |
| `DB_USERNAME` | `furny` | `furny` | ✔ | |
| `DB_PASSWORD` | Coolify-generated | `secret` | ✔ | |
| `REDIS_CLIENT` | `phpredis` | `phpredis` | ✔ | |
| `REDIS_HOST` | `<furny-redis UUID>` | `127.0.0.1` | ✔ | |
| `REDIS_PASSWORD` | Coolify-generated | empty | ✔ | |
| `REDIS_PORT` | `6379` | `6379` | ✔ | |
| `REDIS_DB` / `REDIS_CACHE_DB` | `0` / `1` | same | ✔ | |
| `REDIS_PREFIX` | `furny_` | `furny_` | ✔ | fixed so renaming `APP_NAME` never orphans keys |
| `CACHE_STORE` | `redis` | `redis` | ✔ | |
| `CACHE_PREFIX` | `furny_cache_` | same | ✔ | |
| `QUEUE_CONNECTION` | `redis` | `redis` | ✔ | |
| `SESSION_DRIVER` | `redis` | `redis` | ✔ | |
| `SESSION_LIFETIME` | `120` | `120` | ✔ | |
| `SESSION_ENCRYPT` | `false` | `false` | | |
| `SESSION_SECURE_COOKIE` | `true` | `false` | ✔ | |
| `SESSION_SAME_SITE` | `lax` | `lax` | | |
| `SESSION_DOMAIN` | `null` | `null` | | host-only cookie |
| `SESSION_COOKIE` | `furny_session` | `furny_session` | ✔ | fixed name (independent of `APP_NAME`); change only to force global logout (§16.9) |
| `HORIZON_PREFIX` | `furny_horizon:` | same | ✔ | |
| `HORIZON_NOTIFY_EMAIL` | owner's email | empty | ✔ | Horizon long-wait/failure mails |
| `BROADCAST_CONNECTION` | `reverb` | `reverb` | ✔ | |
| `REVERB_APP_ID` | `openssl rand -hex 8` | `furny-local` | ✔ | |
| `REVERB_APP_KEY` | `openssl rand -hex 16` | `localkey` | ✔ | |
| `REVERB_APP_SECRET` | `openssl rand -hex 32` | `localsecret` | ✔ | |
| `REVERB_HOST` | `ws.furny.example.com` | `localhost` | ✔ | public host used by Laravel to publish (O8) |
| `REVERB_PORT` | `443` | `8080` | ✔ | |
| `REVERB_SCHEME` | `https` | `http` | ✔ | |
| `REVERB_SERVER_HOST` | `0.0.0.0` | `0.0.0.0` | ✔ | |
| `REVERB_SERVER_PORT` | `8080` | `8080` | ✔ | |
| `REVERB_SCALING_ENABLED` | `true` | `false` | ✔ | O9 |
| `REVERB_SCALING_CHANNEL` | `furny_reverb` | — | | |
| `REVERB_ALLOWED_ORIGINS` | `furny.example.com` | `*` | ✔ | comma-separated hosts |
| `VITE_REVERB_APP_KEY` | same as `REVERB_APP_KEY` | `localkey` | ✔ B | literal value (Coolify does not interpolate) |
| `VITE_REVERB_HOST` | `ws.furny.example.com` | `localhost` | ✔ B | |
| `VITE_REVERB_PORT` | `443` | `8080` | ✔ B | |
| `VITE_REVERB_SCHEME` | `https` | `http` | ✔ B | |
| `FILESYSTEM_DISK` | `s3` | `s3` | ✔ | |
| `MEDIA_DISK` | `s3` | `s3` | ✔ | medialibrary default disk |
| `MEDIA_QUEUE` | `default` | `default` | ✔ | conversions queue |
| `QUEUE_CONVERSIONS_BY_DEFAULT` | `true` | `true` | | |
| `IMAGE_DRIVER` | `gd` | `gd` | | |
| `AWS_ACCESS_KEY_ID` | R2 API token Access Key ID (§7.4) | `furny` | ✔ | shared by both disks |
| `AWS_SECRET_ACCESS_KEY` | R2 Secret Access Key | `furny-secret` | ✔ | |
| `AWS_DEFAULT_REGION` | `auto` | `us-east-1` | ✔ | |
| `AWS_BUCKET` | `furny-prod-private` | `furny-private` | ✔ | disk `s3` |
| `AWS_URL` | empty | empty | | private disk uses temporary URLs |
| `AWS_ENDPOINT` | `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` | `http://localhost:9000` | ✔ | must be the host browsers use (presigned URLs are host-bound) |
| `AWS_USE_PATH_STYLE_ENDPOINT` | `true` | `true` | ✔ | |
| `AWS_PUBLIC_BUCKET` | `furny-prod-public` | `furny-public` | ✔ | disk `s3-public` |
| `AWS_PUBLIC_URL` | `https://cdn.furny.example.com` | `http://localhost:9000/furny-public` | ✔ | |
| `MAIL_MAILER` | `postmark` | `smtp` | ✔ | `12 §8` |
| `POSTMARK_TOKEN` | Postmark Server API token | empty | ✔ | |
| `POSTMARK_MESSAGE_STREAM_ID` | `outbound` | — | ✔ | |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_SCHEME` | unused in prod | `127.0.0.1` / `1025` / `smtp` | | Mailpit locally; staging uses Mailpit (§6.4) |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | unused in prod | empty | | |
| `MAIL_FROM_ADDRESS` | `no-reply@furny.example.com` | `no-reply@furny.test` | ✔ | domain verified in Postmark |
| `MAIL_FROM_NAME` | same as `APP_NAME` | `Furny` | ✔ | |
| `LARAVEL_PDF_DRIVER` | `gotenberg` | `gotenberg` | ✔ | spatie/laravel-pdf |
| `GOTENBERG_URL` | `http://<furny-gotenberg UUID>:3000` | `http://127.0.0.1:3000` | ✔ | |
| `VISION_SERVICE_URL` | `http://<furny-vision UUID>:8000` | `http://127.0.0.1:8001` | ✔ | |
| `VISION_SERVICE_TOKEN` | `openssl rand -hex 32` (same value in `furny-vision`) | `local-vision-token` | ✔ | |
| `ENGINE_NODE_BINARY` | empty (set by `start.sh`) | `node` | | |
| `WHATSAPP_DRIVER` | `meta` | `meta` | | `12 §7` |
| `WHATSAPP_GRAPH_VERSION` | `v24.0` (newest supported in Meta's changelog on setup day) | same | | |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp Manager | empty | | |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta WABA ID | empty | | |
| `WHATSAPP_ACCESS_TOKEN` | Meta system-user permanent token | empty | | |
| `WHATSAPP_APP_SECRET` | Meta app secret | empty | | |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | `openssl rand -hex 24` | empty | | |
| `WHATSAPP_DEFAULT_LANGUAGE` | `en` | `en` | | |
| `WHATSAPP_TIMEOUT` | `10` | `10` | | |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio console (only if Twilio used) | empty | | |
| `TWILIO_FROM` / `TWILIO_SMS_SERVICE_SID` | Twilio number or Messaging Service SID | empty | | |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+<number>` (only `WHATSAPP_DRIVER=twilio`) | empty | | |
| `MSG91_AUTH_KEY` | MSG91 panel (if MSG91 used) | empty | | |
| `MSG91_SENDER_ID` | 6-char DLT header | empty | | |
| `MSG91_DLT_ENTITY_ID` | DLT PE ID | empty | | |
| `MSG91_BASE_URL` | `https://control.msg91.com` | same | | |
| `MSG91_WEBHOOK_TOKEN` | `openssl rand -hex 24` | empty | | |
| `VAPID_SUBJECT` | `mailto:<business email>` | `mailto:dev@furny.test` | ✔ | `12 §8.3` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `php artisan webpush:vapid --show` (§8 step 3) | generated | ✔ | public key reaches the browser as a page prop, not via Vite |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud console OAuth client | empty | | |
| `GOOGLE_REDIRECT_URI` | `https://furny.example.com/auth/google/callback` | `http://localhost:8000/auth/google/callback` | | must equal the callback route URL (`14`) |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile widget | `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` (Cloudflare test keys) | ✔ | site key reaches the browser as a page prop (`13`) |
| `SEED_OWNER_NAME` | owner's name | `Owner` | first deploy | delete after seeding |
| `SEED_OWNER_EMAIL` | owner's email | `owner@furny.test` | first deploy | delete after seeding |
| `SEED_OWNER_PASSWORD` | ≥ 16 random chars | `password` | first deploy | delete after seeding |
| `FEATURE_PAYMENTS` | `false` | `false` | ✔ | master §6.7 |
| `FEATURE_WHATSAPP` | `false` until configured | `false` | ✔ | |
| `FEATURE_SMS` | `false` until configured | `true` (log driver) | ✔ | |
| `FEATURE_WEB_PUSH` | `true` | `true` | ✔ | |
| `FEATURE_GOOGLE_LOGIN` | `false` until configured | `false` | ✔ | |
| `FEATURE_DXF_IMPORT` | `true` | `true` | ✔ | |
| `FEATURE_WALKTHROUGH_CAMERA` | `true` | `true` | ✔ | |
| `PULSE_ENABLED` | `true` | `true` | ✔ | dashboard `/pulse` |
| `PULSE_INGEST_DRIVER` | `storage` | `storage` | | no extra `pulse:work` daemon needed |
| `PULSE_DB_CONNECTION` | `pgsql` | `pgsql` | | |
| `PULSE_SERVER_NAME` | `production` | `local` | ✔ | container hostnames change per deploy |
| `PULSE_SLOW_QUERIES_THRESHOLD` | `500` | `500` | | ms |
| `PULSE_SLOW_REQUESTS_THRESHOLD` | `1500` | `1500` | | ms |
| `PULSE_SLOW_JOBS_THRESHOLD` | `60000` | `60000` | | ms (imports are legitimately slow) |
| `TELESCOPE_ENABLED` | `false` | `true` | ✔ | staging: `true` |
| `HEALTH_CHECK_TOKEN` | `openssl rand -hex 24` | `local` | ✔ | `/up/deep` |
| `SENTRY_LARAVEL_DSN` | Sentry project DSN (optional) | empty | | empty = disabled |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.05` | `0` | | |
| `SENTRY_SEND_DEFAULT_PII` | `false` | `false` | | |
| `VITE_SENTRY_DSN` | Sentry browser DSN (optional) | empty | B | |
| `VITE_SENTRY_ENVIRONMENT` | `production` | `local` | B | |
| `OBJECT_BACKUP_ENABLED` | `true` | `false` | ✔ | §12.3 |
| `OBJECT_BACKUP_SRC_PROVIDER` | `Cloudflare` | — | | `Minio` for MinIO |
| `OBJECT_BACKUP_B2_KEY_ID` / `OBJECT_BACKUP_B2_APP_KEY` | B2 application key (§7.4) | — | ✔ | |
| `OBJECT_BACKUP_B2_BUCKET` | `furny-object-backups` | — | ✔ | |
| `COMPOSER_NO_DEV` | `1` | — | ✔ B | staging `0` (Telescope) |
| `NIXPACKS_NODE_VERSION` | `22` | — | B | also in `nixpacks.toml` |

App timezone is hard-coded `UTC` in `config/app.php` (master §6.5); there is no `APP_TIMEZONE` variable.

### 6.2 `furny-vision`

Semantics of provider variables are owned by `18-ai-providers-and-quotas.md`; this table is the deployment contract.

| Variable | Production value | Local | Req | Notes |
|---|---|---|---|---|
| `VISION_SERVICE_TOKEN` | same as the app's | `local-vision-token` | ✔ | bearer token required on every endpoint except `/health` |
| `ANTHROPIC_API_KEY` | Anthropic console key | owner's or empty | | provider `anthropic` available when set |
| `OPENAI_API_KEY` | OpenAI key | empty | | provider `openai` available when set |
| `OPENAI_MODEL` | model id the owner chose (used when a request names none) | empty | | |
| `OPENAI_COMPAT_BASE_URL` | e.g. `http://<ollama UUID>:11434/v1` | empty | | provider `openai_compatible` available when set |
| `OPENAI_COMPAT_API_KEY` | `ollama` (Ollama ignores it) or the server's key | empty | | |
| `OPENAI_COMPAT_MODEL` | e.g. `qwen2.5vl:7b` | empty | | |
| `OPENAI_COMPAT_SUPPORTS_VISION` | `true` | `true` | | |
| `OPENAI_COMPAT_SUPPORTS_TOOLS` | `false` | `false` | | crop/zoom tool loop disabled when false |
| `OPENAI_COMPAT_SUPPORTS_JSON_SCHEMA` | `true` | `true` | | |
| `OPENAI_COMPAT_MAX_IMAGE_PX` | `1536` | `1536` | | longest image side sent |
| `LOG_LEVEL` | `INFO` | `DEBUG` | ✔ | |
| `MAX_CONCURRENT_JOBS` | `1` | `1` | ✔ | per uvicorn worker; 2 workers → 2 concurrent recognitions = Horizon `imports` workers |
| `REQUEST_TIMEOUT_SECONDS` | `600` | `600` | ✔ | must stay below the `imports` job timeout (660 s) |
| `SENTRY_DSN` | optional | empty | | |
| `OMP_NUM_THREADS` | `2` (in `vision/nixpacks.toml`) | — | | |

No S3 credentials: the vision service only uses presigned URLs supplied per request (`01 §9`).

### 6.3 Production bulk-paste block (Coolify → `furny-app` → Environment Variables → "Developer view")

Paste, replace every `<…>`, save. Then mark `VITE_*`, `COMPOSER_NO_DEV`, `NIXPACKS_NODE_VERSION` as build-time. Paste the same block into `furny-reverb` with `RUN_MIGRATIONS=false`.

```dotenv
APP_NAME=Furny
APP_ENV=production
APP_KEY=<base64:...>
APP_PREVIOUS_KEYS=
APP_DEBUG=false
APP_URL=https://furny.example.com
APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_IN
APP_MAINTENANCE_DRIVER=cache
APP_MAINTENANCE_STORE=redis
BCRYPT_ROUNDS=12
CONTAINER_ROLE=all
RUN_MIGRATIONS=true

LOG_CHANNEL=stack
LOG_STACK=stderr
LOG_LEVEL=info
LOG_DEPRECATIONS_CHANNEL=null

DB_CONNECTION=pgsql
DB_HOST=<furny-postgres-uuid>
DB_PORT=5432
DB_DATABASE=furny
DB_USERNAME=furny
DB_PASSWORD=<from furny-postgres>

REDIS_CLIENT=phpredis
REDIS_HOST=<furny-redis-uuid>
REDIS_PASSWORD=<from furny-redis>
REDIS_PORT=6379
REDIS_DB=0
REDIS_CACHE_DB=1
REDIS_PREFIX=furny_
CACHE_STORE=redis
CACHE_PREFIX=furny_cache_
QUEUE_CONNECTION=redis
SESSION_DRIVER=redis
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax
SESSION_COOKIE=furny_session
HORIZON_PREFIX=furny_horizon:
HORIZON_NOTIFY_EMAIL=<owner email>

BROADCAST_CONNECTION=reverb
REVERB_APP_ID=<openssl rand -hex 8>
REVERB_APP_KEY=<openssl rand -hex 16>
REVERB_APP_SECRET=<openssl rand -hex 32>
REVERB_HOST=ws.furny.example.com
REVERB_PORT=443
REVERB_SCHEME=https
REVERB_SERVER_HOST=0.0.0.0
REVERB_SERVER_PORT=8080
REVERB_SCALING_ENABLED=true
REVERB_SCALING_CHANNEL=furny_reverb
REVERB_ALLOWED_ORIGINS=furny.example.com
VITE_REVERB_APP_KEY=<same as REVERB_APP_KEY>
VITE_REVERB_HOST=ws.furny.example.com
VITE_REVERB_PORT=443
VITE_REVERB_SCHEME=https

FILESYSTEM_DISK=s3
MEDIA_DISK=s3
MEDIA_QUEUE=default
QUEUE_CONVERSIONS_BY_DEFAULT=true
IMAGE_DRIVER=gd
AWS_ACCESS_KEY_ID=<R2 access key id>
AWS_SECRET_ACCESS_KEY=<R2 secret>
AWS_DEFAULT_REGION=auto
AWS_BUCKET=furny-prod-private
AWS_URL=
AWS_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
AWS_USE_PATH_STYLE_ENDPOINT=true
AWS_PUBLIC_BUCKET=furny-prod-public
AWS_PUBLIC_URL=https://cdn.furny.example.com

MAIL_MAILER=postmark
POSTMARK_TOKEN=<postmark server token>
POSTMARK_MESSAGE_STREAM_ID=outbound
MAIL_FROM_ADDRESS=no-reply@furny.example.com
MAIL_FROM_NAME=Furny

LARAVEL_PDF_DRIVER=gotenberg
GOTENBERG_URL=http://<furny-gotenberg-uuid>:3000
VISION_SERVICE_URL=http://<furny-vision-uuid>:8000
VISION_SERVICE_TOKEN=<openssl rand -hex 32>

WHATSAPP_DRIVER=meta
WHATSAPP_GRAPH_VERSION=v24.0
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<openssl rand -hex 24>
WHATSAPP_DEFAULT_LANGUAGE=en
WHATSAPP_TIMEOUT=10
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
TWILIO_SMS_SERVICE_SID=
TWILIO_WHATSAPP_FROM=
MSG91_AUTH_KEY=
MSG91_SENDER_ID=
MSG91_DLT_ENTITY_ID=
MSG91_BASE_URL=https://control.msg91.com
MSG91_WEBHOOK_TOKEN=<openssl rand -hex 24>

VAPID_SUBJECT=mailto:<business email>
VAPID_PUBLIC_KEY=<webpush:vapid --show>
VAPID_PRIVATE_KEY=<webpush:vapid --show>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://furny.example.com/auth/google/callback
TURNSTILE_SITE_KEY=<turnstile site key>
TURNSTILE_SECRET_KEY=<turnstile secret>

SEED_OWNER_NAME=<owner name>
SEED_OWNER_EMAIL=<owner email>
SEED_OWNER_PASSWORD=<16+ random chars>

FEATURE_PAYMENTS=false
FEATURE_WHATSAPP=false
FEATURE_SMS=false
FEATURE_WEB_PUSH=true
FEATURE_GOOGLE_LOGIN=false
FEATURE_DXF_IMPORT=true
FEATURE_WALKTHROUGH_CAMERA=true

PULSE_ENABLED=true
PULSE_INGEST_DRIVER=storage
PULSE_DB_CONNECTION=pgsql
PULSE_SERVER_NAME=production
PULSE_SLOW_QUERIES_THRESHOLD=500
PULSE_SLOW_REQUESTS_THRESHOLD=1500
PULSE_SLOW_JOBS_THRESHOLD=60000
TELESCOPE_ENABLED=false
HEALTH_CHECK_TOKEN=<openssl rand -hex 24>

SENTRY_LARAVEL_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.05
SENTRY_SEND_DEFAULT_PII=false
VITE_SENTRY_DSN=
VITE_SENTRY_ENVIRONMENT=production

OBJECT_BACKUP_ENABLED=true
OBJECT_BACKUP_SRC_PROVIDER=Cloudflare
OBJECT_BACKUP_B2_KEY_ID=<b2 key id>
OBJECT_BACKUP_B2_APP_KEY=<b2 application key>
OBJECT_BACKUP_B2_BUCKET=furny-object-backups

COMPOSER_NO_DEV=1
NIXPACKS_NODE_VERSION=22
```

`furny-vision` block:

```dotenv
VISION_SERVICE_TOKEN=<same as app>
ANTHROPIC_API_KEY=<anthropic key>
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_COMPAT_BASE_URL=
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_MODEL=
OPENAI_COMPAT_SUPPORTS_VISION=true
OPENAI_COMPAT_SUPPORTS_TOOLS=false
OPENAI_COMPAT_SUPPORTS_JSON_SCHEMA=true
OPENAI_COMPAT_MAX_IMAGE_PX=1536
LOG_LEVEL=INFO
MAX_CONCURRENT_JOBS=1
REQUEST_TIMEOUT_SECONDS=600
SENTRY_DSN=
```

### 6.4 Staging differences (everything else as production, with staging hosts, buckets, keys)

| Variable | Staging value |
|---|---|
| `APP_ENV` | `staging` |
| `APP_URL` | `https://staging.furny.example.com` |
| `LOG_LEVEL` | `debug` |
| `REVERB_HOST` / `VITE_REVERB_HOST` | `ws-staging.furny.example.com` |
| `REVERB_ALLOWED_ORIGINS` | `staging.furny.example.com` |
| `AWS_BUCKET` / `AWS_PUBLIC_BUCKET` | `furny-staging-private` / `furny-staging-public` |
| `AWS_PUBLIC_URL` | `https://cdn-staging.furny.example.com` |
| `MAIL_MAILER` | `smtp` with `MAIL_HOST=<furny-mailpit SMTP host (service container name)>`, `MAIL_PORT=1025`, `MAIL_SCHEME=smtp` |
| `FEATURE_SMS` | `true` (settings `notifications.sms_driver = log`) |
| `TELESCOPE_ENABLED` | `true` |
| `COMPOSER_NO_DEV` | `0` |
| `PULSE_SERVER_NAME` | `staging` |
| `VITE_SENTRY_ENVIRONMENT` | `staging` |
| `OBJECT_BACKUP_ENABLED` | `false` |
| All secrets (`APP_KEY`, `REVERB_*`, tokens) | **different** from production |
| Vision `ANTHROPIC_API_KEY` | separate Anthropic workspace key with a low spend limit |

### 6.5 Secret storage and rotation

- Every generated secret is stored in the owner's password manager entry "Furny production" / "Furny staging" **before** pasting into Coolify. Losing `APP_KEY` makes encrypted columns, Fortify 2FA secrets and signed URLs unrecoverable.
- Rotation: `APP_KEY` → move old key to `APP_PREVIOUS_KEYS`, set new key, redeploy app + reverb. `VISION_SERVICE_TOKEN` → set on vision first (accepting old and new is not supported, so do it inside a maintenance window of < 2 min), then app. `REVERB_APP_*` → both resources, redeploy app (rebuilds `VITE_REVERB_APP_KEY`). Provider keys → replace and redeploy the affected resource.

---

## 7. Server & Coolify setup (step by step)

### 7.1 Provision servers

1. Create the **production** VPS: 4 vCPU / 8 GB / ≥ 80 GB SSD, Ubuntu 24.04 LTS, public IPv4. Default choice: Hetzner Cloud, Singapore location, shared AMD plan (e.g. CPX32 class) — nearest low-cost region to India (≈ 60–80 ms). If Indian data residency becomes a requirement, use an India-region provider with the same size; nothing else in this file changes. Enable the provider's **automatic server backups** (whole-disk images, extra layer for rebuilding Coolify).
2. Create the **staging** VPS: 2 vCPU / 4 GB / 40 GB, Ubuntu 24.04 (any cheap region, e.g. Hetzner Germany CX23 class).
3. Provider firewall (not `ufw`: Docker bypasses it), production: inbound TCP 22 (from the owner's IPs if static, else anywhere with key-only SSH), 80, 443. Staging: 22 from the production server's IP and the owner's IPs, 80, 443.
4. On both servers as root:

   ```bash
   apt-get update && apt-get -y upgrade && apt-get -y install unattended-upgrades
   dpkg-reconfigure -f noninteractive unattended-upgrades
   fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   printf 'vm.swappiness=10\nvm.overcommit_memory=1\n' > /etc/sysctl.d/99-furny.conf && sysctl --system
   sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
   systemctl restart ssh
   ```

### 7.2 Install Coolify (production server only)

1. `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`
2. Open `http://<server-ip>:8000`, create the admin account (owner's email, strong password, then enable 2FA in Profile).
3. Settings → Configuration: **Instance's Domain** `https://coolify.furny.example.com` (after the DNS record in §7.3 exists); **Instance Timezone** `UTC`. Save, then close port 8000 in the provider firewall (the dashboard is now served through Traefik).
4. Verify Docker log rotation: `cat /etc/docker/daemon.json` must contain `"log-driver": "json-file"` and `"log-opts": {"max-size": "20m", "max-file": "5"}`; add/adjust and `systemctl restart docker` if not (Coolify containers restart automatically).
5. Servers → `localhost` → Settings: Docker cleanup threshold **80 %**, cleanup frequency daily; enable **Sentinel/Metrics** (CPU/memory graphs).
6. Servers → + Add → the staging server (IP, port 22, user root, private key generated by Coolify — add its public key to the staging server's `/root/.ssh/authorized_keys`) → Validate & install Docker.

### 7.3 DNS & TLS

Domain zone on Cloudflare (free). Records (all **DNS only / grey cloud** except where stated):

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `furny.example.com` | production IPv4 | DNS only |
| A | `ws.furny.example.com` | production IPv4 | DNS only |
| A | `coolify.furny.example.com` | production IPv4 | DNS only |
| A | `staging.furny.example.com` | staging IPv4 | DNS only |
| A | `ws-staging.furny.example.com` | staging IPv4 | DNS only |
| A | `mail-staging.furny.example.com` | staging IPv4 | DNS only |
| CNAME | `cdn.furny.example.com` | created by R2 "Connect domain" (§7.4) | proxied (required by R2) |
| CNAME | `cdn-staging.furny.example.com` | created by R2 | proxied |
| TXT | `<selector>._domainkey` | DKIM value from Postmark → Sender signatures/Domains | DNS only |
| CNAME | `pm-bounces` | `pm.mtasv.net` (Postmark custom Return-Path) | DNS only |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<owner email>` → change to `p=quarantine` after 30 clean days | — |

No AAAA records (avoids IPv6 paths that are not tested). TLS: Coolify's Traefik requests Let's Encrypt certificates automatically for every `https://` domain set on a resource; certificates renew automatically. If a certificate is not issued within 5 minutes of the first deploy, check that the A record resolves to the server (`dig +short furny.example.com`) and that port 80 is open.

### 7.4 Object storage and backup buckets

**Cloudflare R2 (primary):**

1. R2 → Create bucket `furny-prod-private` (location hint: Asia-Pacific), `furny-prod-public`, `furny-staging-private`, `furny-staging-public`.
2. `furny-prod-public` → Settings → Custom Domains → Connect `cdn.furny.example.com`. Keep the `r2.dev` public URL **disabled**. Same for staging with `cdn-staging.furny.example.com`.
3. Each bucket → Settings → CORS policy (production shown; staging uses `https://staging.furny.example.com`):

   ```json
   [
     {
       "AllowedOrigins": ["https://furny.example.com"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   (PUT is needed for presigned browser uploads to the private bucket; GET/HEAD for textures loaded into WebGL from the public bucket.)
4. Each bucket → Settings → Object lifecycle rules: "Abort incomplete multipart uploads after 1 day". No expiry rules on data.
5. R2 → Manage API tokens → Create **two** tokens with "Object Read & Write", one scoped to the two prod buckets, one to the two staging buckets. Copy Access Key ID / Secret into `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; note the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.

**Backblaze B2 (backups):**

1. Create bucket `furny-db-backups` (private) → Lifecycle Settings → custom rule: prefix empty, "days from hiding to deleting" **1** (Coolify's own retention deletes old dumps; hidden versions disappear a day later).
2. Create bucket `furny-object-backups` (private) → Lifecycle: prefix empty, "days from hiding to deleting" **30** (overwritten/deleted objects recoverable for 30 days).
3. App Keys → create `coolify-db-backups` (read/write, bucket `furny-db-backups`) and `rclone-object-backups` (read/write, bucket `furny-object-backups`). Note the S3 endpoint of the bucket region (`https://s3.<region>.backblazeb2.com`).

**MinIO alternative (air-gapped installs only):** Coolify → + New → Service → MinIO; domains `https://s3.<domain>` (API) and `https://minio.<domain>` (console); env `MINIO_API_CORS_ALLOW_ORIGIN=https://furny.example.com`; create buckets in the console, run `mc anonymous set download <alias>/furny-prod-public` and `mc version enable <alias>/furny-prod-private`; set `AWS_ENDPOINT=https://s3.<domain>`, `AWS_PUBLIC_URL=https://s3.<domain>/furny-prod-public`, `OBJECT_BACKUP_SRC_PROVIDER=Minio`.

### 7.5 Coolify global settings

1. **Sources** → + Add → GitHub App → name `furny-github` → register on the owner's GitHub account/org → install on the Furny repository only.
2. **S3 Storages** → + Add → name `b2-db-backups`, endpoint `https://s3.<region>.backblazeb2.com`, bucket `furny-db-backups`, region `<region>`, key/secret = `coolify-db-backups` key → Validate.
3. **Notifications** → Email (SMTP via Postmark: host `smtp.postmarkapp.com`, port 587, username = password = Postmark server token, from `coolify@furny.example.com`) → recipient owner. Enable: deployment success **and** failure, backup success and failure, scheduled task failure, container status changes, server disk usage, server unreachable.
4. **Settings → Backup** (Coolify's own database): enable, daily, S3 storage `b2-db-backups`, retention 14.
5. **Settings → Advanced**: enable **API access**. **Keys & Tokens → API tokens** → create `github-actions` with permission `deploy` (read + deploy). Store in GitHub (§10.4).

### 7.6 Project and environments

Projects → + Add → `Furny`. Inside it, environment `production` exists; + Add environment `staging`. Every production resource below is created in `Furny / production` on server `localhost`; staging repeats §7.7–§7.12 in `Furny / staging` on the staging server with staging values (§6.4).

### 7.7 `furny-postgres`

1. + New → Databases → **PostgreSQL** → image `postgres:18-alpine`.
2. Name `furny-postgres`; Username `furny`; Password: keep generated; Initial Database `furny`; **Make it publicly available: OFF**.
3. Custom PostgreSQL Configuration:

   ```ini
   listen_addresses = '*'
   max_connections = 100
   shared_buffers = 512MB
   effective_cache_size = 2GB
   work_mem = 16MB
   maintenance_work_mem = 256MB
   random_page_cost = 1.1
   effective_io_concurrency = 200
   wal_compression = on
   checkpoint_completion_target = 0.9
   log_min_duration_statement = 1000
   idle_in_transaction_session_timeout = 60000
   timezone = 'UTC'
   ```

4. Resource Limits: memory 2048m.
5. Persistent Storage: PostgreSQL 18 images store data in `/var/lib/postgresql/18/docker`. The volume destination must be `/var/lib/postgresql`. If Coolify shows `/var/lib/postgresql/data`, change it to `/var/lib/postgresql` **before the first start**.
6. Start. In the resource's Terminal: `psql -U furny -d furny -c 'select version();'` must print 18.x. Copy the hostname from "Postgres URL (internal)" (the resource UUID) into `DB_HOST`.
7. **Backups** tab → + Add scheduled backup:
   - Schedule A "daily": frequency `30 20 * * *` (02:00 IST), Databases `furny`, Save to S3 ON → `b2-db-backups`, retention: keep **14** backups locally and **14** days in S3.
   - Schedule B "monthly": frequency `0 21 1 * *`, Databases `furny`, Save to S3 ON → `b2-db-backups`, retention: keep **2** locally, **12** backups / 400 days in S3.
   - Click "Backup now" once and confirm a `.dmp` (pg_dump custom format) object appears in B2.

### 7.8 `furny-redis`

1. + New → Databases → **Redis** → image `redis:7.4-alpine`, name `furny-redis`, publicly available OFF.
2. Custom Redis Configuration:

   ```
   appendonly yes
   appendfsync everysec
   maxmemory 768mb
   maxmemory-policy noeviction
   ```

   `noeviction` is mandatory: evicting a queue key loses jobs. Cache keys carry TTLs; memory is monitored (§13).
3. Resource Limits: memory 1024m. Start. Copy hostname (UUID) and password into `REDIS_HOST` / `REDIS_PASSWORD`.

### 7.9 `furny-gotenberg`

1. + New → Docker Image → `gotenberg/gotenberg:8` → name `furny-gotenberg`.
2. Ports Exposes `3000`. **Domains: clear the field** (Coolify may pre-fill an sslip.io URL). Ports Mappings: empty.
3. Advanced → **Consistent Container Names: ON**.
4. Health Check: enabled, GET, scheme http, host `localhost`, port `3000`, path `/health`, return code 200, interval 30, timeout 5, retries 3, start period 20.
5. Resource Limits: memory 1024m. Deploy. Hostname for `GOTENBERG_URL` = this resource's UUID.

### 7.10 `furny-vision`

1. + New → Private Repository (with GitHub App) → `furny-github` → repository → branch `main` → Build Pack **Nixpacks** → **Base Directory `/vision`** → Port `8000`.
2. General: name `furny-vision`; **Domains: empty**; Start/Install/Build commands empty (`vision/nixpacks.toml` governs).
3. Advanced: **Auto Deploy: OFF**; **Consistent Container Names: ON**; Include Source Commit in Build: ON.
4. Health Check: GET http `localhost` port `8000` path `/health`, 200, interval 15, timeout 5, retries 5, start period 60.
5. Resource Limits: memory 3584m.
6. Environment Variables: paste the vision block (§6.3). Deploy. Verify from `furny-app`'s terminal later: `curl -fsS http://<vision-uuid>:8000/health`.

### 7.11 `furny-app`

1. + New → Private Repository (with GitHub App) → `furny-github` → repository → branch `main` → Build Pack **Nixpacks** → Base Directory `/` → Port `80`.
2. General: name `furny-app`; Domains `https://furny.example.com`; install/build/start commands **empty**; Ports Exposes `80`; Ports Mappings **empty**.
3. Advanced: **Auto Deploy: OFF** (CI deploys, §10); **Force HTTPS: ON**; **Enable Gzip Compression: OFF** (nginx compresses); **Include Source Commit in Build: ON**; **Consistent Container Names: OFF** (rolling updates).
4. **Pre-deployment command: empty. Post-deployment command: empty.** (Migrations run in `start.sh`, O5.)
5. Health Check: GET http `localhost` port `80` path `/up`, return code 200, interval 10, timeout 5, retries 6, **start period 90** (covers dependency wait + `optimize` + migrations).
6. Resource Limits: memory 2560m.
7. Environment Variables: Developer view → paste §6.3 → Save → mark build-time variables.
8. Scheduled Tasks → + Add: name `object-backup`, command `bash /app/docker/backup-objects.sh`, frequency `15 21 * * *`.
9. Do **not** deploy yet; follow §8.

### 7.12 `furny-reverb`

1. + New → Private Repository → same repository, branch `main`, Nixpacks, base `/`, Port `8080`.
2. General: name `furny-reverb`; Domains `https://ws.furny.example.com`; Ports Exposes `8080`; **Start Command** `php artisan reverb:start --host=0.0.0.0 --port=8080`.
3. Advanced: Auto Deploy OFF; Force HTTPS ON; Gzip OFF; Include Source Commit ON; Consistent Container Names OFF.
4. Health Check: type **CMD**, command `php -r 'exit(@fsockopen("127.0.0.1", 8080) ? 0 : 1);'`, interval 10, timeout 5, retries 6, start period 30.
5. Resource Limits: memory 384m.
6. Environment Variables: the same block as `furny-app` with `RUN_MIGRATIONS=false`.

### 7.13 Optional resources

- **Ollama (local LLM, `openai_compatible` provider)**: CPU inference of a 7B vision model on the 4 vCPU server takes minutes per image and competes with everything else — run it only on a separate GPU server. On that server: + New → Docker Image `ollama/ollama:latest`, Consistent Container Names ON, persistent storage `/root/.ollama`, Custom Docker Options `--gpus all`, Ports Exposes 11434, no domain; terminal `ollama pull qwen2.5vl:7b`. Because Coolify networks do not span servers, connect the two servers with a private network (provider private network or Tailscale), add a port mapping bound to the private IP only (`<private-ip>:11434:11434`), and set `OPENAI_COMPAT_BASE_URL=http://<private-ip>:11434/v1` on `furny-vision`.
- **Mailpit (staging only)**: + New → Service → Mailpit → domain `https://mail-staging.furny.example.com`, enable HTTP Basic Auth on the service (username `furny`, generated password); enable **"Connect To Predefined Network"** on the service (one-click services otherwise live on their own Docker network and the app cannot reach them); use the Mailpit container name shown on the service page (`mailpit-<uuid>`) as `MAIL_HOST` in staging and verify from the staging `furny-app` terminal with `php -r 'var_dump((bool) fsockopen(getenv("MAIL_HOST"), 1025));'`.

### 7.14 Staging specifics

Same steps on the staging server and `Furny / staging` environment, branch **`develop`**, staging domains, buckets and secrets. Additionally: `furny-app` (staging) → General → **HTTP Basic Authentication ON** (user `furny`, generated password) so search engines and strangers never reach staging; the app also sends `X-Robots-Tag: noindex` on non-production environments. Staging Postgres has one backup schedule (daily, keep 3) used for restore drills of staging itself.

---

## 8. First deploy runbook (production)

Prerequisites: §7.1–§7.12 done, DNS resolving, all `<…>` values filled except `VAPID_*`.

1. **Generate secrets locally** (developer machine with the repo):

   ```bash
   php artisan key:generate --show                     # APP_KEY
   openssl rand -hex 8; openssl rand -hex 16; openssl rand -hex 32   # REVERB_APP_ID / KEY / SECRET
   openssl rand -hex 32                                # VISION_SERVICE_TOKEN
   openssl rand -hex 24                                # HEALTH_CHECK_TOKEN, WHATSAPP_WEBHOOK_VERIFY_TOKEN, MSG91_WEBHOOK_TOKEN
   php artisan webpush:vapid --show                    # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
   ```

   Save all in the password manager, paste into Coolify (`furny-app`, `furny-reverb`, `furny-vision`).
2. Deploy order: `furny-postgres` and `furny-redis` running → deploy `furny-gotenberg` → deploy `furny-vision` (watch build log for the import check) → deploy **`furny-app`** → deploy `furny-reverb`.
3. `furny-app` first boot runs all migrations (watch Logs: `[start.sh] Running migrations`). Wait for the deployment to show **Finished** and the container healthy.
4. Coolify → `furny-app` → Terminal:

   ```bash
   php artisan db:seed --force                         # roles, settings, tax rates, catalog, owner (02 §14); idempotent
   php artisan horizon:status                          # "Horizon is running."
   supervisorctl -c /app/docker/supervisor/supervisord.conf status   # 5 programs RUNNING
   php -r 'echo file_get_contents(getenv("VISION_SERVICE_URL")."/health"), PHP_EOL;'
   curl -fsS "$GOTENBERG_URL/health"
   php artisan tinker --execute="Storage::disk('s3')->put('health/probe.txt', 'ok'); echo Storage::disk('s3')->get('health/probe.txt');"
   php artisan tinker --execute="Storage::disk('s3-public')->put('health/probe.txt', 'ok');"
   curl -fsS https://cdn.furny.example.com/health/probe.txt     # prints ok
   curl -fsS -H "X-Health-Token: $HEALTH_CHECK_TOKEN" http://localhost/up/deep
   ```

   Every check in `/up/deep` must be `ok: true`.
5. **Remove** `SEED_OWNER_PASSWORD` (and `SEED_OWNER_EMAIL`, `SEED_OWNER_NAME`) from `furny-app` and `furny-reverb` env; restart both (Coolify "Restart" — no rebuild needed).
6. Browser checks: log in at `https://furny.example.com` as the owner → set up 2FA (required for owner, `13`) → Admin → Settings: business profile, currency, tax, units, AI provider (Anthropic key present ⇒ `anthropic`), notifications → open `/horizon`, `/pulse` (both load for owner).
7. Functional smoke test (as a test customer account created via registration): create project → draw a wall → 3D view → upload `vision/tests/fixtures/reference/brochure-2bhk.png` → import reaches `ready_for_review` → accept → create a wardrobe → submit order → as owner build and send a quote → PDF downloads → customer sees the quote in real time (Reverb) and receives the email. Then delete the test customer (anonymisation flow, `13`).
8. Backups: trigger "Backup now" on `furny-postgres` (B2 object appears); run the `object-backup` scheduled task once manually ("Execute now"); check B2 bucket contents.
9. Monitoring: create the Better Stack monitors (§13.3); confirm Coolify notification email arrives by redeploying `furny-gotenberg`.
10. Record the deploy (date, commit, operator) in the ops log (`docs/ops-log.md` in the repository, one line per production change).

---

## 9. Deploying changes: zero-downtime rules

How a `furny-app` deploy proceeds (rolling update): Coolify builds the new image → starts the new container next to the old one → `start.sh` waits for DB/Redis, caches config, **migrates** → supervisord starts nginx/php-fpm/Horizon/scheduler → health check passes → Traefik routes to both briefly → Coolify stops the old container (supervisord → SIGTERM → Horizon finishes current jobs within the stop grace; jobs killed mid-run are released after `retry_after` and retried — every job is idempotent, master §6.8).

Rules every change must follow:

1. **Expand/contract migrations.** Release N may only add (tables, nullable columns or columns with defaults, indexes). Code that stops using a column ships in N; the column is dropped in N+1. Never rename a column or change its type in one release. The old container keeps serving during and after migration.
2. **Large indexes** use `CREATE INDEX CONCURRENTLY` in a migration with `public $withinTransaction = false;`.
3. **Migration time budget**: the health window is start period 90 s + 6 × 10 s. A migration expected to run longer than 60 s ships **alone** in its own release (no code depending on it), with the `furny-app` health-check start period raised to cover it for that one deploy (reset afterwards); the dependent code follows in the next release.
4. **Jobs across versions.** During the overlap an old worker may pick a job dispatched by new code. Job classes and payload shapes are therefore additive: add a new job class one release before dispatching it, or rely on `tries ≥ 2` with backoff ≥ 30 s (old container is gone by the retry). Never change a queued job's constructor signature incompatibly; create `FooV2` instead.
5. **Vision API compatibility.** `furny-vision` deploys first (§10.2) and must accept requests from the previous app release.
6. **Assets.** HTML from the new container may reference chunks the old container lacks for a few seconds; Inertia's asset-version check forces a full reload and `vite:preloadError` reloads lazy chunks (§5.11 item 11).
7. **Reverb** is redeployed only when `composer.lock`, `config/reverb.php`, `config/broadcasting.php`, `nixpacks.toml` or `docker/php.ini` change (each Reverb deploy drops every WebSocket; clients reconnect automatically and pages fall back to 30 s polling meanwhile, `01 §8`). `php artisan reverb:restart` is never needed: a deploy replaces the container.
8. **Horizon** needs no `horizon:terminate` in a deploy: the old container (and its Horizon) is stopped; the new one starts fresh with the new code. `horizon:terminate` is only used when restarting workers *inside* a running container (e.g. after editing env + "Restart").
9. **Rollback**: Coolify → resource → Rollback → pick the previous image. Allowed because of rule 1 (old code runs on the expanded schema); its `start.sh` migration step is a no-op. Never run `migrate:rollback` in production.

---

## 10. CI/CD

### 10.1 Branch strategy

- `develop`: integration branch → auto-deploys to **staging** after CI.
- `main`: production → auto-deploys to **production** after CI.
- Feature work: `feat/<short-name>` / `fix/<short-name>` branched from `develop`, PR into `develop` (squash merge).
- Release: PR `develop` → `main` titled `Release YYYY-MM-DD` (merge commit), after the release checklist (§11).
- Hotfix: `hotfix/<name>` from `main`, PR into `main`; then PR `main` → `develop`.
- GitHub branch protection on `main` and `develop`: require PR, require status checks `php`, `frontend`, `vision`, `browser` to pass, require branch up to date, no force pushes. `main` additionally requires 1 approval when a second person exists (owner may self-merge until then).

### 10.2 `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main, develop]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

env:
  PHP_EXTENSIONS: pdo_pgsql, redis, gd, exif, intl, bcmath, pcntl, posix, zip, fileinfo, sodium

jobs:
  php:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:18-alpine
        env: { POSTGRES_DB: furny_test, POSTGRES_USER: furny, POSTGRES_PASSWORD: secret }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U furny -d furny_test" --health-interval 5s --health-timeout 5s --health-retries 20
      redis:
        image: redis:7.4-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      APP_ENV: testing
      DB_CONNECTION: pgsql
      DB_HOST: 127.0.0.1
      DB_PORT: 5432
      DB_DATABASE: furny_test
      DB_USERNAME: furny
      DB_PASSWORD: secret
      REDIS_HOST: 127.0.0.1
    steps:
      - uses: actions/checkout@v5
      - uses: shivammathur/setup-php@v2
        with: { php-version: "8.4", extensions: "${{ env.PHP_EXTENSIONS }}", coverage: none, tools: "composer:v2" }
      - uses: actions/setup-node@v5
        with: { node-version: "22", cache: npm }
      - name: Composer cache
        uses: actions/cache@v4
        with:
          path: ~/.composer/cache/files
          key: composer-${{ hashFiles('composer.lock') }}
      - run: composer install --no-interaction --prefer-dist --no-progress
      - run: npm ci --no-audit --no-fund
      - run: npm run build:engine-cli
      - run: cp .env.example .env && php artisan key:generate
      - name: Pint
        run: vendor/bin/pint --test
      - name: Larastan
        run: vendor/bin/phpstan analyse --no-progress --memory-limit=1G
      - name: Generated TS types are current
        run: php artisan typescript:transform && git diff --exit-code -- resources/js/types/generated.d.ts
      - name: Pest (unit + feature)
        run: vendor/bin/pest tests/Unit tests/Feature --parallel --ci

  frontend:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: shivammathur/setup-php@v2          # Wayfinder's Vite plugin runs artisan during the build
        with: { php-version: "8.4", extensions: "${{ env.PHP_EXTENSIONS }}", coverage: none, tools: "composer:v2" }
      - uses: actions/setup-node@v5
        with: { node-version: "22", cache: npm }
      - run: composer install --no-interaction --prefer-dist --no-progress
      - run: npm ci --no-audit --no-fund
      - run: cp .env.example .env && php artisan key:generate
      - name: ESLint
        run: npx eslint . --max-warnings=0
      - name: Prettier
        run: npx prettier --check resources/ engine-cli/
      - name: vue-tsc
        run: npx vue-tsc --noEmit
      - name: Vitest
        run: npx vitest run
      - name: Build (app + engine CLI)
        run: npm run build
      - name: Engine CLI smoke test
        run: echo '{}' | node engine-cli/dist/cli.mjs version | grep -q '"ok":true'

  vision:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: vision
    steps:
      - uses: actions/checkout@v5
      - run: sudo apt-get update && sudo apt-get install -y libgl1 libglib2.0-0
        working-directory: .
      - uses: astral-sh/setup-uv@v6
        with: { enable-cache: true }
      - uses: actions/setup-node@v5                # contract tests validate output with the engine CLI (03)
        with: { node-version: "22", cache: npm }
      - run: npm ci --no-audit --no-fund && npm run build:engine-cli
        working-directory: .
      - run: uv python install 3.12
      - run: uv sync --frozen
      - name: requirements.txt is current
        run: uv export --frozen --no-dev --no-hashes --no-emit-project -o /tmp/requirements.txt && diff -u requirements.txt /tmp/requirements.txt
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run mypy app
      - run: uv run pytest -q
        env:
          ENGINE_CLI: ${{ github.workspace }}/engine-cli/dist/cli.mjs

  browser:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:18-alpine
        env: { POSTGRES_DB: furny_test, POSTGRES_USER: furny, POSTGRES_PASSWORD: secret }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U furny -d furny_test" --health-interval 5s --health-timeout 5s --health-retries 20
      redis:
        image: redis:7.4-alpine
        ports: ["6379:6379"]
    env:
      APP_ENV: testing
      DB_CONNECTION: pgsql
      DB_HOST: 127.0.0.1
      DB_DATABASE: furny_test
      DB_USERNAME: furny
      DB_PASSWORD: secret
      REDIS_HOST: 127.0.0.1
    steps:
      - uses: actions/checkout@v5
      - uses: shivammathur/setup-php@v2
        with: { php-version: "8.4", extensions: "${{ env.PHP_EXTENSIONS }}", coverage: none, tools: "composer:v2" }
      - uses: actions/setup-node@v5
        with: { node-version: "22", cache: npm }
      - run: composer install --no-interaction --prefer-dist --no-progress
      - run: npm ci --no-audit --no-fund
      - run: cp .env.example .env && php artisan key:generate
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - name: Pest browser tests (suite contents per 16)
        run: vendor/bin/pest tests/Browser --ci
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: browser-screenshots, path: tests/Browser/screenshots, if-no-files-found: ignore }

  deploy:
    needs: [php, frontend, vision, browser]
    if: github.event_name == 'push' && (github.ref_name == 'main' || github.ref_name == 'develop')
    runs-on: ubuntu-24.04
    environment: ${{ github.ref_name == 'main' && 'production' || 'staging' }}
    concurrency:
      group: deploy-${{ github.ref_name }}
      cancel-in-progress: false
    permissions:
      contents: read
      deployments: read
    env:
      GH_TOKEN: ${{ github.token }}
      COOLIFY_URL: ${{ secrets.COOLIFY_URL }}
      COOLIFY_TOKEN: ${{ secrets.COOLIFY_TOKEN }}
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - name: Which resources changed since the last successful deploy?
        id: changes
        run: bash .github/scripts/changed-since-last-deploy.sh "${{ github.ref_name == 'main' && 'production' || 'staging' }}"
      - name: Deploy furny-vision
        if: steps.changes.outputs.vision == 'true'
        run: bash .github/scripts/coolify-deploy.sh "${{ secrets.COOLIFY_VISION_UUID }}"
      - name: Deploy furny-app
        if: steps.changes.outputs.app == 'true'
        run: bash .github/scripts/coolify-deploy.sh "${{ secrets.COOLIFY_APP_UUID }}"
      - name: Deploy furny-reverb
        if: steps.changes.outputs.reverb == 'true'
        run: bash .github/scripts/coolify-deploy.sh "${{ secrets.COOLIFY_REVERB_UUID }}"
```

Coolify always deploys the **head** of the tracked branch. That is safe because branch protection only lets CI-tested PR merges onto `main`/`develop`; if two merges land close together, the first run may already deploy the second commit, and the second run redeploys idempotently.

### 10.3 Deploy helper scripts

`.github/scripts/changed-since-last-deploy.sh`:

```bash
#!/usr/bin/env bash
# Outputs app/reverb/vision=true|false by diffing GITHUB_SHA against the last commit
# successfully deployed to the given GitHub environment (GitHub records a deployment per deploy job).
set -euo pipefail
env_name="$1"
out="${GITHUB_OUTPUT:-/dev/stdout}"
last=""
while read -r id sha; do
  [ -z "${id:-}" ] && continue
  [ "$sha" = "$GITHUB_SHA" ] && continue
  state="$(gh api "repos/$GITHUB_REPOSITORY/deployments/$id/statuses?per_page=1" --jq '.[0].state // ""')"
  if [ "$state" = "success" ]; then last="$sha"; break; fi
done < <(gh api "repos/$GITHUB_REPOSITORY/deployments?environment=$env_name&per_page=50" --jq '.[] | "\(.id) \(.sha)"')

if [ -z "$last" ] || ! git cat-file -e "${last}^{commit}" 2>/dev/null; then
  echo "No previous successful deployment found: deploying everything."
  printf 'app=true\nreverb=true\nvision=true\n' >> "$out"
  exit 0
fi

files="$(git diff --name-only "$last" "$GITHUB_SHA")"
echo "Changed since $last:"; echo "$files"
app=false; reverb=false; vision=false
if grep -Evq '^(vision/|docs/|\.github/)' <<<"$files"; then app=true; fi
if grep -Eq '^(composer\.lock|config/(reverb|broadcasting)\.php|nixpacks\.toml|docker/php\.ini)$' <<<"$files"; then reverb=true; fi
if grep -Eq '^vision/' <<<"$files"; then vision=true; fi
printf 'app=%s\nreverb=%s\nvision=%s\n' "$app" "$reverb" "$vision" >> "$out"
```

`.github/scripts/coolify-deploy.sh`:

```bash
#!/usr/bin/env bash
# Triggers a Coolify deployment and waits for its result.
# Usage: coolify-deploy.sh <resource-uuid> [timeout-seconds]
set -euo pipefail
uuid="$1"; timeout="${2:-1800}"
: "${COOLIFY_URL:?}" "${COOLIFY_TOKEN:?}"
auth=(-H "Authorization: Bearer $COOLIFY_TOKEN" -H "Accept: application/json")

resp="$(curl -fsS --retry 3 "${auth[@]}" "$COOLIFY_URL/api/v1/deploy?uuid=$uuid&force=false")"
echo "$resp"
dep="$(jq -r '.deployments[0].deployment_uuid // empty' <<<"$resp")"
[ -n "$dep" ] || { echo "No deployment_uuid in Coolify response"; exit 1; }

deadline=$(( $(date +%s) + timeout ))
while :; do
  status="$(curl -fsS "${auth[@]}" "$COOLIFY_URL/api/v1/deployments/$dep" | jq -r '.status')"
  echo "$(date -u +%T) $uuid deployment $dep: $status"
  case "$status" in
    finished) exit 0 ;;
    failed|cancelled|cancelled-by-user) echo "::error::Coolify deployment $dep $status"; exit 1 ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] || { echo "::error::Timed out waiting for $dep"; exit 1; }
  sleep 15
done
```

### 10.4 GitHub settings

Settings → Environments: `production` (deployment branches: `main` only) and `staging` (`develop` only). Environment secrets for each: `COOLIFY_URL` (`https://coolify.furny.example.com`), `COOLIFY_TOKEN` (API token from §7.5), `COOLIFY_APP_UUID`, `COOLIFY_REVERB_UUID`, `COOLIFY_VISION_UUID` (from each resource's URL/General page in the matching Coolify environment). Dependabot: weekly for `composer`, `npm`, `pip` (`/vision`), `github-actions`; grouped minor/patch updates.

---

## 11. Release checklist (develop → main)

- [ ] Staging is on the release commit; CI green on `develop`.
- [ ] Staging smoke test passed: login (password + OTP log + Google if enabled), plan editor 2D/3D, blueprint import of both reference fixtures, furniture builder, order submit → proposal → quote PDF → accept → confirm → production update with photo → completion → delivery; real-time updates visible; email visible in staging Mailpit.
- [ ] Migrations reviewed against §9 rules 1–3; destructive steps deferred to a later release.
- [ ] New/changed env variables added to **production** `furny-app` **and** `furny-reverb` (build-time flag for `VITE_*`) and to `.env.example` and §6 of this file.
- [ ] `ENGINE_VERSION` bumped if engine output changed (`01 §5.2`); vision API backward compatible (§9 rule 5).
- [ ] Coolify `furny-postgres` → "Backup now" succeeded within the last hour.
- [ ] Merge the release PR; watch the GitHub `deploy` job and Coolify deployment logs to **Finished**.
- [ ] Post-deploy: `/up/deep` all ok; Horizon running, no new failed jobs; Pulse shows no exception spike; open one order page and one editor; Sentry (if enabled) shows no new issue within 30 minutes.
- [ ] Ops log line added (`docs/ops-log.md`).
- [ ] If anything is wrong: Coolify Rollback to the previous image (§9 rule 9), then investigate.

---

## 12. Backups & restore

### 12.1 What is backed up

| Data | Mechanism | Frequency | Retention | Location | RPO |
|---|---|---|---|---|---|
| PostgreSQL `furny` | Coolify scheduled backup (`pg_dump` custom format) | daily 20:30 UTC | 14 days | B2 `furny-db-backups` (+ local copies) | 24 h |
| PostgreSQL `furny` | Coolify scheduled backup | monthly, 1st 21:00 UTC | 12 months | B2 `furny-db-backups` | — |
| Object storage (both buckets) | `docker/backup-objects.sh` (rclone sync) via Coolify Scheduled Task | daily 21:15 UTC | current + 30 days of overwritten/deleted versions | B2 `furny-object-backups` | 24 h |
| Coolify instance (resources, env vars, settings) | Coolify Settings → Backup | daily | 14 | B2 `furny-db-backups` | 24 h |
| Whole server disk | provider automatic backups | daily | 7 | provider | 24 h |
| Secrets | owner's password manager | on change | — | — | — |
| Redis | not backed up (cache, sessions, queues; AOF survives restarts) | — | — | — | jobs in flight may need re-dispatch |

Persistent Docker volumes are **not** backups (same disk as the data). RPO 24 h is accepted for v1 (order volume is low and every customer-visible event is also emailed); RTO target 1 hour.

### 12.2 Postgres backup verification

Coolify notifies on backup failure (§7.5). Weekly (Monday): open `furny-postgres` → Backups → confirm the last 7 daily executions are "success" and sizes are plausible (no sudden drop > 30 %).

### 12.3 Object backup

The `object-backup` scheduled task on `furny-app` runs `docker/backup-objects.sh`; Coolify notifies on non-zero exit. B2's lifecycle keeps replaced/deleted versions 30 days, so an accidental deletion in R2 is recoverable for 30 days: `rclone copy dst:furny-object-backups/<bucket>/<path> src:<bucket>/<path>` (use `--b2-versions` / `--b2-version-at "<timestamp>"` to restore an older version).

### 12.4 Database restore procedure (production incident)

1. Announce: `php artisan down --retry=60` (in `furny-app` terminal, §14).
2. Stop writers: Coolify → `furny-app` → Stop; `furny-reverb` → Stop.
3. Pick the dump: Coolify → `furny-postgres` → Backups → executions → note the file name; or list B2.
4. On the production server (SSH as root):

   ```bash
   DUMP_PATH="<path/in/bucket/to/file.dmp>"          # from step 3
   mkdir -p /root/restore && cd /root/restore
   docker run --rm -v /root/restore:/data \
     -e RCLONE_CONFIG_B2_TYPE=b2 -e RCLONE_CONFIG_B2_ACCOUNT=<key id> -e RCLONE_CONFIG_B2_KEY=<app key> \
     rclone/rclone:latest copy "b2:furny-db-backups/$DUMP_PATH" /data
   PG=$(docker ps --format '{{.Names}}' | grep '<furny-postgres-uuid>')
   docker exec -i "$PG" psql -U furny -d postgres -c 'CREATE DATABASE furny_restore OWNER furny;'
   docker exec -i "$PG" pg_restore -U furny -d furny_restore --no-owner --exit-on-error < "/root/restore/$(basename "$DUMP_PATH")"
   docker exec -i "$PG" psql -U furny -d furny_restore -c "select count(*) from users; select max(created_at) from orders; select count(*) from migrations;"
   ```

5. Swap databases (no connections exist because app/reverb are stopped):

   ```bash
   docker exec -i "$PG" psql -U furny -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='furny' AND pid <> pg_backend_pid();"
   docker exec -i "$PG" psql -U furny -d postgres -c 'ALTER DATABASE furny RENAME TO furny_broken_'"$(date +%Y%m%d)"';'
   docker exec -i "$PG" psql -U furny -d postgres -c 'ALTER DATABASE furny_restore RENAME TO furny;'
   ```

6. Clear derived state that no longer matches the DB: `furny-redis` terminal → `redis-cli -a "$REDIS_PASSWORD" -n 1 FLUSHDB` (cache DB only; sessions/queues in DB 0 stay). After restart, jobs that reference rows newer than the dump fail with `ModelNotFoundException`; delete them from Horizon → Failed (do not retry).
7. Start `furny-app` (its `start.sh` runs `migrate` — no-op unless the dump predates a migration), then `furny-reverb`. `php artisan up`.
8. Verify `/up/deep`, log in, open recent orders. Inform affected customers of any data entered after the dump time (the dump timestamp is the RPO).
9. After 14 days, drop `furny_broken_<date>`.

### 12.5 Restore drill (quarterly: first Monday of Jan/Apr/Jul/Oct)

1. Download the latest production daily dump with the commands of §12.4 step 4 **on the staging server**.
2. Restore into a throw-away database `furny_drill` in the **staging** Postgres container (`pg_restore … -d furny_drill`).
3. Run the verification queries; record duration (target < 30 min end-to-end) and dump age in `docs/ops-log.md`.
4. `DROP DATABASE furny_drill;` and delete the downloaded file (production data must not persist on staging).
5. Also restore one random object from `furny-object-backups` to a temporary R2 prefix and open it; delete afterwards.

---

## 13. Monitoring & alerting

### 13.1 Built-in dashboards

| Tool | URL | Who | Watch for |
|---|---|---|---|
| Laravel Pulse | `/pulse` | owner, admin | slow requests/queries/jobs, exceptions, server CPU/memory (from `pulse:check`), queue throughput |
| Horizon | `/horizon` | owner, admin | status "Active", wait time per queue, failed jobs, `imports` runtime |
| Telescope | `/telescope` (staging only) | owner, admin | request/job/query detail while testing |
| Coolify | `https://coolify.furny.example.com` | owner | deployments, container status, logs, metrics, backups |

### 13.2 Alerts

| Signal | Source | Channel | Threshold |
|---|---|---|---|
| Deploy failed / succeeded | Coolify | email | every event |
| Backup or scheduled task failed | Coolify | email | every event |
| Container stopped/unhealthy, server unreachable, disk > 80 % | Coolify | email | every event |
| Queue wait too long | Horizon `waits` + `Horizon::routeMailNotificationsTo(HORIZON_NOTIFY_EMAIL)` | email | `redis:default` 60 s, `redis:notify` 120 s, `redis:engine` 300 s, `redis:pdf` 300 s, `redis-long:imports` 900 s |
| Site down | Better Stack | email + push (mobile app) | `/up` non-200 for 2 consecutive checks |
| Dependency degraded | Better Stack | email | `/up/deep` non-200 or body lacks `"status":"ok"` |
| Exceptions | Sentry (if enabled) | email | new issue; regression |
| AI spend | app (`18`) | in-app + email | `ai.global_monthly_budget_usd` thresholds per `18` |

### 13.3 External uptime (Better Stack Uptime, free tier)

Monitors (3-minute interval, region: Singapore + one other):
1. `https://furny.example.com/up` — expect 200.
2. `https://furny.example.com/up/deep` with request header `X-Health-Token: <HEALTH_CHECK_TOKEN>` — expect 200 and keyword `"status":"ok"`.
3. `https://ws.furny.example.com` — TCP/TLS check on port 443 (certificate expiry alert at 14 days).
4. `https://coolify.furny.example.com` — expect 200.

### 13.4 Logs

All processes log to stdout/stderr (Laravel `LOG_STACK=stderr`, nginx, php-fpm, supervisor, uvicorn). View in Coolify → resource → Logs (Docker keeps 5 × 20 MB per container). No log shipping in v1 (Sentry + Pulse cover error and performance visibility); if needed later, add Better Stack Logs via its Docker log collector without app changes.

### 13.5 Error tracking (optional, decided: Sentry SaaS)

When enabled: composer `sentry/sentry-laravel ^4`, npm `@sentry/vue ^10`, python `sentry-sdk[fastapi] ^2`. Release = `app.version`; environment = `APP_ENV`; `send_default_pii=false`; before-send scrubbers drop `phone_e164`, `email`, presigned URLs. Disabled (no DSN) by default.

---

## 14. Maintenance mode

```bash
# furny-app terminal
php artisan down --retry=60 --refresh=30 --secret="<openssl rand -hex 16>"
# staff bypass: open https://furny.example.com/<secret> once (sets a bypass cookie)
php artisan up
```

- Driver `cache`/store `redis` → applies to all app containers, survives deploys.
- `/up` and `/up/deep` stay reachable (§5.11 item 2), so Coolify/Traefik keep routing and users see the 503 page.
- Horizon workers **pause** while down (Horizon `force` = false, Laravel default); jobs wait in Redis. The scheduler skips tasks while down (no `evenInMaintenanceMode()` in v1).
- Reverb keeps running; clients stay connected but receive no events.
- Use for: DB restore, risky manual data fixes, provider migrations. Not needed for normal deploys.

---

## 15. Scaling path (in order)

1. **Vertical**: resize the production VPS to 8 vCPU / 16 GB (provider resize, ~5 min downtime). Then raise `pm.max_children` to 24, Horizon production `maxProcesses` per `01 §7` × 2 for `imports`/`engine`, `furny-vision` memory limit 6 GB and `--workers 3`, Postgres `shared_buffers` 2GB/`effective_cache_size` 6GB.
2. **Split workers**: create `furny-worker` (same repo/branch/Nixpacks, no domain, start command `bash /app/docker/start.sh`, env identical with `CONTAINER_ROLE=worker`, `RUN_MIGRATIONS=false`, health check CMD `php artisan horizon:status`, memory 2560m); set `furny-app` `CONTAINER_ROLE=web`. Add it to the CI deploy job (deployed together with `furny-app`, after it). Exactly one container may run the `worker` role (it carries the scheduler).
3. **Dedicated vision server**: when imports dominate CPU. Second server in Coolify; private network between servers; vision gets a port mapping bound to the private IP (`10.0.0.3:8000:8000`); `VISION_SERVICE_URL=http://10.0.0.3:8000`; token auth unchanged; provider firewall allows 8000 only from the app server's private IP.
4. **Database**: move Postgres to its own server or a managed PostgreSQL 18 when the DB exceeds ~20 GB or CPU contention appears in Pulse; switch backups to the provider's PITR.
5. Multiple web replicas behind Traefik require Coolify Swarm mode and are out of scope for v1.

---

## 16. Incident runbooks

Format: **Symptoms → Diagnose → Fix → Verify**. All commands run in Coolify → resource → Terminal unless stated.

### 16.1 Queue stuck / jobs not processing

- **Symptoms**: imports stay `queued`, emails not sent, quotes without PDF, Horizon "Inactive", Better Stack `/up/deep` reports `horizon` or `scheduler` false.
- **Diagnose**: `php artisan horizon:status`; `supervisorctl -c /app/docker/supervisor/supervisord.conf status`; Horizon dashboard → wait times, failed jobs; `redis-cli -a "$REDIS_PASSWORD" info memory` in `furny-redis` (used_memory near `maxmemory` → writes fail with `OOM command not allowed`); maintenance mode on? (`php artisan about | grep -i maintenance`).
- **Fix**: Horizon not running → `supervisorctl … restart horizon`. Paused → `php artisan horizon:continue`. Redis full → find big keys (`redis-cli --bigkeys`), `php artisan cache:clear` (cache DB only), raise `maxmemory`/limit. Poison job crashing workers → Horizon → Failed → inspect, fix, deploy; then retry. Scheduler dead → `supervisorctl … restart scheduler`.
- **Verify**: wait times drop; `/up/deep` ok; retry failed jobs from Horizon (Failed → Retry) only after the cause is fixed.

### 16.2 Vision service down or failing

- **Symptoms**: imports end `failed`; `/up/deep` `vision: false`; Horizon `imports` failures with connection errors.
- **Behaviour by design**: `RunBlueprintRecognition` retries (2 tries, 30 s backoff); on final failure the import becomes `failed` with the service-unavailable error code (`06 §8`) and reserved credits are **refunded** (`RefundCredits`); the customer sees the failure state with "Try again" and the manual trace option. `imports:cleanup-stale` (hourly) fails and refunds anything stuck > 30 min. Provider-side errors fall back to the `none` pipeline when `ai.fallback_to_none_on_error` is true.
- **Diagnose**: `furny-vision` → Logs (OOM = exit code 137 / "Killed"); from `furny-app`: `curl -fsS http://<vision-uuid>:8000/health`; provider status pages; check `ANTHROPIC_API_KEY` validity/spend limit.
- **Fix**: OOM → raise memory limit or set `MAX_CONCURRENT_JOBS=1` and Horizon `imports` processes 1; restart `furny-vision`. Provider outage → Admin → Settings → AI → provider `none` until resolved. Bad deploy → Rollback.
- **Verify**: `/health` ok; re-run one import; refund audit — every recently failed import nets zero credits:

  ```sql
  select bi.id, bi.credits_reserved, bi.credits_charged, coalesce(sum(l.delta), 0) as net
  from blueprint_imports bi
  left join ai_credit_ledger l on l.reference_id = bi.id
  where bi.status = 'failed' and bi.updated_at > now() - interval '2 days'
  group by bi.id having coalesce(sum(l.delta), 0) <> 0;
  ```

  Any row → Admin → customer → AI credits → Grant (kind `admin_grant`, note "refund import <id>").

### 16.3 Reverb down

- **Symptoms**: no live updates; `/up/deep` `reverb: false`; browser console WebSocket errors.
- **Behaviour by design**: pages poll every 30 s while disconnected (`01 §8`); nothing is lost (in-app notifications are stored in the DB).
- **Diagnose**: `furny-reverb` status/logs; `curl -sI https://ws.furny.example.com/app/<REVERB_APP_KEY>` (any HTTP response from Reverb, e.g. 400/426, proves routing; a Traefik 404/502 means container/domain problem); certificate valid? env `REVERB_*` identical in app and reverb?
- **Fix**: Restart `furny-reverb`; redeploy if config changed; failed broadcast jobs in Horizon are stale — do not retry them.
- **Verify**: open an order page in two browsers, post a message, it appears without reload.

### 16.4 Object storage (R2) outage

- **Symptoms**: uploads fail at presign/PUT, images/thumbnails broken, PDFs not stored, imports failing at download.
- **Diagnose**: Cloudflare status page; `php artisan tinker --execute="Storage::disk('s3')->get('health/probe.txt');"`.
- **Fix**: none on our side during a provider outage; do not switch providers mid-incident. Jobs retry with backoff; failed imports refund credits automatically. Post a notice to customers via the business's channels if > 1 h.
- **Verify** (after recovery): retry failed `pdf` and media-conversion jobs in Horizon; regenerate missing conversions `php artisan media-library:regenerate --only-missing`.

### 16.5 Database down / corrupted / bad data change

- Container down → Coolify → `furny-postgres` → Logs, Restart; disk full → §16.7.
- Data loss or corruption → §12.4 restore.
- Single bad manual change → restore the latest dump into `furny_restore` (steps 3–4 of §12.4 without stopping the app), copy the affected rows back with `psql` `\copy`, record in the ops log.

### 16.6 Redis down

- **Effect**: all requests fail (sessions/cache), Horizon stops, maintenance mode cannot be read.
- **Fix**: Coolify → `furny-redis` → Restart (AOF restores queues/sessions). If data is corrupt: stop, remove the AOF/RDB files via the volume, start empty — users are logged out, queued jobs are lost: re-dispatch by running `php artisan imports:cleanup-stale` (fails + refunds stuck imports) and asking staff to re-send any quote whose PDF is missing.

### 16.7 Disk full

- Coolify → Server → run Docker cleanup now; `docker system df`; `journalctl --vacuum-size=200M`; old local backups (`/data/coolify/backups`) beyond retention; resize disk or add a provider volume for `/var/lib/docker` if still > 80 %.

### 16.8 Failed deployment

- Coolify keeps the old container (rolling update). Read the deployment log: build errors (Appendix B), `[check-runtime] FAIL`, `[start.sh] Missing required env var`, migration error, or health-check timeout. Fix forward via PR; for a migration error the DB is unchanged (each migration runs in a transaction on PostgreSQL).

### 16.9 Leaked secret

- Rotate per §6.5 immediately; for leaked provider keys revoke at the provider first. Leaked `APP_KEY`: rotate with `APP_PREVIOUS_KEYS` (keeps encrypted data readable), then force every user to log in again: set `SESSION_COOKIE=furny_session_v2` (any new name; orphaned Redis sessions expire by TTL) on `furny-app` and `furny-reverb`, run `php artisan tinker --execute="DB::table('users')->update(['remember_token' => null]);"`, redeploy. Afterwards re-encrypt data with the new key (`13`) and remove the old key from `APP_PREVIOUS_KEYS`.

---

## 17. Hosting cost estimate (monthly, indicative 2026 prices — verify at order time)

| Item | Choice | Cost |
|---|---|---|
| Production VPS 4 vCPU / 8 GB / 80 GB | Hetzner Cloud Singapore, shared AMD | ≈ €15–25 |
| Provider server backups | +20 % of server price | ≈ €3–5 |
| Staging VPS 2 vCPU / 4 GB | Hetzner Cloud Germany, CX class | ≈ €4–7 |
| Cloudflare R2 | 10 GB-month free, then $0.015/GB-month; no egress fees | $0–3 at < 200 GB |
| Backblaze B2 backups | $6/TB-month; ~50–200 GB incl. versions | ≈ $1 |
| Postmark | 10k emails/month plan | ≈ $15 |
| Domain + Cloudflare DNS | annual domain ÷ 12; Cloudflare free | ≈ $1–2 |
| Better Stack Uptime, Sentry Developer | free tiers | $0 |
| WhatsApp (Meta) | per delivered template message by category/country (`12 §7`) | usage |
| SMS (MSG91/Twilio) | per message + DLT registration (India) | usage |
| AI (Anthropic etc.) | capped by `ai.global_monthly_budget_usd` (default $50, `02 §13`) | ≤ $50 default |
| **Fixed total** | | **≈ $45–60 / month** + usage |

Scaling step 1 (16 GB server) adds ≈ €15–25/month; a dedicated GPU server for local LLMs is not part of the baseline (typically €150+/month).

---

## Appendix A — Migrating to Railpack later

Do this only when Nixpacks blocks something (e.g. PHP 8.5 needed) and only after a full staging cycle.

Facts (2026-10): Railpack is **Beta** in Coolify, requires Docker Buildx on the server, is configured with `railpack.json` and `RAILPACK_*` env vars; its PHP provider serves through **FrankenPHP** (Caddy) instead of nginx + php-fpm, defaults to PHP 8.4, and **runs migrations on start by default** (`RAILPACK_SKIP_MIGRATIONS` disables).

Plan:
1. Branch `chore/railpack`. Add `railpack.json` (starting point; validate on staging):

   ```json
   {
     "$schema": "https://schema.railpack.com",
     "packages": { "php": "8.4", "node": "22" },
     "deploy": {
       "aptPackages": ["curl"],
       "variables": { "PHPRC": "/app/docker/php.ini" }
     }
   }
   ```

2. Topology changes: FrankenPHP replaces nginx/php-fpm/supervisor, so split into **three** resources from the start: `furny-app` (web, Railpack default start), `furny-worker` (start command `php artisan horizon`, plus a second worker resource or Coolify Scheduled Task for `php artisan schedule:run` every minute — prefer a separate `furny-scheduler` resource with start command `php artisan schedule:work`), `furny-reverb` (unchanged start command).
3. Migrations: keep Railpack's migrate-on-start **only** on `furny-app`; set `RAILPACK_SKIP_MIGRATIONS=true` on worker/scheduler/reverb. Verify it uses `--force` and fails the container on error (else keep our rule O5 by a custom start command running `php artisan migrate --force --isolated && <railpack default start>`).
4. Node at runtime: confirm `node -v` = 22 inside the **final** image (Railpack may keep Node only in the build layer) — the engine CLI requires it. Run `docker/check-runtime.sh` adapted for FrankenPHP (drop nginx/php-fpm/supervisord checks).
5. Port nginx behaviours to Caddy/FrankenPHP: 50 MB body limit, `/build` immutable caching, `/sw.js` headers, static security headers, gzip/zstd; `/up` health path unchanged.
6. Coolify: switch Build Pack to Railpack per resource on **staging**, run the release checklist smoke test plus a 24-hour soak (Pulse latency, memory), then production in a low-traffic window. Rollback = switch build pack back and redeploy.
7. Delete `nixpacks.toml`, `nginx.template.conf`, `docker/supervisor/`, `docker/php-fpm.conf` after one stable production week; update this file.

---

## Appendix B — Build troubleshooting

| Error in Coolify build/deploy log | Fix |
|---|---|
| `[check-runtime] FAIL: Node 22 required` | Ensure `NIXPACKS_NODE_VERSION=22` is set (toml `[variables]` and build-time env) and `package.json` has `"engines": {"node": ">=22.12 <23"}`. If the provider still installs another Node, replace `"..."` in `nixPkgs` with the explicit provider list plus `nodejs_22`: `["php84", "php84Packages.composer", "nginx", "nodejs_22", "python311Packages.supervisor", "curl", "rclone"]` (the PHP extensions come from `composer.json` and are added by the provider independently of `nixPkgs`). |
| `missing PHP extensions: …` | Add `"ext-<name>": "*"` to `composer.json` `require`, commit `composer.lock`. |
| `docker/php.ini not loaded` | The Nix PHP wrapper ignored `PHPRC`. Fallback: copy every directive of `docker/php.ini` into `docker/php-fpm.conf` as `php_admin_value[...]` lines (web), add `-d memory_limit=512M` to the `horizon`, `scheduler` and `pulse-check` supervisor commands and to the Reverb start command (`php -d memory_limit=512M artisan reverb:start …`), and change the check in `check-runtime.sh` to `php -d memory_limit=512M`-independent assertions (`opcache` loaded). Record the deviation in the PR and in this file. |
| `ImportError: libGL.so.1` (vision) | Confirm `nixLibs` contains `libGL` and `glib`; as last resort pin `opencv-python-headless` and install `rapidocr` with `--no-deps` plus its other dependencies explicitly in `requirements.txt` (generated by `uv` with an override). |
| `nginx: [emerg] open() "…/conf/mime.types" failed` | The nginx package path detection in `start.sh` resolved a wrapper; print `readlink -f $(command -v nginx)` in the terminal and adjust the `NGINX_PREFIX` derivation. |
| Health check never passes, logs show migrations finished | Check `curl -fsS localhost/up` in the container terminal; 503 = maintenance mode without the `up` exception (§5.11 item 2); 500 = read `storage/logs` is empty because logs go to stderr — read Coolify Logs. |
| Build OOM during `npm run build` | Set build-time env `NODE_OPTIONS=--max-old-space-size=3072` on `furny-app`/`furny-reverb`. |

---

## Appendix: Proposed additions to other documents

1. **`01-architecture.md` §1.1** — optional packages for error tracking (enabled only with DSNs): `sentry/sentry-laravel ^4`, `@sentry/vue ^10`, `sentry-sdk[fastapi] ^2` (vision). `package.json` `"engines": {"node": ">=22.12 <23"}`. `composer.json` `extra.laravel.dont-discover: ["laravel/telescope"]` with conditional registration of `TelescopeServiceProvider` when installed and `TELESCOPE_ENABLED=true`.
2. **`01-architecture.md` §3 layout** — deployment files: `.dockerignore`, `compose.dev.yaml`, `docker/dev/pg-init.sql`, `docker/start.sh`, `docker/check-runtime.sh`, `docker/backup-objects.sh`, `docker/php.ini`, `docker/php-fpm.conf`, `docker/supervisor/{supervisord,php-fpm,nginx,horizon,scheduler,pulse-check}.conf`, `.github/workflows/ci.yml`, `.github/scripts/{changed-since-last-deploy,coolify-deploy}.sh`, `vision/nixpacks.toml`, `vision/requirements.txt` (generated by `uv export` from `vision/pyproject.toml` + `vision/uv.lock`), `docs/ops-log.md`.
3. **`01-architecture.md` §5.4** — `EngineCli` resolves the Node binary from `config('engine.node_binary')` (`config/engine.php`: `env('ENGINE_NODE_BINARY', 'node')`) instead of the literal `'node'`.
4. **`01-architecture.md` §7** — queue connections: `redis` (`retry_after` 180) for `default`, `engine`, `pdf`, `notify`; `redis-long` (same Redis, `retry_after` 720) for `imports`. Horizon `environments.staging` = 1 process per queue. Horizon `waits`: `redis:default` 60, `redis:notify` 120, `redis:engine` 300, `redis:pdf` 300, `redis-long:imports` 900; `Horizon::routeMailNotificationsTo(env('HORIZON_NOTIFY_EMAIL'))`. Supervisor also runs `php artisan pulse:check` (not a scheduler entry).
5. **`01-architecture.md` §7 scheduler** — every task uses `->onOneServer()->withoutOverlapping()`; add: every minute `health:scheduler-heartbeat` closure (`Cache::put('health:scheduler:heartbeat', now()->timestamp, 600)`); daily 03:40 `queue:prune-failed --hours=720`; daily 03:45 `queue:prune-batches --hours=48`; daily 03:50 `telescope:prune --hours=48` (only when Telescope is enabled).
6. **`01-architecture.md` §6 shared props** — `app.version` = `config('app.version')` = `env('APP_VERSION') ?: substr(env('SOURCE_COMMIT', 'dev'), 0, 7)`. `resources/js/app.ts` registers `window.addEventListener('vite:preloadError', () => window.location.reload())`.
7. **`01-architecture.md` §8 / `config/reverb.php`** — `allowed_origins` from `REVERB_ALLOWED_ORIGINS` (comma-separated hosts, default `*`); production runs with `REVERB_SCALING_ENABLED=true`. Laravel publishes to Reverb via the public host `REVERB_HOST:443`.
8. **`01-architecture.md` (cross-cutting rule)** — service providers and config files must not access the database, Redis or HTTP during boot (image build runs artisan without services; `/up` must answer while dependencies are down).
9. **Master §6.7** — env names for all flags: `FEATURE_PAYMENTS`, `FEATURE_WHATSAPP`, `FEATURE_SMS`, `FEATURE_WEB_PUSH`, `FEATURE_GOOGLE_LOGIN`, `FEATURE_DXF_IMPORT`, `FEATURE_WALKTHROUGH_CAMERA` (the first four as already proposed in `12` appendix D).
10. **`02-data-model.md` §14** — all production seeders (`RolesAndPermissionsSeeder`, `SettingsSeeder`, `TaxRatesSeeder`, `CatalogSeeder`, `OwnerSeeder`) are idempotent (`updateOrCreate`/`firstOrCreate`; settings only insert missing keys) so `php artisan db:seed --force` is safe to re-run; `OwnerSeeder` also reads `SEED_OWNER_NAME` (default `Owner`) and does nothing if a user with `SEED_OWNER_EMAIL` exists.
11. **`06-blueprint-import.md` / `18-ai-providers-and-quotas.md`** — vision service exposes unauthenticated `GET /health` → `200 {"status":"ok","version":"<semver>"}` (no provider calls); env `REQUEST_TIMEOUT_SECONDS` (default 600, must stay below the `imports` job timeout of 660 s) and optional `SENTRY_DSN`; RapidOCR models are downloaded at image build time; vision Python dependencies managed with `uv` (`pyproject.toml` + `uv.lock`), `requirements.txt` exported for Nixpacks.
12. **`13-auth-security.md`** — `bootstrap/app.php`: `trustProxies(at: '*')`; `preventRequestsDuringMaintenance(except: ['up', 'up/deep'])`. Header ownership: nginx sets `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Strict-Transport-Security: max-age=31536000`; Laravel middleware sets only `Content-Security-Policy` (Vite nonce) and, when `APP_ENV != production`, `X-Robots-Tag: noindex, nofollow`. Gates `viewHorizon`, `viewPulse`, `viewTelescope` = staff with role `owner` or `admin`. Google OAuth callback path `/auth/google/callback`. Turnstile site key is passed to the browser as a page prop (not a `VITE_*` variable).
13. **`14-routes-and-api.md`** — route `health.deep`: `GET /up/deep`, controller `App\Http\Controllers\HealthController`, no session/auth, requires `X-Health-Token` header or `token` query equal to `HEALTH_CHECK_TOKEN` (404 otherwise), response and checks as defined in `17 §5.11` item 13. Framework route `/up` (Laravel `health:` in `bootstrap/app.php`).
14. **PDF templates (`resources/views/pdf/*`, owners `08`/`09`)** — images (logo, thumbnails, photos) are embedded as data URIs; Gotenberg must never need to fetch URLs.
15. **`16-testing-quality.md`** — CI job names `php`, `frontend`, `vision`, `browser` are required status checks; browser tests live in `tests/Browser` and run with `vendor/bin/pest tests/Browser`; unit/feature with `vendor/bin/pest tests/Unit tests/Feature --parallel`; vision tests receive the engine CLI path via env `ENGINE_CLI`.
