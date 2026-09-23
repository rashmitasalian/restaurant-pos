import React from "react";
import { ManageShell } from "../Manager/ManageShell";
import { Button } from "../../components/ui/Button";
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
  const newListRef = React.useRef<(() => void) | null>(null);
  const recordPurchaseRef = React.useRef<(() => void) | null>(null);
  const addVendorRef = React.useRef<(() => void) | null>(null);
  const addItemRef = React.useRef<(() => void) | null>(null);

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

  const primaryAction =
    tab === "lists" ? (
      <Button variant="primary" onClick={() => newListRef.current?.()}>
        + New Buying List
      </Button>
    ) : tab === "purchases" ? (
      <Button variant="primary" onClick={() => recordPurchaseRef.current?.()}>
        + Record Purchase
      </Button>
    ) : tab === "vendors" ? (
      <Button variant="primary" onClick={() => addVendorRef.current?.()}>
        + Add Vendor
      </Button>
    ) : (
      <Button variant="primary" onClick={() => addItemRef.current?.()}>
        + Add Item
      </Button>
    );

  return (
    <ManageShell
      title="Grocery"
      description="Procurement and purchasing"
      primaryAction={primaryAction}
      tabs={GROCERY_TABS}
      tab={tab}
      onTabChange={selectTab}
      width="operational"
    >
      {tab === "lists" && <BuyingListsView newListRef={newListRef} />}
      {tab === "purchases" && <PurchasesView recordPurchaseRef={recordPurchaseRef} />}
      {tab === "vendors" && <VendorsView addVendorRef={addVendorRef} />}
      {tab === "items" && <ItemsView addItemRef={addItemRef} />}
    </ManageShell>
  );
}
