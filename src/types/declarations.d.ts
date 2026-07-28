/// <reference types="vite/client" />

declare global {
  interface Window {
    pos?: {
      print?: (payload: any) => Promise<any>;
      testPrint?: (printer: any) => Promise<any>;
      writeLog?: (level: string, message: string, context?: any) => Promise<void>;
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
      };
      menu?: {
        seed: () => Promise<any[]>;
        listItems: () => Promise<any[]>;
        getItem: (id: string) => Promise<any>;
        createItem: (payload: any) => Promise<any>;
        updateItem: (payload: any) => Promise<any>;
        deleteItem: (id: string) => Promise<any>;
        listCategories: () => Promise<string[]>;
        setCategories: (categories: string[]) => Promise<any>;
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
        pay: (orderId: string, payment: any) => Promise<any>;
        cancel: (orderId: string, actor?: string | null) => Promise<any>;
        deleteHistory: (orderIds: string[]) => Promise<any>;
        restoreHistory: (orders: any[]) => Promise<any[]>;
      };
      customers?: {
        list: () => Promise<any[]>;
        create: (payload: any) => Promise<any>;
        update: (id: string, updates: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
      };
      staff?: {
        list: (opts?: any) => Promise<any[]>;
        create: (payload: any) => Promise<any>;
        update: (id: string, updates: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
      };
      settings?: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<any>;
        pruneAudit: () => Promise<number>;
        pruneHistory: () => Promise<number>;
      };
      reports?: {
        salesSummary: (opts?: any) => Promise<any>;
        paymentBreakdown: (opts?: any) => Promise<Record<string, number>>;
        productSales: (opts?: any) => Promise<any>;
        orderHistory: (opts?: any) => Promise<any[]>;
        foodCostSummary: (opts?: any) => Promise<any>;
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
        deleteList: (id: string) => Promise<any>;
        listPurchases: (opts?: any) => Promise<any[]>;
        createPurchase: (payload: any) => Promise<any>;
        updatePurchase: (id: string, updates: any) => Promise<any>;
        deletePurchase: (id: string) => Promise<any>;
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
    };
    __onehand_setters?: any;
  }
}

export {};
