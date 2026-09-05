import { expect, test } from "bun:test";
import { OutputFlow } from "./output-flow";

test("output is ordered and bounded by acknowledgments", async () => {
  const received: Uint8Array[] = [];
  let stalled = false;
  const flow = new OutputFlow(data => received.push(data), () => { stalled = true; });
  const source = Uint8Array.from({ length: 256 * 1024 }, (_, i) => i % 251);
  flow.push(source);
  await Bun.sleep(30);
  expect(received.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(OutputFlow.windowBytes);
  expect(flow.acknowledge(OutputFlow.windowBytes + 1)).toBe(false);
  expect(flow.acknowledge(-1)).toBe(false);
  expect(flow.acknowledge(OutputFlow.windowBytes)).toBe(true);
  await Bun.sleep(30);
  expect(Buffer.concat(received)).toEqual(Buffer.from(source));
  expect(stalled).toBe(false);
  flow.push(new Uint8Array(OutputFlow.queueBytes + 1));
  expect(stalled).toBe(true);
  expect(flow.acknowledge(OutputFlow.windowBytes)).toBe(false);
  flow.dispose();
});
