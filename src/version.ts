// The hcx version comes from package.json and is inlined at build time, so the
// compiled binary carries it without reading a file at runtime.
import pkg from "../package.json";

export const VERSION: string = pkg.version;
