function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][^\s]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokenSet(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return new Set<string>();
  return new Set(
    normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function toNgramSet(text: string, n = 3) {
  const compact = normalizeText(text).replace(/\s+/g, "");
  const set = new Set<string>();
  if (compact.length < n) return set;
  for (let i = 0; i <= compact.length - n; i += 1) {
    set.add(compact.slice(i, i + n));
  }
  return set;
}

function jaccard(setA: Set<string>, setB: Set<string>) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const value of setA) {
    if (setB.has(value)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

export function calcTextSimilarity(a: string, b: string) {
  if (!a.trim() || !b.trim()) return 0;
  const tokenScore = jaccard(toTokenSet(a), toTokenSet(b));
  const ngramScore = jaccard(toNgramSet(a, 3), toNgramSet(b, 3));
  return tokenScore * 0.55 + ngramScore * 0.45;
}

export function findMostSimilarText(text: string, candidates: string[]) {
  let maxScore = 0;
  let matched = "";
  for (const candidate of candidates) {
    const score = calcTextSimilarity(text, candidate);
    if (score > maxScore) {
      maxScore = score;
      matched = candidate;
    }
  }
  return { score: maxScore, matched };
}

