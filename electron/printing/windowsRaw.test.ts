import { parseWindowsPrinterListOutput } from "./windowsRaw";
import { assertRawPrintJob } from "./windowsRawWorker";

describe("Windows printer list parsing", () => {
  it("parses a single printer name from ConvertTo-Json", () => {
    expect(parseWindowsPrinterListOutput('"POS-80C"')).toEqual([{ name: "POS-80C" }]);
  });

  it("parses printer objects with driver and port", () => {
    expect(
      parseWindowsPrinterListOutput(
        '[{"Name":"POS-80C","DriverName":"POS-80C","PortName":"USB001"},{"Name":"Microsoft Print to PDF","DriverName":"Microsoft Print To PDF","PortName":"PORTPROMPT:"}]',
      ),
    ).toEqual([
      { name: "POS-80C", driverName: "POS-80C", portName: "USB001" },
      {
        name: "Microsoft Print to PDF",
        driverName: "Microsoft Print To PDF",
        portName: "PORTPROMPT:",
      },
    ]);
  });

  it("parses multiple printer names and ignores blanks", () => {
    expect(parseWindowsPrinterListOutput('["Kitchen USB","  ","EPSON TM-T20II"]')).toEqual([
      { name: "Kitchen USB" },
      { name: "EPSON TM-T20II" },
    ]);
  });

  it("returns an empty list for blank PowerShell output", () => {
    expect(parseWindowsPrinterListOutput("   ")).toEqual([]);
  });
});

describe("raw print job lines", () => {
  it("rejects printer names that would split the worker command", () => {
    expect(() => assertRawPrintJob("Kitchen", "C:\\temp\\job.bin")).not.toThrow();
    expect(() => assertRawPrintJob("Kitchen|C:\\secret.txt", "C:\\temp\\job.bin")).toThrow(
      "windows-raw-print-invalid-job",
    );
    expect(() => assertRawPrintJob("Kitchen\nEPSON", "C:\\temp\\job.bin")).toThrow(
      "windows-raw-print-invalid-job",
    );
  });
});
