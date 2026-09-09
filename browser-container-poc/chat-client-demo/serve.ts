import page from "./index.html";
const server = Bun.serve({ port: Number(process.env.PORT || 5194), routes: { "/": page }, development: true });
console.log(`kev-browser-agent-kit chat client demo: ${server.url}`);
