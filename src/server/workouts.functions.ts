import { spawn } from 'node:child_process'
import { createServerFn } from '@tanstack/react-start'
import { Effect } from 'effect'

import { listActivities } from '../services/Database'

export const getWorkouts = createServerFn({ method: 'GET' }).handler(() =>
  Effect.runPromise(listActivities),
)

export const syncGarmin = createServerFn({ method: 'POST' }).handler(
  () =>
    new Promise<{ message: string }>((resolve, reject) => {
      const child = spawn('bun', ['run', 'garmin:sync'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', (chunk) => { output += String(chunk) })
      child.stderr.on('data', (chunk) => { output += String(chunk) })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ message: `${output.trim()} Run bun run build:data to index new files.` })
        } else {
          reject(new Error(output.trim() || `Garmin sync exited with code ${code}`))
        }
      })
    }),
)
