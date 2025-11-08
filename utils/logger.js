// utils/logger.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// LOG_PATH can be overridden, but defaults to ./logs/factchecks.json
const DEFAULT_LOG_PATH = path.join(__dirname, "..", "logs", "factchecks.json");
const LOG_PATH = process.env.LOG_PATH || DEFAULT_LOG_PATH;

function ensureDir() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readFactChecks() {
  try {
    ensureDir();
    if (!fs.existsSync(LOG_PATH)) return [];
    const raw = fs.readFileSync(LOG_PATH, "utf8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading fact-check log:", err);
    return [];
  }
}

export function logFactCheck(entry) {
  try {
    ensureDir();
    const logs = readFactChecks();
    logs.push({
      ...entry,
      timestamp: Date.now()
    });
    fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing fact-check log:", err);
  }
}
