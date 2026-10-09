import { createRoot } from "react-dom/client";
import "../../web/app/styles";
import "./showcase.css";
import App from "./App";
import LocaleBoundary from "./LocaleBoundary";

createRoot(document.getElementById("root")!).render(
  <LocaleBoundary>
    <App />
  </LocaleBoundary>,
);
