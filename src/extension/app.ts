import { queryAppElements } from "./panel/app-elements.js";
import { createPanelApplication } from "./panel/application.js";
import { localizeDocument } from "./panel/localization.js";

localizeDocument();
const application = createPanelApplication(queryAppElements());
window.addEventListener?.("pagehide", application.dispose);
