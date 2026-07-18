# Deployment and Update Runbooks

The production process is split into two focused runbooks:

- `docs/FIRST_TIME_INSTALLATION_RUNBOOK.md` covers installing the POS on a fresh Windows desktop or restaurant POS desktop.
- `docs/PRODUCTION_UPDATE_RUNBOOK.md` covers preparing, publishing, running, and rolling back application updates.

Use the first-time installation runbook for new restaurants or rebuilt machines.
Use the production update runbook after the app is already installed and a newer code release needs to be deployed.

That’s a very important concern — cashier fraud is one of the biggest risks in POS systems. If your app allows the cashier to enter any amount freely, yes, they could record a lower payment than what was billed. To prevent this, you need **controls and audit trails** built into your design.

### 🔒 How to Prevent Fake Payments
- **Link payment strictly to the bill total**  
  - When a bill is generated, the system should lock the payable amount.  
  - Cashier cannot override it unless they apply a discount or adjustment, which must be logged.

- **Role-based permissions**  
  - Only managers or authorized staff can approve discounts, voids, or manual overrides.  
  - Cashiers can only accept payment equal to the bill amount.

- **Audit trail for every transaction**  
  - Record who processed the payment, method (cash, card, UPI, etc.), and timestamp.  
  - If the amount differs from the bill, log the reason (discount, refund, correction).

- **Daily reconciliation**  
  - Compare total billed vs. total payments received.  
  - Any mismatch shows up in reports for managers to review.

- **Alerts for suspicious activity**  
  - Example: If a cashier repeatedly records payments lower than bills, flag it.  
  - Managers can investigate patterns.

### 🗂 Example Flow
1. Customer bill = ₹1,250  
2. Cashier tries to record ₹1,000 → System blocks unless “Discount/Adjustment” is selected.  
3. If discount applied, system logs: *Discount ₹250 approved by Manager ID 12*.  
4. End-of-day report shows: *Table 7, Bill ₹1,250, Paid ₹1,000, Discount ₹250*.  

This way, you make it **impossible to fake lesser payments silently** — every deviation is traceable.

👉 Do you want me to sketch out a **database schema for audit logging** (like a `Transactions` table with `bill_id`, `amount_due`, `amount_paid`, `discount_reason`, `staff_id`) so you can see how to implement this cleanly?