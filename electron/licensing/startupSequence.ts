export type StartupSteps = {
  startCore: () => Promise<void>;
  startDeferred: () => void;
  startGateway: () => Promise<void>;
  createWindow: () => Promise<void>;
};

export function isLicensedAtStartup(
  gateEnabled: boolean,
  evaluation: { openDatabase: boolean } | null,
): boolean {
  return !gateEnabled || Boolean(evaluation?.openDatabase);
}

/** Business IPC, the database, and the Captain gateway start only when licensed. */
export async function runStartupSequence(licensed: boolean, steps: StartupSteps) {
  if (licensed) {
    await steps.startCore();
  }
  const windowReady = steps.createWindow();
  void windowReady
    .then(() => {
      if (licensed) {
        steps.startDeferred();
      }
    })
    .catch(() => undefined);
  if (licensed) {
    await steps.startGateway();
  }
  await windowReady;
}

export async function startLicensedServices(steps: Omit<StartupSteps, "createWindow">) {
  await steps.startCore();
  steps.startDeferred();
  await steps.startGateway();
}
