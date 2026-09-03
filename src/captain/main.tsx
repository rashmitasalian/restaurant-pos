import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "../ui/theme/base.css";
import "../ui/theme/components/index.css";
import "./captain.css";
import iconUrl from "../ui/assets/restoniti-icon.png";
import { CaptainApp } from "./CaptainApp";

function installAppMeta() {
  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]') || document.createElement("link");
  appleIcon.setAttribute("rel", "apple-touch-icon");
  appleIcon.setAttribute("href", iconUrl);
  document.head.appendChild(appleIcon);
}

installAppMeta();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <CaptainApp />
    </React.StrictMode>,
  );
}
