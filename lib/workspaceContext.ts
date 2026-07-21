import { AsyncLocalStorage } from "node:async_hooks";

const workspaceStorage = new AsyncLocalStorage<string>();

export function setRequestWorkspace(workspaceId: string): void {
  workspaceStorage.enterWith(workspaceId);
}

export function requestWorkspaceId(): string | undefined {
  return workspaceStorage.getStore();
}
