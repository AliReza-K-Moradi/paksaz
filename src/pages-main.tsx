import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/vazirmatn/800.css";
import "../app/globals.css";
import Paksaz from "../app/page";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Paksaz />
  </StrictMode>,
);
