import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="flex justify-center pt-16">
      <SignIn />
    </div>
  )
}
