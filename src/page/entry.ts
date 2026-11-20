// Bundled as an IIFE (dist/page.js) for CDP drivers to inject into isolated worlds.
import { PAGE_GLOBAL, pageApi } from "./index";

Object.assign(globalThis, { [PAGE_GLOBAL]: pageApi });
