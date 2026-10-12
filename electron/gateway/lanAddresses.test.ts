import { selectLanIPv4Addresses } from "./lanAddresses";

describe("captain LAN addresses", () => {
  it("prefers the Wi-Fi subnet over a /32 virtual adapter", () => {
    const addresses = selectLanIPv4Addresses({
      vgate0: [
        {
          address: "172.30.203.159",
          netmask: "255.255.255.255",
          family: "IPv4",
        },
      ],
      "Wi-Fi": [
        {
          address: "10.176.106.17",
          netmask: "255.255.255.0",
          family: "IPv4",
        },
      ],
    });
    expect(addresses[0]).toBe("10.176.106.17");
  });

  it("ranks named virtual adapters after the restaurant LAN", () => {
    const addresses = selectLanIPv4Addresses({
      "vEthernet (Default Switch)": [
        {
          address: "172.22.160.1",
          netmask: "255.255.240.0",
          family: "IPv4",
        },
      ],
      Ethernet: [
        {
          address: "192.168.1.40",
          netmask: "255.255.255.0",
          family: "IPv4",
        },
      ],
    });
    expect(addresses).toEqual(["192.168.1.40", "172.22.160.1"]);
  });

  it("keeps a virtual address when it is the only one", () => {
    expect(
      selectLanIPv4Addresses({
        vgate0: [
          {
            address: "172.30.203.159",
            netmask: "255.255.255.255",
            family: "IPv4",
          },
        ],
      }),
    ).toEqual(["172.30.203.159"]);
  });

  it("skips loopback and IPv6, and ranks link-local last", () => {
    expect(
      selectLanIPv4Addresses({
        Loopback: [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            internal: true,
          },
        ],
        "Wi-Fi": [
          {
            address: "fe80::1",
            netmask: "ffff:ffff:ffff:ffff::",
            family: "IPv6",
          },
          {
            address: "169.254.12.8",
            netmask: "255.255.0.0",
            family: "IPv4",
          },
          {
            address: "10.0.0.8",
            netmask: "255.255.255.0",
            family: 4,
          },
        ],
      }),
    ).toEqual(["10.0.0.8", "169.254.12.8"]);
  });

  it("keeps the system order of two real adapters", () => {
    expect(
      selectLanIPv4Addresses({
        Ethernet: [
          {
            address: "192.168.0.20",
            netmask: "255.255.255.0",
            family: "IPv4",
          },
        ],
        WiFi: [
          {
            address: "10.176.106.17",
            netmask: "255.255.255.0",
            family: "IPv4",
          },
        ],
      }),
    ).toEqual(["192.168.0.20", "10.176.106.17"]);
  });
});
