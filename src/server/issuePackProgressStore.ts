export type IssuePackProgressPhase = "idle" | "running" | "done" | "error";

export type IssuePackProgressPayload = {
  requestId: string;
  phase: IssuePackProgressPhase;
  totalTasks: number;
  completedTasks: number;
  message?: string;
  accountName?: string;
  contentType?: "INFO" | "CTA";
  updatedAt: string;
  error?: string;
};

type StoreValue = IssuePackProgressPayload & {
  expiresAt: number;
};

const TTL_MS = 30 * 60 * 1000;
const gcState = {
  lastSweepAt: 0,
};

function getStore() {
  const key = "__SBUSIM_ISSUE_PACK_PROGRESS_STORE__";
  const root = globalThis as typeof globalThis & {
    [key: string]: Map<string, StoreValue> | undefined;
  };
  if (!root[key]) {
    root[key] = new Map<string, StoreValue>();
  }
  return root[key] as Map<string, StoreValue>;
}

function sweepIfNeeded() {
  const now = Date.now();
  if (now - gcState.lastSweepAt < 60_000) return;
  gcState.lastSweepAt = now;
  const store = getStore();
  for (const [key, value] of store.entries()) {
    if (value.expiresAt <= now) store.delete(key);
  }
}

function buildPayload(input: Omit<IssuePackProgressPayload, "updatedAt">): StoreValue {
  return {
    ...input,
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + TTL_MS,
  };
}

export function initIssuePackProgress(input: {
  requestId: string;
  totalTasks: number;
  message?: string;
}) {
  sweepIfNeeded();
  const store = getStore();
  const payload = buildPayload({
    requestId: input.requestId,
    phase: "running",
    totalTasks: input.totalTasks,
    completedTasks: 0,
    message: input.message ?? "초안 생성을 시작했습니다.",
  });
  store.set(input.requestId, payload);
}

export function updateIssuePackProgress(input: {
  requestId: string;
  totalTasks: number;
  completedTasks: number;
  message?: string;
  accountName?: string;
  contentType?: "INFO" | "CTA";
}) {
  sweepIfNeeded();
  const store = getStore();
  const prev = store.get(input.requestId);
  const payload = buildPayload({
    requestId: input.requestId,
    phase: "running",
    totalTasks: input.totalTasks,
    completedTasks: input.completedTasks,
    message: input.message ?? prev?.message,
    accountName: input.accountName ?? prev?.accountName,
    contentType: input.contentType ?? prev?.contentType,
  });
  store.set(input.requestId, payload);
}

export function finishIssuePackProgress(input: {
  requestId: string;
  totalTasks: number;
  message?: string;
}) {
  sweepIfNeeded();
  const store = getStore();
  const payload = buildPayload({
    requestId: input.requestId,
    phase: "done",
    totalTasks: input.totalTasks,
    completedTasks: input.totalTasks,
    message: input.message ?? "초안 생성이 완료되었습니다.",
  });
  store.set(input.requestId, payload);
}

export function failIssuePackProgress(input: {
  requestId: string;
  totalTasks: number;
  completedTasks: number;
  error: string;
}) {
  sweepIfNeeded();
  const store = getStore();
  const payload = buildPayload({
    requestId: input.requestId,
    phase: "error",
    totalTasks: input.totalTasks,
    completedTasks: input.completedTasks,
    error: input.error,
    message: "초안 생성 중 오류가 발생했습니다.",
  });
  store.set(input.requestId, payload);
}

export function getIssuePackProgress(requestId: string) {
  sweepIfNeeded();
  const store = getStore();
  const found = store.get(requestId);
  if (!found) return null;
  const { expiresAt: _expiresAt, ...payload } = found;
  return payload;
}
