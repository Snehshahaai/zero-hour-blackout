export class Health {
  current: number;

  constructor(readonly max: number) {
    this.current = max;
  }

  get alive(): boolean {
    return this.current > 0;
  }

  /** Returns the HP actually removed and whether this damage killed. Dead targets take none. */
  takeDamage(amount: number): { dealt: number; killed: boolean } {
    if (!this.alive || amount <= 0) return { dealt: 0, killed: false };
    const dealt = Math.min(this.current, Math.floor(amount));
    this.current -= dealt;
    return { dealt, killed: this.current === 0 };
  }

  reset(): void {
    this.current = this.max;
  }
}
