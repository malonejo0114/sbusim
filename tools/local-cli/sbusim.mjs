#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const VERSION = "0.1.0";
const ALLOWED_GLOBAL_FLAGS = new Set(["help", "h", "version"]);

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printUsage(argv[0] === "threads" ? "threads" : "root");
    return;
  }
  if (argv.includes("--version")) {
    console.log(VERSION);
    return;
  }

  const [scope, command, ...rest] = argv;
  if (scope !== "threads") {
    throw usageError(`알 수 없는 명령입니다: ${scope}`);
  }
  if (!command || command === "--help" || command === "-h") {
    printUsage("threads");
    return;
  }

  switch (command) {
    case "accounts": {
      const args = parseArgs(rest, {
        flags: ["json"],
        values: ["owners", "accounts"],
        usage: "accounts",
      });
      return threadsAccounts(await loadConfig(), args);
    }
    case "posts": {
      const args = parseArgs(rest, {
        flags: ["sync", "json"],
        values: ["date", "owners", "accounts", "out"],
        required: ["date"],
        usage: "posts",
      });
      return threadsPosts(await loadConfig(), args);
    }
    case "sync-insights": {
      const args = parseArgs(rest, {
        flags: [],
        values: ["date", "owners", "accounts"],
        required: ["date"],
        usage: "sync-insights",
      });
      return threadsSyncInsights(await loadConfig(), args);
    }
    case "report": {
      const args = parseArgs(rest, {
        flags: ["xlsx", "sync", "no-thread-url"],
        values: ["date", "owners", "accounts", "format", "out"],
        required: ["date"],
        usage: "report",
      });
      return threadsReport(await loadConfig(), args);
    }
    case "schedule": {
      const args = parseArgs(rest, {
        flags: ["now"],
        values: ["account", "text", "replies", "media-type", "media-url", "at"],
        required: ["account", "text"],
        usage: "schedule",
      });
      return threadsSchedule(await loadConfig(), args);
    }
    default:
      throw usageError(`알 수 없는 threads 명령입니다: ${command}`, "threads");
  }
}

async function loadConfig() {
  const homeEnv = join(homedir(), ".sbusim", ".env.local");
  const cwdEnv = resolve(process.cwd(), ".env.local");
  const config = {};

  Object.assign(config, await parseEnvFile(homeEnv));
  Object.assign(config, await parseEnvFile(cwdEnv));
  if (process.env.SBUSIM_API_URL) config.SBUSIM_API_URL = process.env.SBUSIM_API_URL;
  if (process.env.SBUSIM_API_KEY) config.SBUSIM_API_KEY = process.env.SBUSIM_API_KEY;

  const url = trimTrailingSlash(config.SBUSIM_API_URL || "");
  const key = config.SBUSIM_API_KEY || "";
  if (!url || !key) {
    throw new CliError(
      [
        "SBUSIM 로컬 CLI 설정이 필요합니다.",
        "다음 위치 중 하나에 SBUSIM_API_URL / SBUSIM_API_KEY를 설정하세요:",
        `- ${homeEnv}`,
        `- ${cwdEnv}`,
        "또는 실행 환경 변수로 지정하세요.",
        "예: SBUSIM_API_URL=https://app.sbusim.co.kr SBUSIM_API_KEY=**** sbusim threads accounts",
      ].join("\n"),
      2,
    );
  }

  return { apiUrl: url, apiKey: key };
}

async function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  const text = await readFile(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseArgs(args, spec) {
  const parsed = { _: [] };
  const flags = new Set([...(spec.flags || []), ...ALLOWED_GLOBAL_FLAGS]);
  const values = new Set(spec.values || []);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (flags.has(name)) {
      if (eq !== -1) throw usageError(`값을 받을 수 없는 옵션입니다: --${name}`, spec.usage);
      parsed[name] = true;
      continue;
    }
    if (values.has(name)) {
      const value = eq === -1 ? args[i + 1] : arg.slice(eq + 1);
      if (value == null || value.startsWith("--")) {
        throw usageError(`옵션 값이 필요합니다: --${name}`, spec.usage);
      }
      parsed[name] = value;
      if (eq === -1) i += 1;
      continue;
    }
    throw usageError(`알 수 없는 옵션입니다: --${name}`, spec.usage);
  }

  if (parsed.help || parsed.h) {
    printUsage(spec.usage || "threads");
    process.exit(0);
  }
  if (parsed._.length > 0) {
    throw usageError(`알 수 없는 인자입니다: ${parsed._.join(" ")}`, spec.usage);
  }
  for (const required of spec.required || []) {
    if (!parsed[required]) throw usageError(`필수 옵션이 없습니다: --${required}`, spec.usage);
  }
  return parsed;
}

async function threadsAccounts(config, args) {
  const query = queryString({
    owners: args.owners,
    accounts: args.accounts,
  });
  const data = await requestJson(config, "GET", `/api/local/threads/accounts${query}`);
  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printTable(
    ["소유자", "계정", "라벨", "Threads", "사용자ID", "토큰만료"],
    (data.accounts || []).map((account) => [
      account.owner,
      account.id,
      account.label,
      account.threadsUsername,
      account.threadsUserId,
      account.tokenExpiresAt,
    ]),
  );
  console.log(`총 ${(data.accounts || []).length}개 계정`);
}

async function threadsPosts(config, args) {
  const query = queryString({
    date: args.date,
    owners: args.owners,
    accounts: args.accounts,
    syncInsights: args.sync ? "true" : undefined,
  });
  const data = await requestJson(config, "GET", `/api/local/threads/posts${query}`);
  if (args.out) await writeJsonFile(args.out, data);
  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printTable(
    ["소유자", "계정", "발행시각(KST)", "상태", "조회", "좋아요", "답글", "본문"],
    (data.posts || []).map((post) => [
      post.owner,
      post.accountName || post.accountId,
      post.publishedAtKst || post.scheduledAtKst || "",
      post.status,
      numberText(post.viewsCount),
      numberText(post.likesCount),
      numberText(post.repliesCount),
      truncate(post.text || "", 40),
    ]),
  );
  const summary = data.summary || {};
  console.log(`요약: ${data.dateKst || args.date} 총 ${numberText(summary.total || 0)}개`);
}

async function threadsSyncInsights(config, args) {
  const data = await requestJson(config, "POST", "/api/local/threads/insights/sync", {
    date: args.date,
    owners: splitCsv(args.owners),
    accounts: splitCsv(args.accounts),
  });
  console.log(`인사이트 동기화 완료: 성공 ${numberText(data.synced || 0)}개, 실패 ${numberText(data.failed || 0)}개`);
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    for (const error of data.errors) console.error(`- ${typeof error === "string" ? error : JSON.stringify(error)}`);
  }
}

async function threadsReport(config, args) {
  const format = args.format || (args.xlsx ? "xlsx" : "xlsx");
  if (!["xlsx", "json"].includes(format)) {
    throw usageError("--format은 xlsx 또는 json만 사용할 수 있습니다.", "report");
  }
  const response = await request(config, "POST", "/api/local/threads/report", {
    date: args.date,
    owners: splitCsv(args.owners),
    accounts: splitCsv(args.accounts),
    format,
    includeThreadUrl: !args["no-thread-url"],
    syncInsights: Boolean(args.sync),
  });

  if (format === "json") {
    const data = await response.json();
    if (args.out) {
      await writeJsonFile(args.out, data);
      console.log(`저장됨: ${resolve(args.out)}`);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
    return;
  }

  const arrayBuffer = await response.arrayBuffer();
  const filename = args.out || contentDispositionFilename(response.headers.get("content-disposition")) || `sbusim-threads-posts-${args.date}.xlsx`;
  await writeBinaryFile(filename, Buffer.from(arrayBuffer));
  console.log(`저장됨: ${resolve(filename)}`);
}

async function threadsSchedule(config, args) {
  const hasAt = Boolean(args.at);
  const hasNow = Boolean(args.now);
  if (hasAt === hasNow) {
    throw usageError("--at 또는 --now 중 정확히 하나를 지정해야 합니다.", "schedule");
  }

  const text = await textOrFile(args.text);
  if (!text) throw usageError("--text 내용이 비어 있습니다.", "schedule");
  const replies = args.replies ? await readReplies(args.replies) : undefined;
  const body = {
    account: args.account,
    text,
    mediaType: args["media-type"],
    mediaUrl: args["media-url"],
    replies,
    immediate: hasNow ? true : undefined,
    scheduledAt: hasAt ? args.at : undefined,
  };
  const data = await requestJson(config, "POST", "/api/local/threads/schedule", body);
  const post = data.post || {};
  console.log(`id: ${post.id || ""}`);
  console.log(`계정: ${post.account || args.account}${post.threadsUsername ? ` (${post.threadsUsername})` : ""}`);
  console.log(`상태: ${post.status || ""}`);
  console.log(hasNow ? "예약시각(KST): 즉시 발행 요청됨" : `예약시각(KST): ${post.scheduledAtKst || args.at}`);
}

async function requestJson(config, method, path, body) {
  const response = await request(config, method, path, body);
  return response.json();
}

async function request(config, method, path, body) {
  let response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(body == null ? {} : { "Content-Type": "application/json" }),
      },
      body: body == null ? undefined : JSON.stringify(removeUndefined(body)),
    });
  } catch (error) {
    throw new CliError(`서버에 연결할 수 없습니다: ${error.message}`, 1);
  }

  if (!response.ok) {
    let message = "";
    try {
      const data = await response.json();
      message = data?.error || JSON.stringify(data);
    } catch {
      message = await response.text().catch(() => "");
    }
    throw new CliError(`HTTP ${response.status}${message ? `: ${message}` : ""}`, 1);
  }
  return response;
}

async function textOrFile(value) {
  const path = resolve(process.cwd(), value);
  if (existsSync(path)) return (await readFile(path, "utf8")).trim();
  return value;
}

async function readReplies(path) {
  const text = await readFile(resolve(process.cwd(), path), "utf8");
  const replies = text
    .split(/^\s*---\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((reply) => ({ text: reply }));
  if (replies.length > 10) {
    throw new CliError("--replies 파일의 답글은 최대 10개까지 가능합니다.", 2);
  }
  return replies;
}

async function writeJsonFile(path, data) {
  await writeTextFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeTextFile(path, text) {
  const fullPath = resolve(process.cwd(), path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, text, "utf8");
}

async function writeBinaryFile(path, data) {
  const fullPath = resolve(process.cwd(), path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function splitCsv(value) {
  if (!value) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefined(item)]),
    );
  }
  return value;
}

function printTable(headers, rows) {
  const stringRows = rows.map((row) => row.map((cell) => cell == null ? "" : String(cell)));
  const widths = headers.map((header, index) => Math.max(
    displayWidth(header),
    ...stringRows.map((row) => displayWidth(row[index] || "")),
  ));
  console.log(headers.map((header, index) => padCell(header, widths[index])).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of stringRows) {
    console.log(row.map((cell, index) => padCell(cell, widths[index])).join("  "));
  }
}

function padCell(value, width) {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

function displayWidth(value) {
  return Array.from(String(value)).reduce((width, char) => width + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
}

function truncate(value, max) {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}...` : chars.join("");
}

function numberText(value) {
  if (value == null || value === "") return "0";
  return Number(value).toLocaleString("ko-KR");
}

function contentDispositionFilename(header) {
  if (!header) return "";
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return basename(decodeURIComponent(utf8[1].trim()));
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? basename(plain[1].trim()) : "";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function usageError(message, section = "root") {
  printUsage(section, console.error);
  return new CliError(message, 2);
}

function printUsage(section = "root", write = console.log) {
  const text = {
    root: `sbusim local CLI ${VERSION}

사용법:
  sbusim threads <명령> [옵션]
  sbusim --help

명령:
  threads accounts       Threads 계정 목록
  threads posts          날짜별 게시물 조회
  threads sync-insights  인사이트 동기화
  threads report         게시물 리포트 생성
  threads schedule       게시물 예약 또는 즉시 발행 요청

설정:
  ~/.sbusim/.env.local 또는 ./.env.local에 SBUSIM_API_URL, SBUSIM_API_KEY를 설정하세요.`,
    threads: `사용법:
  sbusim threads accounts [--owners hasun,ops2] [--accounts 2pinefine] [--json]
  sbusim threads posts --date 2026-07-08 [--owners hasun,ops2] [--accounts ...] [--sync] [--json] [--out file.json]
  sbusim threads sync-insights --date 2026-07-08 [--owners ...] [--accounts ...]
  sbusim threads report --date 2026-07-08 [--owners ...] [--xlsx|--format xlsx|json] [--no-thread-url] [--sync] [--out path]
  sbusim threads schedule --account 2pinefine --text <text-or-file> [--replies <file>] [--media-type TEXT|IMAGE|VIDEO] [--media-url URL] (--at "2026-07-09T18:30:00+09:00" | --now)`,
    accounts: "사용법: sbusim threads accounts [--owners hasun,ops2] [--accounts 2pinefine] [--json]",
    posts: "사용법: sbusim threads posts --date 2026-07-08 [--owners hasun,ops2] [--accounts ...] [--sync] [--json] [--out file.json]",
    "sync-insights": "사용법: sbusim threads sync-insights --date 2026-07-08 [--owners ...] [--accounts ...]",
    report: "사용법: sbusim threads report --date 2026-07-08 [--owners ...] [--xlsx|--format xlsx|json] [--no-thread-url] [--sync] [--out path]",
    schedule: '사용법: sbusim threads schedule --account 2pinefine --text <text-or-file> [--replies <file>] [--media-type TEXT|IMAGE|VIDEO] [--media-url URL] (--at "2026-07-09T18:30:00+09:00" | --now)',
  }[section] || "";
  write(text);
}

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

main().catch((error) => {
  if (error instanceof CliError) {
    if (error.message) console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error(`예상하지 못한 오류가 발생했습니다: ${error?.message || String(error)}`);
  process.exit(1);
});
