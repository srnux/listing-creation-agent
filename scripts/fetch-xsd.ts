import { existsSync } from "node:fs";
import { XSD_PATH } from "../packages/core/src/openimmo/validate.js";

// The OpenImmo license forbids redistributing the XSD, and the official download sits behind a license
// agreement on openimmo.de. So this script does not download; it says what to do and whether it is done.
if (existsSync(XSD_PATH)) {
  console.log(`OpenImmo XSD found: ${XSD_PATH}\nExports are validated against it (mode "xsd").`);
} else {
  console.log(
    [
      "OpenImmo XSD not found. Exports use the fallback structural check (mode \"fallback\").",
      "",
      "To validate against the official schema:",
      "  1. Download OpenImmo 1.2.7 from https://www.openimmo.de (accept the license).",
      `  2. Save the schema file as ${XSD_PATH}`,
      "  3. Run pnpm fetch-xsd again to confirm.",
      "",
      "schemas/ is git-ignored; do not commit the XSD.",
    ].join("\n"),
  );
}
