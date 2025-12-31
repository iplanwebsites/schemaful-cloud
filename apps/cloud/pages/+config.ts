import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  extends: vikeReact,
  passToClient: ["pageProps", "routeParams", "data", "urlPathname"],
  ssr: true,
} satisfies Config;
