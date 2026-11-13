"""Isolation Forest, written from scratch (numpy only; no scikit-learn).

Idea (Liu, Ting & Zhou, 2008): build many random binary trees, each on a small
random sample. At every node pick a random feature and a random split value
between that feature's min and max in the node. Unusual days are isolated in
few splits, so their average path length from the root is short.

Score = 2 ** (-mean_path / c(sample_size)), in (0, 1]; higher = more unusual.
Decisions use the mean path length directly (thresholds are converted at
export), which keeps Python and TypeScript bit-identical: scoring is only
comparisons, table lookups, additions and one division.
"""
from __future__ import annotations

import numpy as np

from .core import c_factor


class IsolationForest:
    def __init__(self, n_trees: int = 100, sample_size: int = 256, seed: int = 42):
        self.n_trees = n_trees
        self.sample_size = sample_size
        self.seed = seed
        self.trees: list[dict] = []
        self.c_table: list[float] = []
        self.n_features = 0

    # ------------------------------------------------------------ training
    def fit(self, X: np.ndarray) -> 'IsolationForest':
        X = np.asarray(X, dtype=np.float64)
        n, self.n_features = X.shape
        rng = np.random.default_rng(self.seed)
        psi = min(self.sample_size, n)
        self.max_depth = int(np.ceil(np.log2(max(psi, 2))))
        self.psi = psi
        self.trees = []
        for _ in range(self.n_trees):
            idx = rng.choice(n, size=psi, replace=False)
            self.trees.append(self._build(X[idx], rng))
        # c(n) for every leaf size that can occur, and for the normaliser c(psi)
        self.c_table = [c_factor(i) for i in range(psi + 1)]
        return self

    def _build(self, Xs: np.ndarray, rng) -> dict:
        feature: list[int] = []
        threshold: list[float] = []
        left: list[int] = []
        right: list[int] = []
        size: list[int] = []

        def node(rows: np.ndarray, depth: int) -> int:
            i = len(feature)
            feature.append(-1); threshold.append(0.0); left.append(-1); right.append(-1); size.append(len(rows))
            if depth >= self.max_depth or len(rows) <= 1:
                return i
            lo = rows.min(axis=0); hi = rows.max(axis=0)
            usable = np.where(hi > lo)[0]
            if len(usable) == 0:
                return i
            f = int(usable[rng.integers(len(usable))])
            thr = float(rng.uniform(lo[f], hi[f]))
            short = float(f'{thr:.6g}')             # 6 significant digits keep the JSON small;
            if lo[f] < short <= hi[f]:              # Python scores with the same rounded value
                thr = short
            if not (lo[f] < thr <= hi[f]):          # guard against uniform() returning the lower edge
                thr = float((lo[f] + hi[f]) / 2)
            mask = rows[:, f] < thr
            feature[i] = f; threshold[i] = thr
            left[i] = node(rows[mask], depth + 1)
            right[i] = node(rows[~mask], depth + 1)
            return i

        node(Xs, 0)
        return {'feature': feature, 'threshold': threshold, 'left': left, 'right': right, 'size': size}

    # ------------------------------------------------------------ scoring
    def _tree_path(self, tree: dict, X: np.ndarray) -> np.ndarray:
        """Path length per row for one tree (vectorised walk)."""
        n = X.shape[0]
        nodes = np.zeros(n, dtype=np.int64)
        depth = np.zeros(n, dtype=np.float64)
        feat = np.asarray(tree['feature']); thr = np.asarray(tree['threshold'])
        lt = np.asarray(tree['left']); rt = np.asarray(tree['right']); sz = np.asarray(tree['size'])
        active = feat[nodes] >= 0
        while active.any():
            a = np.where(active)[0]
            f = feat[nodes[a]]
            go_left = X[a, f] < thr[nodes[a]]
            nodes[a] = np.where(go_left, lt[nodes[a]], rt[nodes[a]])
            depth[a] = depth[a] + 1.0
            active = feat[nodes] >= 0
        ct = np.asarray(self.c_table)
        return depth + ct[sz[nodes]]

    def mean_path(self, X: np.ndarray) -> np.ndarray:
        X = np.asarray(X, dtype=np.float64)
        total = np.zeros(X.shape[0], dtype=np.float64)
        for tree in self.trees:                      # tree by tree: the same order as TypeScript
            total = total + self._tree_path(tree, X)
        return total / self.n_trees

    def score(self, X: np.ndarray) -> np.ndarray:
        return 2.0 ** (-self.mean_path(X) / self.c_table[self.psi])

    def path_for_score(self, s: float) -> float:
        """Mean path length at which the score equals s (score >= s  <=>  path <= this)."""
        return -float(np.log2(s)) * self.c_table[self.psi]

    # ------------------------------------------------------------ export
    def to_dict(self) -> dict:
        return {
            'n_trees': self.n_trees, 'sample_size': self.psi, 'max_depth': self.max_depth, 'seed': self.seed,
            'n_features': self.n_features, 'c_table': self.c_table, 'c_norm': self.c_table[self.psi],
            'trees': self.trees,
        }

    @classmethod
    def from_dict(cls, d: dict) -> 'IsolationForest':
        m = cls(d['n_trees'], d['sample_size'], d['seed'])
        m.psi = d['sample_size']; m.max_depth = d['max_depth']; m.n_features = d['n_features']
        m.c_table = d['c_table']; m.trees = d['trees']
        return m


def fingerprint(trees: list[dict], c_table: list[float], thresholds: dict) -> float:
    """A checksum over every number in the exported forest — the deployed scorer recomputes it
    (forest.ts) and refuses to run if a single digit changed. Same operation order as TypeScript."""
    acc = 0.0
    for ti, t in enumerate(trees):
        f, th, l, r, s = t['f'], t['t'], t['l'], t['r'], t['s']
        for i in range(len(f)):
            acc = acc + th[i] * (i + 1) + (f[i] + 2) * 3 + l[i] * 5 + r[i] * 7 + s[i] * 11 + ti
    for x in c_table:
        acc = acc + x
    return acc + thresholds['alert_path'] + thresholds['watch_path']
