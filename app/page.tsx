import Image from "next/image";
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-gray-200 dark:bg-gray-700 rounded-lg p-6 flex flex-col items-center gap-4 w-100 mx-auto">
        <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
          <Image
            className="dark:invert mx-auto"
            src="/imgs/snakepic.png"
            alt="Next.js logo"
            width={300}
            height={100}
            priority
          />
          <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
            Welcome to Review Remind - Increasing Positive Google Reviews for you business
          </h1>
          <div className="flex gap-4 items-center flex-col sm:flex-row">
            <Link
              className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:w-auto"
              href="/login"
              target="_self"
            >
              Log In
            </Link>
            <Link
              className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 w-full sm:w-auto md:w-[158px]"
              href="/signup"
              target="_self"
            >
              Sign Up
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
