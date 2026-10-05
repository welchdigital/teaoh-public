import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.ts';
import { rpnEval } from './rpn.ts';

export class Formulas {
  private readonly formulas = new Map<string, string>();
  private readonly nonFinite = new Set<string>();
  readonly expTable: number[];

  private constructor(formulas: Map<string, string>) {
    this.formulas = formulas;
    this.expTable = Array.from({ length: 254 }, (_, i) => Math.round(i ** 3 * 133.1));
  }

  static load(dataDir: string): Formulas {
    const formulas = new Map<string, string>();
    const path = join(dataDir, 'formulas.ini');
    try {
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        formulas.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
      }
      log.info({ path, formulas: formulas.size }, 'formulas loaded');
    } catch (err) {
      log.warn({ path, err: String(err) }, 'formulas.ini not loaded; using defaults');
    }
    return new Formulas(formulas);
  }

  static empty(): Formulas {
    return new Formulas(new Map());
  }

  eval(name: string, vars: Record<string, number>, fallback: number): number {
    const safeFallback = Number.isFinite(fallback) ? fallback : 0;
    const expression = this.formulas.get(name);
    if (expression === undefined) return safeFallback;
    try {
      const result = rpnEval(expression, vars);
      if (Number.isFinite(result)) return result;
      if (!this.nonFinite.has(name)) {
        this.nonFinite.add(name);
        log.warn({ formula: name, vars }, 'formula returned a non-finite result; using the default');
      }
      return safeFallback;
    } catch (err) {
      log.warn({ formula: name, err: String(err) }, 'formula evaluation failed');
      return safeFallback;
    }
  }

  expForLevel(level: number): number {
    return this.expTable[Math.max(0, Math.min(level, 253))] ?? 0;
  }
}
