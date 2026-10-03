import { resetCredentials } from "./credentials";

const port = Number(process.env.PORT ?? "4784");
await resetCredentials(port === 4784 ? 3000 : port);
console.log("Stored credentials removed. Restart the server to generate new credentials and revoke existing sign-ins. A running server retains its credentials until stopped.");
