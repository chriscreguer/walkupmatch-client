import { signOut } from 'next-auth/react';

export default function Navbar() {
  return (
    <header className="bg-gray-800 py-4">
      <div className="container mx-auto px-4 flex justify-between items-center">
        <h1 className="text-white text-xl font-bold">MLB Music Match</h1>
        <button 
          onClick={() => signOut({ callbackUrl: '/' })}
          className="text-white text-sm hover:underline"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}