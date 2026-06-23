import assert from "node:assert/strict";
import http from "node:http";
import { listUserThreadsPosts } from "../src/server/threadsApi";

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server port");
      resolve(address.port);
    });
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("content-type", "application/json");

  if (url.pathname === "/user_1/threads") {
    res.end(
      JSON.stringify({
        data: [
          {
            id: "repost_1",
            timestamp: "2026-06-23T13:29:30+0000",
            media_type: "REPOST_FACADE",
            permalink: "https://www.threads.com/@mine/post/repost",
            username: "mine",
            reposted_post: { id: "original_1" },
          },
        ],
      })
    );
    return;
  }

  if (url.pathname === "/original_1") {
    res.end(
      JSON.stringify({
        id: "original_1",
        text: "원본 글 본문입니다.",
        timestamp: "2026-06-23T13:28:30+0000",
        media_type: "TEXT_POST",
        permalink: "https://www.threads.com/@origin/post/original",
        username: "origin",
      })
    );
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

async function main() {
  const port = await listen(server);
  const previousBaseUrl = process.env.THREADS_GRAPH_BASE_URL;
  process.env.THREADS_GRAPH_BASE_URL = `http://127.0.0.1:${port}`;

  try {
    const posts = await listUserThreadsPosts({
      accessToken: "test-token",
      threadsUserId: "user_1",
      limit: 1,
      maxPages: 1,
    });

    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, "repost_1");
    assert.equal(posts[0].mediaType, "REPOST_FACADE");
    assert.equal(posts[0].repostedPostId, "original_1");
    assert.equal(posts[0].text, "[리포스트 @origin] 원본 글 본문입니다.");
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.THREADS_GRAPH_BASE_URL;
    } else {
      process.env.THREADS_GRAPH_BASE_URL = previousBaseUrl;
    }
    await close(server);
  }

  console.log("threadsApiReposts tests passed");
}

void main();
