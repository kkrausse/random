import page from "./index.html";
const server = Bun.serve({ port: Number(process.env.PORT || 5194), routes: { "/": page }, development: true });
console.log(`OpenCode fixture harness: ${server.url}`);
