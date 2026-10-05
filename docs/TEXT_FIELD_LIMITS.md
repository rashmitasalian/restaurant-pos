# Text field limits

Every free-text box in RestoNiti stops accepting characters at the limit below. The numbers live in `src/shared/textLimits.ts`. Where a value is saved, the server uses the same limit.

Dates, times, checkboxes, file pickers, and number steppers (price, seats, GST rate) are not character-limited text boxes.

## How the limits were chosen

- **Names and labels** stay short enough to print on a receipt or fit a button, and long enough for a real restaurant name or dish.
- **Phones** store 10 digits. The box allows 16 characters so a pasted `+91` number still normalizes.
- **Notes and reasons** allow a sentence or a short paragraph, not an essay.
- **Codes** match the format the app already generates (GSTIN, username, pairing code, recovery key).
- **Search boxes** are not stored. 80 characters is enough to find a name, phone, or order.

## Sign-in and accounts

| Box | Limit | Why |
| --- | ---: | --- |
| Username | 32 | Already required: 2–32 letters, digits, hyphens, or underscores |
| Display name | 80 | Same as a staff or customer name |
| Password, including confirm and admin password | 128 | Long enough for a passphrase. Minimum is still 8 characters with mixed case and a digit |
| Admin recovery code | 32 | Formatted as groups of four |
| Captain pairing code | 8 | The code itself is 6 hex characters |

## Settings

| Box | Limit | Why |
| --- | ---: | --- |
| Hotel name | 80 | Printed on the receipt |
| Initials | 4 | Shown in the logo placeholder |
| Receipt phone | 20 | A landline or mobile, with spaces |
| Email | 120 | A normal email address |
| Tagline | 80 | One line under the restaurant name |
| Feedback URL | 500 | A review link, including a long query string |
| UPI ID | 100 | A virtual payment address such as `name@bank` |
| Payee name | 80 | Name encoded in the payment QR |
| QR footer note | 120 | One or two lines above the QR |
| GSTIN | 15 | An Indian GSTIN is exactly 15 characters |
| Legal business name | 120 | Registered names are longer than the name on the bill |
| Registered address | 250 | Same as a staff address. Prints on GST bills |
| State code | 2 | GST state code |
| State name | 50 | Covers the longest current state and union territory name |
| Printer IP | 15 | An IPv4 address (`255.255.255.255`) |
| New seating area, area name | 40 | Floor labels such as Garden or Ground Floor. The server keeps 40 |
| Area prefix | 6 | Labels such as `GF` or `BAR` |
| Table name | 40 | The server already keeps the first 40 characters |
| Menu category | 40 | Category chips and the item dropdown |
| Menu variant option | 40 | Sizes such as Half, Full, or Family Pack |
| Restaurant code | 32 | Cloud restore code |
| Recovery key | 40 | Cloud backup key, grouped in fours |
| Current admin password | 128 | Same as other passwords |

## Menu and billing

| Box | Limit | Why |
| --- | ---: | --- |
| Search (menu, billing, captain, tables, history, reports) | 80 | Finds a dish, table, or order. Not stored |
| Item name | 80 | Prints on the bill and the kitchen ticket. CSV import uses the same limit |
| SKU / code | 32 | Optional item code |
| Kitchen note | 80 | One instruction on the kitchen ticket |
| Customer name, rider name, platform name, payee | 80 | A person's name or a short platform name |
| Customer phone, rider phone | 16 in the box, 10 stored | Indian mobile. Extra room is only for `+91` or a leading `0` |
| Order reference | 40 | A short token such as `ABC123` |
| Card, UPI, or other payment reference | 40 | Approval codes and UPI transaction ids |
| Cancel or void reason | 200 | One sentence. Presets such as "Wrong item" are shorter |
| Jump-to search | 80 | Finds a settings section. Not stored |

## Customers, staff, and attendance

| Box | Limit | Why |
| --- | ---: | --- |
| Customer name | 80 | Already required |
| Customer phone | 16 in the box, 10 stored | Already required as a 10-digit mobile |
| Customer search | 80 | Not stored |
| Credit amount, credit limit | 12 | Up to `99,99,999.99` |
| Due in days | 4 | Up to 9,999 days |
| Credit notes | 500 | A short account note |
| Credit void reason | 500 | Already required on the server |
| Staff name | 80 | Already required |
| Staff mobile | 16 in the box, 10 stored | 10-digit mobile |
| Designation | 80 | Already required |
| Address | 250 | Already required |
| Staff notes, attendance note | 500 | Already required |
| Staff search, attendance search, salary search | 80 | Not stored |

## Grocery, expenses, and salary

| Box | Limit | Why |
| --- | ---: | --- |
| Grocery item name, vendor name, vendor hint | 120 | Already required on the server |
| Grocery category | 80 | Already required |
| Vendor phone | 40 | Landlines and short extensions. Already required |
| Vendor contact person | 120 | Already required |
| Vendor notes, purchase notes, expense description, salary note | 500 | Already required |
| Buying list name, template name | 80 | A label such as Morning Procurement |
| Invoice / bill number | 80 | Already required |
| Bill amount and line amount | 12 | Up to `99,99,999.99` |
| Quantity | 10 | A grocery quantity such as `99999.999` |
| Grocery and vendor search | 80 | Not stored |

## Activation

| Box | Limit | Why |
| --- | ---: | --- |
| Installation code | 133 | Read-only. The generated code is `RN1-` plus 26 groups of 4 characters |

## Not limited as text

These controls already have their own rules:

- Prices, seats, GST percent, overtime, and other `type="number"` fields
- Date and time fields
- Checkboxes, radio buttons, and dropdowns
- The restaurant logo file picker
