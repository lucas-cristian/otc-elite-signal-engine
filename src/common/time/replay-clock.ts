import { Clock } from './live-clock';

export class ReplayClock implements Clock {
  private currentTime: number;

  constructor(initialTime: number = 0) {
    this.currentTime = initialTime;
  }

  now(): number {
    return this.currentTime;
  }

  advanceTo(time: number): void {
    if (time < this.currentTime) {
      throw new Error('ReplayClock cannot move backwards');
    }
    this.currentTime = time;
  }
}
