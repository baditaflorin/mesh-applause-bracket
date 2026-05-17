import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-applause-bracket",
  description:
    "Tap-applause single-elimination popularity contest. Lowest claps each round is out.",
  accentHex: "#ff944d",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
