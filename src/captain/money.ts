export function money(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}
