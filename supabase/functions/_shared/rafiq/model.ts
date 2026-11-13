// The trained Rafiq model (model.json, written by ml/rafiq/train.py) and its type.
import type { Forest } from './forest.ts';
import type { Params, Thresholds } from './core.ts';

export type RafiqModel = {
  version: string;
  trained_on: Record<string, unknown>;
  features: string[];
  params: Params;
  decide: Params;
  ewma_alpha: number;
  thresholds: Thresholds & { alert_score: number; watch_score: number };
  forest: Forest;
  /** checksum of the forest (ml/rafiq/iforest.py fingerprint) */
  fingerprint: number;
  /** known inputs and their exact forest paths */
  selftest: { vector: number[]; path: number }[];
  /** false = rafiq_config use_model 0: the rules alone decide (run.ts withConfig) */
  use_model?: boolean;
};
