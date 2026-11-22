# FPGA SIM. The targets of spec section 11.3: images, build server, interface, benchmark, style check,
# tests of core, server and interface, examples without a browser, end-to-end tests,
# static deployment and tests of the production URLs.

include server/docker/versions.env

TAG        := vl$(VERILATOR_VERSION)-em$(EMSCRIPTEN_VERSION)
# Tools image (Verilator, Emscripten): the core tests and the benchmark run in it.
IMAGE      := fpgasim-tools:$(TAG)
# Build image: tools, runtime library and job script (spec section 8.2).
# The server uses it. The tag includes the runtime version.
IMAGE_FULL := fpgasim-build:$(TAG)-rt$(shell head -n 1 core/VERSION)
API_IMAGE  := fpgasim-api:dev
# Number of parallel jobs for the Verilator build in the image.
IMAGE_JOBS ?= 8
# Host names are in the site settings (decision 173, deploy/site.env.example); the scripts read them
# through deploy/site.sh, so variables set in the environment win over the file.
VPS_DIR    ?= /opt/fpgasim
VPS_WORK   ?= /var/lib/fpgasim/bench

export IMAGE VPS VPS_DIR VPS_WORK VERILATOR_VERSION EMSCRIPTEN_VERSION UBUNTU_VERSION

.PHONY: image image-api dev test-examples deploy-server image-name bench bench-mac bench-chrome bench-vps bench-merge bench-serve
.PHONY: deploy-web e2e-prod backup-accounts
.PHONY: check check-spec check-bench lint lint-cpp lint-py lint-web lint-scripts test-core test-server test-web e2e

# Versions of the style-check tools. They are not installed on the Mac: uvx takes them from its cache.
RUFF         := uvx ruff@0.14.5
CLANG_FORMAT := uvx clang-format==23.1.5

# The tools image and the build image on top of it. The first builds slowly and once;
# the second rebuilds when core/ or server/job/ changes.
image:
	tools/bench/image.sh $(IMAGE_JOBS)

# Service image with the test tools (target test in Dockerfile.api). The deployment builds the production image.
image-api:
	docker build -q -f server/docker/Dockerfile.api --target test -t $(API_IMAGE) .

# Build server on http://localhost:8080 and interface on http://localhost:5173.
dev: image image-api web/node_modules/.package-lock.json
	tools/dev/dev.sh

image-name:
	@echo $(IMAGE)

# Full benchmark: Mac (plain code, Node, Chrome) and VPS (plain code, build time).
bench: bench-mac bench-chrome bench-vps bench-merge

bench-mac: image
	tools/bench/run_mac.sh

bench-chrome:
	cd tools/bench && npm install --no-audit --no-fund && node run_chrome.mjs bench/out/$(TAG)

bench-vps:
	tools/bench/run_vps.sh

bench-merge:
	node tools/bench/merge.mjs

# Benchmark page for a manual check: http://localhost:8377/tools/bench/bench.html
bench-serve:
	node tools/bench/serve.mjs

# Full check before finishing a task: style, schemas, tests of core, server, interface and examples, end-to-end tests, benchmark completeness.
check: lint check-spec test-core test-server test-examples test-web e2e check-bench

check-bench:
	node tools/bench/merge.mjs --verify

# Schemas in spec/, samples in spec/tests/, board files, part descriptions, fpgasim.json of the examples.
check-spec: tools/spec/node_modules/.package-lock.json
	node tools/spec/check.mjs

lint: lint-cpp lint-py lint-web lint-scripts

# Files are searched in the tree, not in the Git index: the check runs before the commit, and a new file must be included.
SKIP_DIRS := -name node_modules -o -name .fpgasim -o -name .venv -o -name .worktrees -o -name .git -o -name out -o -name dist -o -name build

lint-cpp:
	find . \( $(SKIP_DIRS) \) -prune -o -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.h' -o -name '*.hpp' \) -print0 \
		| xargs -0 $(CLANG_FORMAT) --dry-run --Werror

lint-py:
	$(RUFF) check server tools
	$(RUFF) format --check server tools

lint-web: web/node_modules/.package-lock.json
	cd web && npm run --silent lint && npm run --silent typecheck

# Scripts outside web/: tools/**/*.mjs and the end-to-end tests in e2e/. ESLint and Prettier come from web/.
lint-scripts: web/node_modules/.package-lock.json e2e/node_modules/.package-lock.json
	web/node_modules/.bin/eslint -c web/eslint.scripts.config.js tools e2e
	web/node_modules/.bin/prettier --config web/.prettierrc.json --check "tools/**/*.mjs" e2e
	cd e2e && npx tsc --noEmit

# Node dependencies install from the lock file and only when it changed.
%/node_modules/.package-lock.json: %/package-lock.json
	cd $* && npm ci --no-audit --no-fund
	@touch $@

# Core tests run in the build image: unit tests (Catch2, stub engine) and examples
# on the real Verilator in a normal build. The build directory core/build is not stored in Git.
# Core messages collected in the tests are then checked against the schemas in spec/protocol.
CORE_TRANSCRIPT := core/build/transcript.jsonl

test-core: tools/spec/node_modules/.package-lock.json
	docker run --rm -v "$(CURDIR)":/src -w /src $(IMAGE) core/tests/run.sh
	node tools/spec/check.mjs --transcript $(CORE_TRANSCRIPT)

# Server tests run in the service container. It starts jobs through the Docker socket, as on the VPS.
# The repository is bound at its own path: Docker binds the job folder by its path on the host.
test-server: image image-api
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$(CURDIR)":"$(CURDIR)" -w "$(CURDIR)/server" \
		-e PYTHONPATH="$(CURDIR)/server" -e PYTHONDONTWRITEBYTECODE=1 \
		-e FPGASIM_IMAGE=$(IMAGE_FULL) -e FPGASIM_TEST_DIR="$(CURDIR)/.fpgasim/tests" \
		$(API_IMAGE) pytest -q -p no:cacheprovider

# Examples without a browser: a build through the local server and running expect.json in Node.
test-examples: image image-api
	tools/dev/server.sh with node tools/headless/run.mjs

# Server deployment to the VPS (spec section 10.2).
deploy-server:
	deploy/deploy.sh

# The latest daily copy of the accounts database from the VPS into .fpgasim/backup/ (accounts spec
# section 2.5, docs/tz-accounts.md). It only reads on the VPS.
backup-accounts:
	deploy/backup-accounts.sh

# Static deployment to Cloudflare Pages (spec section 10.1): a Vite build with the production URL of the build
# server, then wrangler pages deploy. It needs wrangler login.
deploy-web: web/node_modules/.package-lock.json
	deploy/deploy-web.sh

# End-to-end tests against the production URLs (spec section 11.3). The access key is in FPGASIM_KEY.
# The acceptance-test account (docs/tz-accounts.md, section 6) is in FPGASIM_USER_LOGIN and FPGASIM_USER_PASSWORD;
# without them the account tests are skipped.
e2e-prod: e2e/node_modules/.package-lock.json
	cd e2e && npx playwright install chromium
	bash -c '. deploy/site.sh && cd e2e && npx playwright test -c playwright.prod.config.ts $(E2E_ARGS)'

# Interface unit tests (Vitest): protocol against reference files, storage, dictionary.
test-web: web/node_modules/.package-lock.json
	cd web && npx vitest run

# End-to-end tests on the local stand (Playwright, Chromium): build server in a container,
# built interface. Chromium downloads into the Playwright cache on the first run.
e2e: image image-api web/node_modules/.package-lock.json e2e/node_modules/.package-lock.json
	cd e2e && npx playwright install chromium
	e2e/run.sh
