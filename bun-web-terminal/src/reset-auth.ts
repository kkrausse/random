import { resetCredentials } from "./credentials";

await resetCredentials(Number(process.env.PORT ?? "4784"));
console.log("Keychain credentials removed. Restart the server to generate new credentials and revoke existing sign-ins. A running server retains its credentials until stopped.");
