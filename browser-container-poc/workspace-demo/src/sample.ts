/** Seed only missing paths. Existing source is always owned by the user. */
export const sampleApp = `import React, { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ fontFamily: "system-ui", padding: "1rem" }}>
      <h1>My browser counter</h1>
      <p>This React app runs in guest Vite. Try the button, then edit this file.</p>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <p>Ask OpenCode to add a Reset button or turn this into a task list.</p>
    </main>
  );
}
`;
