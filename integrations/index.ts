/** Pi adapter: public package imports; no workstation-specific paths. */
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import install from '../sessions.mjs';

export default function (pi: ExtensionAPI) {
  install(pi, { SessionManager });
}
