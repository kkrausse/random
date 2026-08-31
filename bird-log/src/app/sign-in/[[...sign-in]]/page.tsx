import { Suspense } from 'react'
import { connection } from 'next/server'
import { SignIn } from '@clerk/nextjs'

async function SignInWrapper() {
  await connection()
  return <SignIn />
}

export default function SignInPage() {
  return (
    <div className="flex justify-center pt-16">
      <Suspense>
        <SignInWrapper />
      </Suspense>
    </div>
  )
}
