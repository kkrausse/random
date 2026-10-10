import { expect, test } from "bun:test";
import { OutputFlow } from "./output-flow";

test("output is ordered and bounded by acknowledgments", async () => {
  const received: Uint8Array[] = [];
  let stalled = false;
  let overflowed = 0;
  const flow = new OutputFlow(data => received.push(data), () => { stalled = true; }, () => { overflowed++; });
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
  // Output the browser cannot keep up with is dropped, and a restore is asked
  // for once the browser has parsed everything it was sent.
  expect(received).toHaveLength(8);
  flow.push(new Uint8Array(OutputFlow.queueBytes + 1));
  flow.push(Uint8Array.of(1));
  expect(overflowed).toBe(0);
  expect(flow.acknowledge(OutputFlow.windowBytes)).toBe(true);
  expect(overflowed).toBe(1);
  expect(received).toHaveLength(8);
  // A snapshot is exempt from the queue limit, but live output behind it is not.
  flow.push(new Uint8Array(OutputFlow.queueBytes + OutputFlow.windowBytes), true);
  flow.push(new Uint8Array(OutputFlow.queueBytes));
  expect(overflowed).toBe(1);
  flow.push(Uint8Array.of(1));
  expect(flow.acknowledge(OutputFlow.windowBytes)).toBe(true);
  expect(overflowed).toBe(2);
  expect(stalled).toBe(false);
  flow.dispose();
  expect(flow.acknowledge(1)).toBe(false);
});
