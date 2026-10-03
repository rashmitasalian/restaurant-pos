export function customerLicenseMessage(reason: string): string {
  switch (reason) {
    case "license-missing":
      return "This computer is not activated for RestoNiti.";
    case "machine-mismatch":
    case "installation-mismatch":
      return "This license belongs to a different computer. Please contact RestoNiti support.";
    case "identity-unreadable":
      return "RestoNiti could not read this installation. Please contact RestoNiti support.";
    case "machine-guid-unavailable":
      return "RestoNiti could not identify this computer. Please contact RestoNiti support.";
    case "protection-unavailable":
      return "RestoNiti could not protect this installation. Please contact RestoNiti support.";
    default:
      return "This license could not be verified.";
  }
}
