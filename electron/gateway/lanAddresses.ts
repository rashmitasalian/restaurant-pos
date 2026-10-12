export type LanInterfaceEntry = {
  address: string;
  netmask: string;
  family: string | number;
  internal?: boolean;
};

/** Point-to-point and tunnel adapters. These are not the restaurant Wi-Fi. */
const VIRTUAL_ADAPTER =
  /vgate|vethernet|hyper-?v|wsl|virtualbox|vmware|vmnet|vbox|docker|tailscale|zerotier|bluetooth|hamachi|wireguard|wintun|nordlynx|vpn|loopback|^tun|^tap/i;

function isIpv4(family: string | number) {
  return family === "IPv4" || family === 4;
}

function isLinkLocal(address: string) {
  return address.startsWith("169.254.");
}

/**
 * Addresses a captain phone on the restaurant Wi-Fi can open.
 * Virtual, /32, and link-local adapters stay in the list, after every shared LAN
 * address, because Windows often reports them first.
 */
export function selectLanIPv4Addresses(
  interfaces: Record<string, LanInterfaceEntry[] | undefined>,
): string[] {
  const found: Array<{ address: string; rank: number; index: number }> = [];
  let index = 0;
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || !isIpv4(entry.family)) {
        continue;
      }
      const hostOnly = entry.netmask === "255.255.255.255";
      const virtual = VIRTUAL_ADAPTER.test(name) || hostOnly;
      let rank = 0;
      if (isLinkLocal(entry.address)) {
        rank = 2;
      } else if (virtual) {
        rank = 1;
      }
      found.push({ address: entry.address, rank, index });
      index += 1;
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const item of found) {
    if (seen.has(item.address)) {
      continue;
    }
    seen.add(item.address);
    addresses.push(item.address);
  }
  return addresses;
}
