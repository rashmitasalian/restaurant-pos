/**
 * Crash Recovery System
 * Recovers unsaved cart state after unexpected app crashes
 */

interface CrashRecoveryState {
  currentOrderId?: string;
  currentTable?: number;
  cartItems: Array<{
    name: string;
    qty: number;
    rate: number;
  }>;
  timestamp: number;
  discountPercent: number;
  recovered: boolean;
}

const RECOVERY_KEY = "pos_crash_recovery";
const RECOVERY_VERSION = 1;

export class CrashRecovery {
  /**
   * Save current cart state before risky operations
   */
  static saveState(state: Omit<CrashRecoveryState, "timestamp" | "recovered">) {
    try {
      const recoveryState: CrashRecoveryState = {
        ...state,
        timestamp: Date.now(),
        recovered: false,
      };

      localStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryState));
    } catch (e) {
      console.warn("Failed to save crash recovery state", e);
    }
  }

  /**
   * Check if there's recoverable state after crash
   */
  static hasRecoverableState(): boolean {
    try {
      const stored = localStorage.getItem(RECOVERY_KEY);
      if (!stored) {
        return false;
      }

      const state = JSON.parse(stored) as CrashRecoveryState;
      // Only consider state recoverable if it's less than 1 hour old
      const ageMs = Date.now() - state.timestamp;
      const oneHourMs = 60 * 60 * 1000;

      return ageMs < oneHourMs && state.cartItems.length > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Retrieve crash recovery state
   */
  static getRecoveryState(): CrashRecoveryState | null {
    try {
      const stored = localStorage.getItem(RECOVERY_KEY);
      if (!stored) {
        return null;
      }

      const state = JSON.parse(stored) as CrashRecoveryState;
      state.recovered = true;
      return state;
    } catch (e) {
      console.warn("Failed to retrieve crash recovery state", e);
      return null;
    }
  }

  /**
   * Clear recovery state (call after successful restoration)
   */
  static clearRecoveryState() {
    try {
      localStorage.removeItem(RECOVERY_KEY);
    } catch (e) {
      console.warn("Failed to clear crash recovery state", e);
    }
  }

  /**
   * Get recovery state age in seconds
   */
  static getRecoveryAge(): number | null {
    try {
      const stored = localStorage.getItem(RECOVERY_KEY);
      if (!stored) {
        return null;
      }

      const state = JSON.parse(stored) as CrashRecoveryState;
      const ageMs = Date.now() - state.timestamp;
      return Math.round(ageMs / 1000);
    } catch (e) {
      return null;
    }
  }

  /**
   * Export recovery state for support/debugging
   */
  static exportRecoveryState(): string {
    const state = this.getRecoveryState();
    if (!state) {
      return "No recovery state available";
    }

    return JSON.stringify(state, null, 2);
  }
}

export default CrashRecovery;
