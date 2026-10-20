export interface ActiveTaskRecord {
  runId: string;
  clientId: string;
  taskType: string;
  taskKey?: string;
  startedAt: number;
}

export class ClientMutationLockManager {
  private static instance: ClientMutationLockManager;

  // Queue of promises per clientId to serialize execution
  private clientQueues: Map<string, Promise<any>> = new Map();
  // Active tasks per clientId to prevent duplicate submissions
  private activeTasksByClient: Map<string, Map<string, ActiveTaskRecord>> = new Map();

  public static getInstance(): ClientMutationLockManager {
    if (!ClientMutationLockManager.instance) {
      ClientMutationLockManager.instance = new ClientMutationLockManager();
    }
    return ClientMutationLockManager.instance;
  }

  /**
   * Resets all locks and active task registries (useful for testing).
   */
  public reset(): void {
    this.clientQueues.clear();
    this.activeTasksByClient.clear();
  }

  /**
   * Checks if a client currently has an active mutation task in-flight.
   */
  public isClientBusy(clientId: string): boolean {
    const active = this.activeTasksByClient.get(clientId);
    return !!active && active.size > 0;
  }

  /**
   * Checks if a duplicate submission is currently active/unresolved for a client.
   */
  public hasDuplicateActiveTask(clientId: string, taskKey: string): boolean {
    if (!taskKey) return false;
    const active = this.activeTasksByClient.get(clientId);
    if (!active) return false;
    for (const record of active.values()) {
      if (record.taskKey === taskKey) {
        return true;
      }
    }
    return false;
  }

  /**
   * Acquires the per-client mutation lock and executes the provided action.
   * Same-client mutations are strictly serialized (executed one-by-one).
   * Different clients execute concurrently in parallel.
   * Duplicate submissions for an active unresolved task are rejected immediately.
   */
  public async executeWithLock<T>(
    options: {
      clientId: string;
      runId: string;
      taskType: string;
      taskKey?: string;
    },
    action: () => Promise<T>
  ): Promise<T> {
    const { clientId, runId, taskType, taskKey } = options;

    // Check for duplicate active task before acquiring lock
    if (taskKey && this.hasDuplicateActiveTask(clientId, taskKey)) {
      const err = new Error(`DUPLICATE_TASK_SUBMISSION_REJECTED: A task with key [${taskKey}] is already active for client [${clientId}].`);
      (err as any).code = 'DUPLICATE_TASK_SUBMISSION_REJECTED';
      throw err;
    }

    // Register active task record immediately to guard against concurrent duplicates while queued
    if (!this.activeTasksByClient.has(clientId)) {
      this.activeTasksByClient.set(clientId, new Map());
    }
    const clientTasks = this.activeTasksByClient.get(clientId)!;
    clientTasks.set(runId, {
      runId,
      clientId,
      taskType,
      taskKey,
      startedAt: Date.now(),
    });

    // Retrieve previous lock or initial resolved promise
    const previousPromise = this.clientQueues.get(clientId) || Promise.resolve();

    let releaseLock: () => void = () => {};
    const currentLockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Update queue for this client
    this.clientQueues.set(clientId, previousPromise.then(() => currentLockPromise, () => currentLockPromise));

    try {
      // Wait for prior tasks of the same client to complete
      await previousPromise;
      return await action();
    } finally {
      clientTasks.delete(runId);
      if (clientTasks.size === 0) {
        this.activeTasksByClient.delete(clientId);
      }
      releaseLock();
    }
  }

  public getActiveTaskCount(clientId?: string): number {
    if (clientId) {
      return this.activeTasksByClient.get(clientId)?.size || 0;
    }
    let total = 0;
    for (const tasks of this.activeTasksByClient.values()) {
      total += tasks.size;
    }
    return total;
  }
}
