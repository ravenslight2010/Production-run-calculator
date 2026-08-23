import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./reloadBreadcrumbs";
import { installBrowserPerformanceDiagnostics } from "./performanceDiagnostics";

installBrowserPerformanceDiagnostics();
createRoot(document.getElementById("root")!).render(<App />);
