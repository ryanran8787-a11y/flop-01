/**
 * 穿透狀態機（純邏輯）。
 * 預設忽略滑鼠；renderer 回報命中角色時才接收事件。
 * 只有狀態翻轉時回傳 true，main 據此呼叫 setIgnoreMouseEvents，避免每幀呼叫閃爍。
 */
export class HitTestState {
  private ignoring = true;

  get ignoringMouse(): boolean {
    return this.ignoring;
  }

  /**
   * @param hit renderer raycast/alpha 命中結果
   * @returns 是否需要更新系統狀態（翻轉時 true）
   */
  setHit(hit: boolean): boolean {
    const nextIgnoring = !hit;
    if (nextIgnoring === this.ignoring) return false;
    this.ignoring = nextIgnoring;
    return true;
  }

  reset(): void {
    this.ignoring = true;
  }
}
