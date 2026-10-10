import type { StaffDoc } from "../../../app/db/posRepository";
import { PRINT } from "../../theme/print-html";
import { buildStaffRosterCsv, buildStaffRosterPdfHtml } from "./staffRosterExport";

function member(overrides: Partial<StaffDoc> & Pick<StaffDoc, "id" | "name" | "phone">): StaffDoc {
  return {
    createdAt: 0,
    active: true,
    ...overrides,
  };
}

const options = {
  includePhotos: true,
  includeSalary: false,
  includeInactive: true,
};

describe("staff roster PDF", () => {
  const records = [
    member({ id: "1", name: "Amit", phone: "9876543212", designation: "Captain" }),
    member({
      id: "2",
      name: "Priya",
      phone: "9876543211",
      joiningDate: "2024-03-01",
      address: "12 Lake Road",
      notes: "Opens the counter.\nHas the keys.",
    }),
    member({ id: "3", name: "Rahul", phone: "9876423512", active: false }),
  ];

  it("prints each person as a card with a readable photo and the address beside the other details", () => {
    const html = buildStaffRosterPdfHtml(records, options, "admin");

    expect(html).not.toMatch(/var\(--/);
    expect(html).toContain('<table class="person active">');
    expect(html).toContain('<table class="person left">');
    expect(html).toContain(`background: ${PRINT.avatar}`);
    expect(html).toContain(`border: 1px solid ${PRINT.line}`);
    expect(html).toContain("width: 84px");
    expect(html).toContain("1. Amit");
    expect(html).toContain(">Captain</td>");
    expect(html).toContain("9876543212");
    expect(html).toContain('<span class="badge left">Left</span>');
    expect(html).toContain('<span class="badge active">Active</span>');
    expect(html).toContain('<div class="avatar">A</div>');
    expect(html).toContain("<td>12 Lake Road</td>");
    expect(html).toContain("Opens the counter.<br/>Has the keys.");
    expect(html).not.toContain("Monthly salary");
    expect(html).not.toContain('class="more"');
    expect(html).not.toContain("justify-content: space-between");
  });

  it("omits the photo column when photos are excluded and adds salary when included", () => {
    const html = buildStaffRosterPdfHtml(
      [member({ id: "1", name: "Amit", phone: "9876543212", salary: 18000 })],
      { includePhotos: false, includeSalary: true, includeInactive: false },
      "admin",
    );

    expect(html).not.toContain('<td class="photo">');
    expect(html).not.toContain('<div class="avatar">');
    expect(html).toContain("Monthly salary");
    expect(html).toContain("Rs. 18,000.00");
  });

  it("escapes names so a staff record cannot break the document", () => {
    const html = buildStaffRosterPdfHtml(
      [member({ id: "1", name: `<img src=x onerror=alert(1)>`, phone: "9876543210" })],
      options,
      "admin",
    );

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});

describe("staff roster CSV", () => {
  it("keeps status and salary in their own columns and neutralizes formulas", () => {
    const csv = buildStaffRosterCsv(
      [
        member({
          id: "1",
          name: "=cmd()",
          phone: "9876543210",
          active: false,
          salary: 1000,
          address: "Line, two",
        }),
      ],
      { includePhotos: false, includeSalary: true, includeInactive: true },
    );

    expect(csv.split("\r\n")[0]).toBe(
      "Name,Mobile Number,Designation,Joining Date,Status,Monthly Salary,Address,Notes",
    );
    expect(csv).toContain("'=cmd(),9876543210,,,Left,\"Rs. 1,000.00\",\"Line, two\",");
  });
});
