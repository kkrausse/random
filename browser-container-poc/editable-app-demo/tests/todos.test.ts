import { expect, test } from "bun:test";
import { createBackend } from "../backend";

test("todo API shares CRUD state between clients and isolates server lifetimes", async () => {
  const backend = createBackend();
  const call = async (path = "/api/todos", method = "GET", body?: unknown) => (await backend(new Request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })))!;
  expect(await (await call()).json()).toEqual({ todos: [] });
  const created = await call("/api/todos", "POST", { title: "  Ship the app  " });
  expect(created.status).toBe(201);
  const { todo } = await created.json();
  expect(todo).toMatchObject({ title: "Ship the app", completed: false });
  const path = `/api/todos/${todo.id}`;
  expect(await (await call(path, "PATCH", { completed: true, title: "Shipped" })).json()).toEqual({ todo: { ...todo, title: "Shipped", completed: true } });
  expect(await (await call()).json()).toEqual({ todos: [{ ...todo, title: "Shipped", completed: true }] });
  expect((await call()).headers.get("cache-control")).toBe("no-store");
  expect(await (await createBackend()(new Request("http://localhost/api/todos")))!.json()).toEqual({ todos: [] });
  expect((await call(path, "DELETE")).status).toBe(204);
  expect(await (await call()).json()).toEqual({ todos: [] });
  expect((await call(path, "PATCH", { completed: false })).status).toBe(404);
});

test("invalid todo mutations fail without corrupting existing tasks", async () => {
  const backend = createBackend();
  const call = async (path: string, method: string, body: string) => (await backend(new Request(`http://localhost${path}`, { method, body })))!;
  for (const body of ["null", "[]", "{", '{"title":" "}', '{"title":3}', JSON.stringify({ title: "x".repeat(201) })]) {
    expect((await call("/api/todos", "POST", body)).status).toBe(400);
  }
  const { todo } = await (await call("/api/todos", "POST", '{"title":"Keep me"}')).json();
  for (const body of ['{"completed":"yes"}', '{"title":""}', '{}']) expect((await call(`/api/todos/${todo.id}`, "PATCH", body)).status).toBe(400);
  const list = (await backend(new Request("http://localhost/api/todos")))!;
  expect(await list.json()).toEqual({ todos: [todo] });
  const unsupported = await call("/api/todos", "PUT", "{}");
  expect(unsupported.status).toBe(405);
  expect(unsupported.headers.get("allow")).toBe("GET, POST");
});
