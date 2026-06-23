import assert from "node:assert/strict";
import {
  buildThreadsDailyReportRows,
  formatReportCell,
  getKstDateRange,
  mergeAccountReportItems,
  type ThreadsDailyReportAccount,
  type ThreadsDailyReportItem,
} from "../src/server/threadsDailyReport";

const account: ThreadsDailyReportAccount = {
  id: "acc_1",
  name: "growth_sbs",
};

function item(overrides: Partial<ThreadsDailyReportItem>): ThreadsDailyReportItem {
  return {
    accountId: "acc_1",
    source: "scheduled",
    sourceLabel: "예약",
    text: "기본 글",
    occurredAt: new Date("2026-06-23T00:30:00.000Z"),
    remotePostId: null,
    status: "PENDING",
    ...overrides,
  };
}

{
  const range = getKstDateRange("2026-06-23");
  assert.equal(range.dateKst, "2026-06-23");
  assert.equal(range.start.toISOString(), "2026-06-22T15:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-06-23T15:00:00.000Z");
}

{
  assert.equal(
    formatReportCell(
      item({
        sourceLabel: "직접",
        text: "폰에서 올린 글입니다.\n줄바꿈은 정리됩니다.",
        occurredAt: new Date("2026-06-23T01:15:00.000Z"),
      })
    ),
    "10:15 [직접] 폰에서 올린 글입니다. 줄바꿈은 정리됩니다."
  );
}

{
  const merged = mergeAccountReportItems([
    item({
      source: "scheduled",
      sourceLabel: "발행완료",
      text: "스부심에서 발행한 글",
      remotePostId: "remote_1",
      occurredAt: new Date("2026-06-23T02:00:00.000Z"),
      status: "SUCCESS",
    }),
    item({
      source: "direct",
      sourceLabel: "직접",
      text: "API에서 다시 들어온 같은 글",
      remotePostId: "remote_1",
      occurredAt: new Date("2026-06-23T02:01:00.000Z"),
    }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceLabel, "발행완료");
  assert.equal(merged[0].text, "스부심에서 발행한 글");
}

{
  const rows = buildThreadsDailyReportRows([
    {
      account,
      items: [
        item({
          source: "direct",
          sourceLabel: "직접",
          text: "두 번째 글",
          occurredAt: new Date("2026-06-23T04:00:00.000Z"),
        }),
        item({
          sourceLabel: "예약",
          text: "첫 번째 글",
          occurredAt: new Date("2026-06-23T00:30:00.000Z"),
        }),
      ],
    },
  ]);

  assert.deepEqual(rows, [["growth_sbs", "09:30 [예약] 첫 번째 글", "13:00 [직접] 두 번째 글"]]);
}

console.log("threadsDailyReport tests passed");
