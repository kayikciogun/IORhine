#!/usr/bin/env node
/**
 * IO-CAM çapraz platform başlatıcı (Windows / macOS / Linux).
 * ``npm run dev`` bash/WSL gerektirmeden Next.js + runtime açar.
 *
 *   node scripts/start.mjs [--dev] [--no-install] [--mock] [--install]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, "io-cam-runtime");
const LOG_DIR = path.join(ROOT, ".logs");
const IS_WIN = process.platform === "win32";

const RUNTIME_PORT = Number(process.env.RUNTIME_PORT || 8000);
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 9002);
const RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}`;

const argv = new Set(process.argv.slice(2));
const MOCK = argv.has("--mock");
const DEV = argv.has("--dev");
const INSTALL_ONLY = argv.has("--install");
const SKIP_INSTALL = argv.has("--no-install");
const SKIP_RUNTIME = argv.has("--skip-runtime");
const SKIP_FRONTEND = argv.has("--skip-frontend");

if (argv.has("--help") || argv.has("-h")) {
  console.log(`IO-CAM başlatıcı

  node scripts/start.mjs [seçenekler]
  --mock --dev --install --no-install --skip-runtime --skip-frontend

  http://localhost:${FRONTEND_PORT}/
  http://localhost:${FRONTEND_PORT}/production
  ${RUNTIME_URL}/health`);
  process.exit(0);
}

const children = [];

function log(msg) {
  console.log(`\x1b[1;36m▶\x1b[0m ${msg}`);
}
function ok(msg) {
  console.log(`\x1b[1;32m✓\x1b[0m ${msg}`);
}
function warn(msg) {
  console.log(`\x1b[1;33m!\x1b[0m ${msg}`);
}
function die(msg) {
  console.error(`\x1b[1;31m✗\x1b[0m ${msg}`);
  process.exit(1);
}

function findPython() {
  for (const cmd of IS_WIN ? ["python", "py"] : ["python3", "python"]) {
    const r = spawnSync(cmd, ["--version"], {
      encoding: "utf8",
      shell: IS_WIN,
    });
    if (r.status === 0) return cmd;
  }
  return null;
}

function ensureEnvLocal() {
  // Tek .env — frontend + runtime aynı dosyayı okur (io-cam-runtime/app/config/settings.py).
  const p = path.join(ROOT, ".env");
  const example = path.join(ROOT, ".env.example");
  if (!existsSync(p)) {
    if (existsSync(example)) {
      writeFileSync(p, readFileSync(example, "utf8"), "utf8");
    } else {
      writeFileSync(p, `NEXT_PUBLIC_RUNTIME_URL=${RUNTIME_URL}\n`, "utf8");
    }
    ok(".env oluşturuldu");
  }
}

function runSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: IS_WIN,
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) die(`${cmd} ${args.join(" ")} başarısız (code ${r.status})`);
}

/** Shell'de kalmış IO_CAM_* değerleri .env'i ezer — spawn öncesi temizle. */
function envWithoutStaleIoCam(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("IO_CAM_")) delete env[key];
  }
  return { ...env, ...extra };
}

function startLogged(cmd, args, logFile, opts = {}) {
  mkdirSync(LOG_DIR, { recursive: true });
  const fd = openSync(logFile, "a");
  const child = spawn(cmd, args, {
    cwd: opts.cwd || ROOT,
    env: envWithoutStaleIoCam(opts.env || {}),
    shell: IS_WIN,
    stdio: ["ignore", fd, fd],
    detached: false,
  });
  children.push(child);
  child.on("exit", (code) => {
    warn(`${cmd} çıktı (code=${code}) — log: ${logFile}`);
  });
  return child;
}

function waitHealth(timeoutSec = 45) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutSec * 1000;
    const tick = () => {
      const req = http.get(`${RUNTIME_URL}/health`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          ok(`Runtime hazır (${RUNTIME_URL}/health)`);
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(1500, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Runtime ${RUNTIME_URL} yanıt vermedi (${timeoutSec}s)`));
        return;
      }
      setTimeout(tick, 1000);
    };
    tick();
  });
}

function installAll(python) {
  if (SKIP_INSTALL) {
    warn("Kurulum atlandı (--no-install)");
    return;
  }
  log("Frontend bağımlılıkları (npm install)…");
  runSync(IS_WIN ? "npm.cmd" : "npm", ["install"], { cwd: ROOT });
  log("Runtime bağımlılıkları (pip install -e .)…");
  runSync(python, ["-m", "pip", "install", "-e", "."], { cwd: RUNTIME_DIR });
  ok("Bağımlılıklar hazır");
}

function cleanup() {
  for (const c of children) {
    try {
      if (!c.killed) {
        if (IS_WIN) {
          spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], {
            stdio: "ignore",
          });
        } else {
          c.kill("SIGTERM");
        }
      }
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  log("IO-CAM başlatıcı (Node)");
  ensureEnvLocal();

  const python = findPython();
  if (!python) die("Python bulunamadı (3.11+ gerekli)");

  installAll(python);
  if (INSTALL_ONLY) {
    ok("Kurulum tamam (--install)");
    return;
  }

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  if (!SKIP_RUNTIME) {
    const runtimeLog = path.join(LOG_DIR, "runtime.log");
    const env = {
      PYTHONUNBUFFERED: "1",
      IO_CAM_CORS_ORIGINS: `http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}`,
    };
    if (MOCK) {
      env.IO_CAM_MOCK_HARDWARE = "1";
      warn("Mock hardware açık");
    } else {
      // Process'te kalmış eski mock bayrağını temizle
      delete process.env.IO_CAM_MOCK_HARDWARE;
    }

    const uArgs = [
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "0.0.0.0",
      "--port",
      String(RUNTIME_PORT),
    ];
    if (DEV) {
      uArgs.push("--reload");
      warn("Dev mode: uvicorn --reload");
    }

    log(`Runtime başlatılıyor (port ${RUNTIME_PORT})…`);
    startLogged(python, uArgs, runtimeLog, { cwd: RUNTIME_DIR, env });
    try {
      await waitHealth(60);
    } catch (e) {
      die(String(e.message || e));
    }
  }

  if (!SKIP_FRONTEND) {
    const frontendLog = path.join(LOG_DIR, "frontend.log");
    log(`Next.js başlatılıyor (port ${FRONTEND_PORT})…`);
    startLogged(
      IS_WIN ? "npm.cmd" : "npm",
      ["run", "dev:next"],
      frontendLog,
      {
        cwd: ROOT,
        env: { NEXT_PUBLIC_RUNTIME_URL: RUNTIME_URL },
      },
    );
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  IO-CAM çalışıyor                                        ║
╠══════════════════════════════════════════════════════════╣
║  Planlama:     http://localhost:${FRONTEND_PORT}/              ║
║  Üretim:       http://localhost:${FRONTEND_PORT}/production    ║
║  Runtime API:  ${RUNTIME_URL}                   ║
║  Loglar:       ${LOG_DIR}${IS_WIN ? "\\" : "/"}                          ║
╚══════════════════════════════════════════════════════════╝

Durdurmak için Ctrl+C
`);

  // Keep alive while children run
  await new Promise(() => {});
}

main().catch((e) => {
  cleanup();
  die(String(e.stack || e));
});
