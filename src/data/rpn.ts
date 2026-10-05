const EPSILON = 0.0001;
const EPSILON_2 = EPSILON / 2;

function d2i(d: number): number {
  return Math.floor(d + 0.5) | 0;
}

type Op = { args: number; fn: (a: number[]) => number };

const OPS: Record<string, Op> = {
  '+': { args: 2, fn: (a) => a[0]! + a[1]! },
  add: { args: 2, fn: (a) => a[0]! + a[1]! },
  '-': { args: 2, fn: (a) => a[0]! - a[1]! },
  sub: { args: 2, fn: (a) => a[0]! - a[1]! },
  '*': { args: 2, fn: (a) => a[0]! * a[1]! },
  mul: { args: 2, fn: (a) => a[0]! * a[1]! },
  '/': { args: 2, fn: (a) => a[0]! / a[1]! },
  div: { args: 2, fn: (a) => a[0]! / a[1]! },
  '%': { args: 2, fn: (a) => d2i(a[0]!) % d2i(a[1]!) },
  mod: { args: 2, fn: (a) => d2i(a[0]!) % d2i(a[1]!) },
  pow: { args: 2, fn: (a) => Math.pow(a[0]!, a[1]!) },
  sqrt: { args: 1, fn: (a) => Math.sqrt(a[0]!) },
  log: { args: 1, fn: (a) => Math.log10(a[0]!) },
  exp: { args: 1, fn: (a) => Math.exp(a[0]!) },
  ln: { args: 1, fn: (a) => Math.log(a[0]!) },
  sin: { args: 1, fn: (a) => Math.sin(a[0]!) },
  cos: { args: 1, fn: (a) => Math.cos(a[0]!) },
  tan: { args: 1, fn: (a) => Math.tan(a[0]!) },
  rand: {
    args: 2,
    fn: (a) => {
      const lo = Math.min(a[0]!, a[1]!);
      const hi = Math.max(a[0]!, a[1]!);
      return lo + Math.random() * (hi - lo);
    },
  },
  min: { args: 2, fn: (a) => Math.min(a[0]!, a[1]!) },
  max: { args: 2, fn: (a) => Math.max(a[0]!, a[1]!) },
  ceil: { args: 1, fn: (a) => Math.ceil(a[0]!) },
  round: { args: 1, fn: (a) => Math.floor(a[0]! + 0.5) },
  floor: { args: 1, fn: (a) => Math.floor(a[0]!) },
  '<': { args: 2, fn: (a) => (a[0]! < a[1]! - EPSILON ? 1 : 0) },
  '<=': { args: 2, fn: (a) => (a[0]! <= a[1]! + EPSILON ? 1 : 0) },
  '=': { args: 2, fn: (a) => (a[0]! >= a[1]! - EPSILON_2 && a[0]! <= a[1]! + EPSILON_2 ? 1 : 0) },
  '!=': { args: 2, fn: (a) => (a[0]! < a[1]! - EPSILON_2 || a[0]! > a[1]! + EPSILON_2 ? 1 : 0) },
  '>=': { args: 2, fn: (a) => (a[0]! >= a[1]! - EPSILON ? 1 : 0) },
  '>': { args: 2, fn: (a) => (a[0]! > a[1]! + EPSILON ? 1 : 0) },
  '&&': { args: 2, fn: (a) => (d2i(a[0]!) && d2i(a[1]!) ? 1 : 0) },
  and: { args: 2, fn: (a) => (d2i(a[0]!) && d2i(a[1]!) ? 1 : 0) },
  '||': { args: 2, fn: (a) => (d2i(a[0]!) || d2i(a[1]!) ? 1 : 0) },
  or: { args: 2, fn: (a) => (d2i(a[0]!) || d2i(a[1]!) ? 1 : 0) },
  '!': { args: 1, fn: (a) => (d2i(a[0]!) ? 0 : 1) },
  not: { args: 1, fn: (a) => (d2i(a[0]!) ? 0 : 1) },
  '?': { args: 3, fn: (a) => (d2i(a[0]!) ? a[1]! : a[2]!) },
  iif: { args: 3, fn: (a) => (d2i(a[0]!) ? a[1]! : a[2]!) },
};

export function rpnEval(expression: string, vars: Record<string, number>): number {
  const tokens = expression.split(/\s+/).filter((t) => t.length > 0);
  const stack: number[] = [];

  for (const token of tokens) {
    const op = OPS[token];
    if (op !== undefined) {
      if (stack.length < op.args) throw new Error(`RPN stack underflow in "${expression}"`);
      const args: number[] = [];
      for (let i = 0; i < op.args; i++) args.push(stack.pop()!);
      stack.push(op.fn(args));
      continue;
    }

    const variable = vars[token];
    if (variable !== undefined) {
      stack.push(variable);
      continue;
    }

    const literal = Number.parseFloat(token);
    stack.push(Number.isFinite(literal) ? literal : 0);
  }

  return stack.length === 0 ? 0 : stack[stack.length - 1]!;
}
