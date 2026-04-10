"use client";

import { useState } from "react";

export default function LoginForm({ nextPath }: { nextPath: string }) {
  const [loginId, setLoginId] = useState("hasun");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "로그인 실패");
      window.location.href = nextPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium text-zinc-700">아이디</label>
        <input
          className="h-11 rounded-xl border border-zinc-300 px-3 text-sm outline-none transition focus:border-blue-500"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoComplete="username"
          required
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-zinc-700">비밀번호</label>
        <input
          type="password"
          className="h-11 rounded-xl border border-zinc-300 px-3 text-sm outline-none transition focus:border-blue-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-zinc-950 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
      >
        {busy ? "로그인 중..." : "대시보드 입장"}
      </button>
    </form>
  );
}
