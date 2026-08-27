import React from "react";
import { ManageShell } from "../Manager/ManageShell";
import {
  GROCERY_TAB_HASH,
  GROCERY_TABS,
  groceryTabFromHash,
  type GroceryTab,
} from "./groceryUtils";
import { BuyingListsView } from "./BuyingLists/BuyingListsView";
import { PurchasesView } from "./Purchases/PurchasesView";
import { VendorsView } from "./Vendors/VendorsView";
import { ItemsView } from "./Items/ItemsView";

export default function Grocery() {
  const [tab, setTab] = React.useState<GroceryTab>(() =>
    groceryTabFromHash(typeof window !== "undefined" ? window.location.hash : ""),
  );

  React.useEffect(() => {
    const onHash = () => setTab(groceryTabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const selectTab = (next: string) => {
    const id = next as GroceryTab;
    setTab(id);
    window.location.hash = GROCERY_TAB_HASH[id];
  };

  return (
    <ManageShell
      title="Grocery"
      description="Procurement and purchasing"
      tabs={GROCERY_TABS}
      tab={tab}
      onTabChange={selectTab}
      width="operational"
    >
      {tab === "lists" && <BuyingListsView />}
      {tab === "purchases" && <PurchasesView />}
      {tab === "vendors" && <VendorsView />}
      {tab === "items" && <ItemsView />}
    </ManageShell>
  );
}
