/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_MENU_BASE_URL?: string;
  readonly VITE_PUBLIC_MENU_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
