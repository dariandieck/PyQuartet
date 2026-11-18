export type Ease = (t: number) => number;

export const easeInOut: Ease = (t) => 3 * t * t - 2 * t * t * t;
export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
export type TweenTargets<T> = Partial<Pick<T, NumericKeys<T>>>;

export interface TweenOptions {
  delay?: number;
  ease?: Ease;
  onDone?: () => void;
}

export class Tween<T extends object> {
  private start: Record<string, number> | null = null;
  private elapsed = 0;
  private delay: number;
  private readonly duration: number;

  constructor(
    private readonly target: T,
    duration: number,
    private readonly to: TweenTargets<T>,
    private readonly options: TweenOptions = {},
  ) {
    this.duration = Math.max(duration, 1e-6);
    this.delay = options.delay ?? 0;
  }

  /** Returns true once finished. */
  update(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return false;
      dt = -this.delay;
    }
    const target = this.target as Record<string, number>;
    const keys = Object.keys(this.to);
    // Captured lazily so chained tweens start from wherever the previous one left the target.
    this.start ??= Object.fromEntries(keys.map((k) => [k, target[k]!]));
    this.elapsed = Math.min(this.elapsed + dt, this.duration);
    const t = (this.options.ease ?? easeInOut)(this.elapsed / this.duration);
    const to = this.to as Record<string, number>;
    for (const key of keys) {
      const from = this.start[key]!;
      target[key] = from + (to[key]! - from) * t;
    }
    if (this.elapsed >= this.duration) {
      this.options.onDone?.();
      return true;
    }
    return false;
  }
}

export class Animator {
  private tweens: Tween<object>[] = [];

  tween<T extends object>(target: T, duration: number, to: TweenTargets<T>, options?: TweenOptions): void {
    this.tweens.push(new Tween(target, duration, to, options) as Tween<object>);
  }

  get busy(): boolean {
    return this.tweens.length > 0;
  }

  update(dt: number): void {
    this.tweens = this.tweens.filter((tween) => !tween.update(dt));
  }
}

type Step = { kind: "call"; fn: () => void } | { kind: "wait"; seconds: number };

/**
 * Runs steps one after another; every step waits until all running tweens are finished.
 * Steps queued from inside a running step run before the rest of the queue, so a step can expand into sub-steps.
 */
export class Sequencer {
  private steps: Step[] = [];
  private nested: Step[] | null = null;

  constructor(private readonly animator: Animator) {}

  private push(step: Step): this {
    (this.nested ?? this.steps).push(step);
    return this;
  }

  then(fn: () => void): this {
    return this.push({ kind: "call", fn });
  }

  wait(seconds: number): this {
    return this.push({ kind: "wait", seconds });
  }

  update(dt: number): void {
    while (this.steps.length > 0 && !this.animator.busy) {
      const step = this.steps[0]!;
      if (step.kind === "wait") {
        step.seconds -= dt;
        dt = 0;
        if (step.seconds > 0) return;
        this.steps.shift();
        continue;
      }
      this.steps.shift();
      this.nested = [];
      try {
        step.fn();
      } finally {
        this.steps.unshift(...this.nested);
        this.nested = null;
      }
    }
  }
}
