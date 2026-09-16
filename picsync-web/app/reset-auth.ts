import { resetCredentials } from "./credentials";

await resetCredentials(Number(process.env.PORT ?? 8789));
console.log("PicSync credentials removed. Start the server to generate a new sign-in link. Any already-running server must be restarted to revoke its sessions.");
