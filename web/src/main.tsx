import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { init } from "./app/actions";
import { App } from "./app/App";
import { installTheme } from "./app/theme";
import { installDebug } from "./debug/fpgasim";
import { t } from "./i18n";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

document.title = t("app.title");
installTheme();
installDebug();
void init();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
