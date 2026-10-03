/**
 * 單一實例鎖（依賴注入 app 行為，可單元測試）。
 * @returns true = 本程序為主實例應繼續；false = 已有實例，應退出。
 */
export interface SingleInstanceDeps {
  requestSingleInstanceLock: () => boolean;
  onSecondInstance: (cb: () => void) => void;
  quit: () => void;
}

export function ensureSingleInstance(deps: SingleInstanceDeps, onSecond: () => void): boolean {
  const primary = deps.requestSingleInstanceLock();
  if (!primary) {
    deps.quit();
    return false;
  }
  deps.onSecondInstance(onSecond);
  return true;
}
