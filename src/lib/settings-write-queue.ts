export class SettingsWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private finalWriteQueued = false;

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.finalWriteQueued) {
      return Promise.reject(new Error("Reset in progress"));
    }
    return this.append(work);
  }

  enqueueFinal<T>(work: () => Promise<T>): Promise<T> {
    if (this.finalWriteQueued) {
      return Promise.reject(new Error("Reset in progress"));
    }
    this.finalWriteQueued = true;
    const run = this.append(work);
    return run.catch((error) => {
      this.finalWriteQueued = false;
      throw error;
    });
  }

  private append<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
