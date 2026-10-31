import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./reloadBreadcrumbs";
import { installBrowserPerformanceDiagnostics } from "./performanceDiagnostics";
import { installAlertReceiptListener } from "./alertReceipts";
import { purgeLegacyPinCopies } from "./purgeLegacyPinCopies";

purgeLegacyPinCopies();
installBrowserPerformanceDiagnostics();
installAlertReceiptListener();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
