// Isolation Forest scoring — TypeScript twin of ml/rafiq/iforest.py (mean_path).
// The trees come from model.json. Only comparisons, a table lookup, additions
// and one division: bit-identical to Python. Decisions use the mean path length
// (lower = more unusual); the 0–1 score is for display only.

export type Tree = { f: number[]; t: number[]; l: number[]; r: number[]; s: number[] };
export type Forest = {
  n_trees: number; sample_size: number; max_depth: number;
  c_table: number[]; c_norm: number; trees: Tree[];
};

/** Average path length of one day's feature vector over all trees (tree by tree, as Python). */
export function meanPath(forest: Forest, x: number[]): number {
  let total = 0;
  for (const tree of forest.trees) {
    let node = 0;
    let depth = 0;
    while (tree.f[node] >= 0) {
      node = x[tree.f[node]] < tree.t[node] ? tree.l[node] : tree.r[node];
      depth += 1;
    }
    total = total + (depth + forest.c_table[tree.s[node]]);
  }
  return total / forest.n_trees;
}

/** 0–1, higher = more unusual. For display (charts, logs) — never for decisions. */
export function anomalyScore(forest: Forest, path: number): number {
  return Math.pow(2, -path / forest.c_norm);
}

/** Checksum over every number of the forest — same operation order as ml/rafiq/iforest.py fingerprint(). */
export function fingerprint(forest: Forest, thresholds: { alert_path: number; watch_path: number }): number {
  let acc = 0;
  forest.trees.forEach((t, ti) => {
    for (let i = 0; i < t.f.length; i++) {
      acc = acc + t.t[i] * (i + 1) + (t.f[i] + 2) * 3 + t.l[i] * 5 + t.r[i] * 7 + t.s[i] * 11 + ti;
    }
  });
  for (const x of forest.c_table) acc = acc + x;
  return acc + thresholds.alert_path + thresholds.watch_path;
}

/** Before scoring anything: is this exactly the model Python trained? (checksum + 3 known answers) */
export function modelSelfCheck(model: {
  forest: Forest; thresholds: { alert_path: number; watch_path: number };
  fingerprint?: number; selftest?: { vector: number[]; path: number }[];
}): { ok: boolean; fingerprint_ok: boolean; selftest_ok: boolean } {
  const fingerprint_ok = typeof model.fingerprint === 'number' && fingerprint(model.forest, model.thresholds) === model.fingerprint;
  const tests = model.selftest ?? [];
  const selftest_ok = tests.length > 0 && tests.every((s) => meanPath(model.forest, s.vector) === s.path);
  return { ok: fingerprint_ok && selftest_ok, fingerprint_ok, selftest_ok };
}
