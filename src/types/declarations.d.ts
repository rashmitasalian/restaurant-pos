/// <reference types="vite/client" />

declare global {
  interface Window {
    pos?: {
      print?: (payload: any) => Promise<any>;
      listPrinters?: () => Promise<{ ok: boolean; printers: string[]; error?: string }>;
      testPrint?: (printer: any) => Promise<any>;
      writeLog?: (level: string, message: string, context?: any) => Promise<void>;
      copyText?: (text: string) => Promise<{ ok: boolean }>;
      exportReportPdf?: (
        html: string,
        defaultFileName: string,
      ) => Promise<{ ok: boolean; path?: string; reason?: string; error?: string }>;
      db?: {
        ready: () => Promise<{ ok: boolean }>;
      };
      auth?: {
        hasUsers: () => Promise<boolean>;
        createFirstAdmin: (payload: any) => Promise<any>;
        login: (username: string, password: string) => Promise<any>;
        logout: (username?: string) => Promise<any>;
        refreshUser: (username?: string) => Promise<any>;
        changePassword: (
          username: string,
          currentPassword: string,
          newPassword: string,
        ) => Promise<any>;
        recoveryStatus: () => Promise<any>;
        recoverLastAdmin: (payload: any) => Promise<any>;
        regenerateRecoveryCodes: (payload: any) => Promise<{ recoveryCodes: string[] }>;
      };
      branding?: {
        getPublic: () => Promise<{
          hotelName?: string;
          hotelInitials?: string;
          tagline?: string;
          logoDataUrl?: string | null;
        }>;
      };
      users?: {
        list: () => Promise<any[]>;
        create: (payload: any) => Promise<any>;
        update: (
          username: string,
          updates: any,
          actorUsername?: string | null,
          actorPassword?: string | null,
        ) => Promise<any>;
        resetPassword: (
          username: string,
          password: string,
          actorUsername?: string | null,
          actorPassword?: string | null,
        ) => Promise<any>;
      };
      tables?: {
        seed: (count: number) => Promise<any[]>;
        list: () => Promise<any[]>;
        configuredCount: () => Promise<number>;
        snapshot: () => Promise<any>;
        setArea: (tableId: number, areaId: string) => Promise<any>;
        setSeats: (tableId: number, seats: number) => Promise<any>;
        setName: (tableId: number, name: string) => Promise<any>;
        applyFloorLayout: (payload: any) => Promise<any>;
      };
      seatingAreas?: {
        list: (includeDisabled?: boolean) => Promise<any[]>;
        save: (areas: any[]) => Promise<any[]>;
        delete: (areaId: string, reassignToAreaId: string) => Promise<{ ok: boolean }>;
      };
      menu?: {
        seed: () => Promise<any[]>;
        listItems: () => Promise<any[]>;
        getItem: (id: string) => Promise<any>;
        createItem: (payload: any) => Promise<any>;
        updateItem: (payload: any) => Promise<any>;
        deleteItem: (id: string) => Promise<any>;
        reorderItems: (ids: string[]) => Promise<{ ok: boolean; count: number }>;
        listCategories: () => Promise<string[]>;
        setCategories: (categories: string[]) => Promise<any>;
        importMenu: (payload: {
          csv: string;
          fileName?: string;
          mode?: "upsert" | "replace";
        }) => Promise<any>;
        listVariantOptions: () => Promise<string[]>;
        setVariantOptions: (options: string[]) => Promise<any>;
      };
      orders?: {
        create: (payload: any) => Promise<any>;
        nextKotSeq: () => Promise<number>;
        get: (id: string) => Promise<any>;
        getOpenForTable: (tableId: number) => Promise<any>;
        getOrCreateForTable: (tableId: number) => Promise<any>;
        listOpen: () => Promise<any[]>;
        listActive: () => Promise<any[]>;
        listPaid: (opts?: any) => Promise<any[]>;
        countPaid: (opts?: any) => Promise<number>;
        summarizePaid: (opts?: any) => Promise<{ count: number; total: number }>;
        listPaidIds: (opts?: any) => Promise<string[]>;
        addLine: (orderId: string, item: any) => Promise<any>;
        updateLines: (orderId: string, lines: any[]) => Promise<any>;
        setDiscount: (orderId: string, discountPercent: number) => Promise<any>;
        setStatus: (orderId: string, status: string, payload?: any) => Promise<any>;
        markKotSent: (
          orderId: string,
          sentLines?: Array<{ id: string; sentQty: number }>,
        ) => Promise<any>;
        markKotFailed: (orderId: string, error?: string | null) => Promise<any>;
        voidKotLine: (
          orderId: string,
          payload: { lineId: string; finalQty: number; reason: string },
        ) => Promise<any>;
        markKotDone: (orderId: string) => Promise<any>;
        markKotPrinted: (orderId: string) => Promise<any>;
        markBillPrinted: (orderId: string) => Promise<any>;
        pay: (orderId: string, payment: any) => Promise<any>;
        cancel: (orderId: string, reason: string) => Promise<any>;
        deleteHistory: (orderIds: string[]) => Promise<any>;
        restoreHistory: (orders: any[]) => Promise<any[]>;
      };
      customers?: {
        list: (opts?: any) => Promise<any[]>;
        create: (payload: any) => Promise<any>;
        update: (id: string, updates: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
        account: (customerId: string) => Promise<any>;
        accountEntries: (
          customerId: string,
          opts?: { limit?: number; offset?: number },
        ) => Promise<any>;
        openBills: (customerId: string) => Promise<any[]>;
        receivePayment: (customerId: string, payload: any) => Promise<any>;
        voidCreditSale: (creditEntryId: string, payload?: any) => Promise<any>;
      };
      staff?: {
        list: (opts?: any) => Promise<any[]>;
        get: (id: string) => Promise<any | null>;
        create: (payload: any) => Promise<any>;
        update: (id: string, updates: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
      };
      attendance?: {
        list: (input: any) => Promise<any[]>;
        listRange: (input: any) => Promise<any[]>;
        upsert: (input: any) => Promise<any[]>;
        copy: (fromDate: string, toDate: string) => Promise<any[]>;
        delete: (id: string) => Promise<any>;
      };
      settings?: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<any>;
        pruneAudit: () => Promise<number>;
        pruneHistory: () => Promise<number>;
      };
      reports?: {
        salesFacts: (opts?: any) => Promise<any>;
        salesSummary: (opts?: any) => Promise<any>;
        paymentBreakdown: (opts?: any) => Promise<Record<string, number>>;
        creditCollections: (opts?: any) => Promise<Record<string, number>>;
        creditTotals: () => Promise<{ outstanding: number; overdue: number }>;
        productSales: (opts?: any) => Promise<any>;
        orderHistory: (opts?: any) => Promise<any[]>;
        foodCostSummary: (opts?: any) => Promise<any>;
        profitability: (opts?: any) => Promise<any>;
        groceryPurchases: (opts?: any) => Promise<any>;
      };
      review?: {
        summary: (opts?: any) => Promise<any>;
        items: (opts?: any) => Promise<any[]>;
        staffActivity: (opts?: any) => Promise<any[]>;
        timeline: (orderId: string) => Promise<any>;
      };
      grocery?: {
        listItems: (opts?: any) => Promise<any[]>;
        createItem: (payload: any) => Promise<any>;
        updateItem: (id: string, updates: any) => Promise<any>;
        deleteItem: (id: string) => Promise<any>;
        listLists: (opts?: any) => Promise<any[]>;
        getList: (id: string) => Promise<any>;
        createList: (payload: any) => Promise<any>;
        updateList: (id: string, updates: any) => Promise<any>;
        changeListLines: (id: string, change: any) => Promise<any>;
        deleteList: (id: string) => Promise<any>;
        listPurchases: (opts?: any) => Promise<any[]>;
        createPurchase: (payload: any) => Promise<any>;
        updatePurchase: (id: string, updates: any) => Promise<any>;
        deletePurchase: (id: string) => Promise<any>;
        listPurchaseHeaders: (opts?: any) => Promise<any[]>;
        createPurchaseHeader: (payload: any) => Promise<any>;
        updatePurchaseHeader: (id: string, updates: any) => Promise<any>;
        voidPurchaseHeader: (id: string) => Promise<any>;
        listTemplates: () => Promise<any[]>;
        createTemplate: (payload: any) => Promise<any>;
        deleteTemplate: (id: string) => Promise<any>;
      };
      vendors?: {
        list: (opts?: any) => Promise<any[]>;
        create: (payload: any) => Promise<any>;
        update: (id: string, updates: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
      };
      expenses?: {
        listCategories: (opts?: any) => Promise<any[]>;
        list: (opts?: any) => Promise<any[]>;
        create: (payload: any) => Promise<any>;
        update: (id: string, updates: any) => Promise<any>;
        void: (id: string) => Promise<any>;
      };
      salaryAdvances?: {
        list: (opts?: any) => Promise<any[]>;
        create: (payload: any) => Promise<any>;
        void: (id: string) => Promise<any>;
      };
      audit?: {
        create: (
          action: string,
          orderId?: string | null,
          user?: string | null,
          detail?: any,
        ) => Promise<any>;
        list: (opts?: any) => Promise<any[]>;
        count: (opts?: any) => Promise<number>;
        liveActivity: (opts?: { limit?: number; since?: number }) => Promise<any[]>;
      };
      auditArchives?: {
        create: (retentionDays: number) => Promise<any | null>;
        list: () => Promise<any[]>;
        export: (id: string) => Promise<{ data: any[]; metadata: any }>;
        delete: (id: string) => Promise<any>;
        cleanupOld: (ageMonths: number) => Promise<number>;
      };
      printQueue?: {
        add: (payload: any) => Promise<any>;
        list: (status?: string) => Promise<any[]>;
        markCompleted: (id: string) => Promise<any>;
        retry: (id: string) => Promise<boolean>;
        clearOld: (ageHours: number) => Promise<number>;
      };
      backupSqlite?: {
        createLocal: (actor?: string | null) => Promise<any>;
        restoreLocal: () => Promise<any>;
        list: () => Promise<any[]>;
        status: () => Promise<any>;
        create: () => Promise<any>;
        history: () => Promise<any>;
        restore: (backupId: string) => Promise<any>;
        activateCloud: () => Promise<any>;
        recoverCloud: (payload: { restaurantCode: string; recoveryKey: string }) => Promise<any>;
        listCloud: () => Promise<any>;
        restoreCloud: (backupId: string) => Promise<any>;
        exportRecoveryKey: (recoveryKey: string) => Promise<any>;
        relaunch: () => Promise<any>;
      };
      app?: {
        info: () => Promise<{
          version: string;
          databasePath: string;
          logPath: string;
          updateStoragePath: string;
        }>;
      };
      updates?: {
        check: () => Promise<any>;
        prepare: (options?: { allowBusinessActivity?: boolean }) => Promise<any>;
        launch: () => Promise<any>;
        status: () => Promise<any>;
        startupHealth: () => Promise<any>;
        rollback: (options?: { confirmed?: boolean }) => Promise<any>;
      };
      support?: {
        exportDiagnostics: () => Promise<any>;
      };
      gateway?: {
        status: () => Promise<any>;
        start: () => Promise<any>;
        stop: () => Promise<any>;
        rotatePairing: () => Promise<any>;
      };
      events?: {
        onDomainEvent: (listener: (event: any) => void) => () => void;
      };
    };
    __onehand_setters?: any;
  }
}

export {};
