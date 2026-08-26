import React from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import styles from "./Grocery.module.css";
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
import { InsightsView } from "./Insights/InsightsView";

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
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Grocery</h1>
          <p className={styles.subtitle}>Buying lists plan what to buy. Vendors attach when you record purchases.</p>
        </div>
        <SegmentedControl
          ariaLabel="Grocery sections"
          options={GROCERY_TABS}
          value={tab}
          onChange={selectTab}
        />
      </div>
      {tab === "lists" && <BuyingListsView />}
      {tab === "purchases" && <PurchasesView />}
      {tab === "vendors" && <VendorsView />}
      {tab === "items" && <ItemsView />}
      {tab === "insights" && <InsightsView />}
    </div>
  );
}
