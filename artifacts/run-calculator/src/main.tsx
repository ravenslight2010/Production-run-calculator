import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./reloadBreadcrumbs";

createRoot(document.getElementById("root")!).render(<App />);
