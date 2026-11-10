// Prints the access key, sign-in links and QR for the stored credentials, so a
// locked-out browser can sign in again without restarting the server.
import { loadCredentials } from "./credentials";
import { printStartupLink, publicSessionsUrl } from "./startup";

const port = Number(process.env.PORT ?? "4784");
const credentials = await loadCredentials(port === 4784 ? 3000 : port);
await printStartupLink(process.env.HOST ?? "127.0.0.1", port, credentials.secret, await publicSessionsUrl(port));
console.log(`Access key (paste on /login, or save in a password manager): ${credentials.secret}`);
